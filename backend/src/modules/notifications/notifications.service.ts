import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { badRequest, conflict } from '../../common/errors';
import { clampLimit, decodeCursor, encodeCursor } from '../../common/pagination';
import { CampaignStatus, DeviceToken, DevicePlatform, Notification, NotificationAudience, NotificationCategory, Profile, UserNotification } from '../../database/entities/index';
import { ENGAGEMENT_JOBS, QUEUES } from '../queues/queue.constants';
import { CreateCampaignDto } from './notifications.dto';
import { PushSender } from '../../util/thirdparty/fcm/push.sender';

const BATCH = 500;
const PUSH_CONCURRENCY = 10;
type Prefs = { marketing?: boolean; newEpisodes?: boolean; billing?: boolean };

/** Billing notices are always delivered; marketing and new-episode notices respect the user's choices. */
export function wants(category: NotificationCategory, prefs: Prefs | null | undefined): boolean {
  if (category === NotificationCategory.Billing) return true;
  const p = prefs ?? {};
  return category === NotificationCategory.Marketing ? p.marketing !== false : p.newEpisodes !== false;
}
const parsePrefs = (v: unknown): Prefs => (typeof v === 'string' ? JSON.parse(v) : (v as Prefs)) ?? {};

export const campaignView = (n: Notification) => ({ id: n.id, title: n.title, body: n.body, audience: n.audience, category: n.category, status: n.status, data: n.data, scheduledAt: n.scheduledAt, sentAt: n.sentAt, recipientCount: n.recipientCount, createdAt: n.createdAt });
export const inboxView = (u: UserNotification) => ({ id: u.id, title: u.title, body: u.body, category: u.category, data: u.data, read: !!u.readAt, createdAt: u.createdAt });

@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Notification) private readonly campaigns: Repository<Notification>,
    @InjectRepository(UserNotification) private readonly inbox: Repository<UserNotification>,
    @InjectRepository(DeviceToken) private readonly devices: Repository<DeviceToken>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectQueue(QUEUES.Engagement) private readonly queue: Queue,
    private readonly push: PushSender,
  ) {}

  // ── admin: campaigns ──
  async create(adminId: string, dto: CreateCampaignDto) {
    if (dto.data && (Object.keys(dto.data).length > 10 || Object.entries(dto.data).some(([k, v]) => !/^[A-Za-z][\w]{0,39}$/.test(k) || typeof v !== 'string' || v.length > 100))) throw badRequest('INVALID_DATA', 'data must be a flat map of up to 10 short string values');
    if (dto.sendNow && dto.scheduledAt) throw badRequest('INVALID_REQUEST', 'Choose either sendNow or scheduledAt');
    const at = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    if (at && at.getTime() <= Date.now()) throw badRequest('INVALID_SCHEDULE', 'scheduledAt must be in the future');
    const c = await this.campaigns.save({ title: dto.title, body: dto.body, audience: dto.audience, category: dto.category ?? NotificationCategory.Marketing, status: at ? CampaignStatus.Scheduled : CampaignStatus.Draft, data: dto.data ?? null, scheduledAt: at, sentAt: null, recipientCount: 0, progressCursor: '0', createdByAdminId: adminId });
    if (dto.sendNow) return this.sendNow(c.id);
    return campaignView(c);
  }

  /** Claims the campaign atomically (so it can only be sent once) and hands delivery to the worker. */
  async sendNow(id: string) {
    const claimed = await this.campaigns.createQueryBuilder().update().set({ status: CampaignStatus.Sending }).where("id = :id AND status IN ('DRAFT', 'SCHEDULED')", { id }).execute();
    if (!claimed.affected) { if (!(await this.campaigns.exists({ where: { id } }))) throw new NotFoundException(); throw conflict('INVALID_STATE', 'This campaign has already been sent or cancelled'); }
    await this.queue.add(ENGAGEMENT_JOBS.SendCampaign, { campaignId: id }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { age: 86400 }, removeOnFail: { age: 7 * 86400 } });
    return campaignView(await this.campaigns.findOneByOrFail({ id }));
  }

  async cancel(id: string) {
    const r = await this.campaigns.createQueryBuilder().update().set({ status: CampaignStatus.Cancelled }).where("id = :id AND status IN ('DRAFT', 'SCHEDULED')", { id }).execute();
    if (!r.affected) { if (!(await this.campaigns.exists({ where: { id } }))) throw new NotFoundException(); throw conflict('INVALID_STATE', 'Only draft or scheduled campaigns can be cancelled'); }
    return campaignView(await this.campaigns.findOneByOrFail({ id }));
  }
  async list() { return (await this.campaigns.find({ order: { id: 'DESC' }, take: 100 })).map(campaignView); }
  async get(id: string) { const c = /^\d+$/.test(id) ? await this.campaigns.findOne({ where: { id } }) : null; if (!c) throw new NotFoundException(); return campaignView(c); }

  /** Worker, every minute: start every scheduled campaign whose time has come. */
  async dispatchDue(now = new Date()): Promise<number> {
    const due = await this.campaigns.find({ where: { status: CampaignStatus.Scheduled, scheduledAt: LessThanOrEqual(now) }, take: 50 });
    let started = 0;
    for (const c of due) { try { await this.sendNow(c.id); started++; } catch { /* another worker claimed it */ } }
    return started;
  }

  /**
   * Worker: fan the campaign out in batches of 500, in user-id order. Resumable (the cursor is saved per batch) and safe to
   * re-run: the in-app insert is `INSERT IGNORE` on UNIQUE(campaign, user), so a retry never duplicates anyone's notification.
   */
  async deliver(campaignId: string): Promise<{ recipients: number }> {
    const c = await this.campaigns.findOneByOrFail({ id: campaignId });
    if (c.status !== CampaignStatus.Sending) return { recipients: c.recipientCount };
    let cursor = c.progressCursor;
    let total = c.recipientCount;
    const audienceSql = c.audience === NotificationAudience.Subscribers ? 'AND EXISTS (SELECT 1 FROM entitlements e WHERE e.user_id = u.id AND e.revoked_at IS NULL AND e.starts_at <= NOW(3) AND e.ends_at > NOW(3))'
      : c.audience === NotificationAudience.NonSubscribers ? 'AND NOT EXISTS (SELECT 1 FROM entitlements e WHERE e.user_id = u.id AND e.revoked_at IS NULL AND e.starts_at <= NOW(3) AND e.ends_at > NOW(3))' : '';
    for (;;) {
      const users: { id: string; prefs: unknown }[] = await this.ds.query(`SELECT u.id AS id, p.notification_preferences AS prefs FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.status = 'ACTIVE' AND u.id > ? ${audienceSql} ORDER BY u.id LIMIT ${BATCH}`, [cursor]);
      if (!users.length) break;
      const eligible = users.filter((u) => wants(c.category, parsePrefs(u.prefs)));
      if (eligible.length) {
        await this.ds.query(`INSERT IGNORE INTO user_notifications (user_id, notification_id, title, body, category, data) VALUES ${eligible.map(() => '(?, ?, ?, ?, ?, ?)').join(',')}`, eligible.flatMap((u) => [u.id, c.id, c.title, c.body, c.category, c.data ? JSON.stringify(c.data) : null]));
        await this.pushTo(eligible.map((u) => u.id), { title: c.title, body: c.body, data: c.data ?? undefined });
      }
      cursor = users[users.length - 1].id;
      total += eligible.length;
      await this.campaigns.update(c.id, { progressCursor: cursor, recipientCount: total });
      if (users.length < BATCH) break;
    }
    await this.campaigns.update(c.id, { status: CampaignStatus.Sent, sentAt: new Date(), recipientCount: total });
    this.log.log(`Campaign ${c.id} delivered to ${total} users`);
    return { recipients: total };
  }

  /** A single transactional notice (payment received, refund issued, ...). In-app always; push best-effort. */
  async notifyUser(userId: string, n: { title: string; body: string; category: NotificationCategory; data?: Record<string, string> }): Promise<void> {
    try {
      const profile = await this.profiles.findOne({ where: { userId } });
      if (!wants(n.category, profile?.notificationPreferences)) return;
      await this.inbox.insert({ userId, notificationId: null, title: n.title.slice(0, 120), body: n.body.slice(0, 500), category: n.category, data: n.data ?? null, readAt: null });
      await this.pushTo([userId], { title: n.title, body: n.body, data: n.data });
    } catch (err) { this.log.warn({ err, userId }, 'notifyUser failed'); } // a notification problem must never break a payment
  }

  private async pushTo(userIds: string[], m: { title: string; body: string; data?: Record<string, string> }): Promise<void> {
    if (!this.push.enabled || !userIds.length) return;
    const tokens = await this.devices.createQueryBuilder('d').where('d.user_id IN (:...ids) AND d.revoked_at IS NULL', { ids: userIds }).getMany();
    for (let i = 0; i < tokens.length; i += PUSH_CONCURRENCY) {
      await Promise.all(tokens.slice(i, i + PUSH_CONCURRENCY).map(async (t) => {
        if ((await this.push.send(t.token, m)) === 'unregistered') await this.devices.update(t.id, { revokedAt: new Date() }); // uninstalled: never send to it again
      }));
    }
  }

  // ── viewer: inbox ──
  async inboxList(userId: string, cursorRaw?: string, limitRaw?: number, unreadOnly = false) {
    const limit = clampLimit(limitRaw, 20, 50);
    const cursor = decodeCursor<{ id: number }>(cursorRaw, ['id']);
    const qb = this.inbox.createQueryBuilder('n').where('n.user_id = :userId', { userId }).orderBy('n.id', 'DESC').take(limit + 1);
    if (cursor) qb.andWhere('n.id < :id', { id: cursor.id });
    if (unreadOnly) qb.andWhere('n.read_at IS NULL');
    const rows = await qb.getMany();
    const page = rows.slice(0, limit);
    return { items: page.map(inboxView), nextCursor: rows.length > limit ? encodeCursor({ id: Number(page[page.length - 1].id) }) : null };
  }
  async unreadCount(userId: string) { return { unread: await this.inbox.count({ where: { userId, readAt: IsNull() } }) }; }
  async markRead(userId: string, id: string) {
    if (!/^\d+$/.test(id)) throw new NotFoundException();
    const n = await this.inbox.findOne({ where: { id, userId } }); // owner-scoped: someone else's id is simply "not found"
    if (!n) throw new NotFoundException();
    if (!n.readAt) await this.inbox.update(n.id, { readAt: new Date() });
  }
  async readAll(userId: string) { await this.inbox.createQueryBuilder().update().set({ readAt: new Date() }).where('user_id = :userId AND read_at IS NULL', { userId }).execute(); }

  // ── viewer: devices & preferences ──
  /** A token belongs to ONE account at a time: if the same device signs in as someone else, it moves. */
  async registerDevice(userId: string, token: string, platform: DevicePlatform) {
    const existing = await this.devices.findOne({ where: { token } });
    if (existing) await this.devices.update(existing.id, { userId, platform, lastSeenAt: new Date(), revokedAt: null });
    else await this.devices.insert({ userId, token, platform, lastSeenAt: new Date(), revokedAt: null });
  }
  async removeDevice(userId: string, token: string) { await this.devices.update({ userId, token }, { revokedAt: new Date() }); }
  async getPreferences(userId: string) { const p = await this.profiles.findOneByOrFail({ userId }); return p.notificationPreferences; }
  async setPreferences(userId: string, patch: Prefs) {
    const p = await this.profiles.findOneByOrFail({ userId });
    p.notificationPreferences = { ...p.notificationPreferences, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as never;
    await this.profiles.save(p);
    return p.notificationPreferences;
  }
}
