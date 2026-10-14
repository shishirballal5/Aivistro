import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Repository } from 'typeorm';
import { contiguousEnd } from '../../common/time';
import { DomainCode } from '../../common/constants/error-codes';
import { ContentStatus, Entitlement, Episode, Series, User, UserStatus, VideoAsset, VideoStatus } from '../../database/entities/index';

export type AccessCode = typeof DomainCode.SubscriptionRequired | typeof DomainCode.SubscriptionExpired | typeof DomainCode.EpisodeNotAvailable | typeof DomainCode.VideoProcessing | typeof DomainCode.AccountSuspended;
export interface AccessDecision { allowed: boolean; code?: AccessCode; message?: string; requiresAuth?: boolean; entitledUntil?: Date }
export type VideoState = 'READY' | 'PROCESSING' | 'UNAVAILABLE';

/** Tells the entitlement check whether an episode's video can be streamed. Phase 4 replaces the default with real asset states. */
export abstract class VideoStateProvider {
  abstract stateFor(episodes: Episode[]): Promise<Map<string, VideoState>>;
}
@Injectable()
export class EpisodeVideoStateProvider extends VideoStateProvider {
  constructor(@InjectRepository(VideoAsset) private readonly assets: Repository<VideoAsset>) { super(); }

  /** READY only when the episode's CURRENT asset is READY. Uploaded/Processing => VIDEO_PROCESSING. Failed or missing => not available. */
  async stateFor(episodes: Episode[]): Promise<Map<string, VideoState>> {
    const ids = [...new Set(episodes.map((e) => e.currentAssetId).filter((x): x is string => !!x))];
    const rows = ids.length ? await this.assets.find({ where: { id: In(ids) }, select: ['id', 'status'] }) : [];
    const status = new Map(rows.map((a) => [a.id, a.status]));
    return new Map(episodes.map((e) => {
      const st = e.currentAssetId ? status.get(e.currentAssetId) : undefined;
      return [e.id, st === VideoStatus.Ready ? 'READY' : st === VideoStatus.Processing || st === VideoStatus.Uploaded ? 'PROCESSING' : 'UNAVAILABLE'] as [string, VideoState];
    }));
  }
}

const MESSAGES: Record<AccessCode, string> = {
  SUBSCRIPTION_REQUIRED: 'An active subscription is required to watch this episode',
  SUBSCRIPTION_EXPIRED: 'Your subscription has expired. Renew to keep watching.',
  EPISODE_NOT_AVAILABLE: 'This episode is not available',
  VIDEO_PROCESSING: 'This episode is still being prepared. Please check back soon.',
  ACCOUNT_SUSPENDED: 'This account is not active',
};
const deny = (code: AccessCode, extra: Partial<AccessDecision> = {}): AccessDecision => ({ allowed: false, code, message: MESSAGES[code], ...extra });

/**
 * THE one place that answers "may this person watch this episode right now?". Playback sessions, the episode list and
 * the access endpoint all call it, so the rules cannot drift apart. It is purely server-side: nothing the client sends
 * (a flag, a payment callback, a header) is consulted.
 *
 * Order matters: account status, then whether the content exists and is live (so nothing is revealed about hidden
 * content), then whether the video is ready, and only then the subscription.
 */
@Injectable()
export class EntitlementsService {
  constructor(
    @InjectRepository(Entitlement) private readonly entitlements: Repository<Entitlement>,
    @InjectRepository(Episode) private readonly episodes: Repository<Episode>,
    @InjectRepository(Series) private readonly series: Repository<Series>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly videoState: VideoStateProvider,
  ) {}

  /** The entitlement covering `at` that lasts longest, or null. Revoked or not-yet-started or ended entitlements never count. */
  activeEntitlement(userId: string, at = new Date()): Promise<Entitlement | null> {
    return this.entitlements.createQueryBuilder('e').where('e.user_id = :userId AND e.revoked_at IS NULL AND e.starts_at <= :at AND e.ends_at > :at', { userId, at }).orderBy('e.ends_at', 'DESC').getOne();
  }
  async hasEverBeenEntitled(userId: string): Promise<boolean> { return this.entitlements.exists({ where: { userId } }); }

  async checkEpisode(userId: string | null, episodeId: string, now = new Date()): Promise<AccessDecision> {
    if (!/^\d+$/.test(episodeId)) return deny(DomainCode.EpisodeNotAvailable);
    const episode = await this.episodes.findOne({ where: { id: episodeId } });
    if (!episode) return userId ? this.afterAccountCheck(userId, () => deny(DomainCode.EpisodeNotAvailable)) : deny(DomainCode.EpisodeNotAvailable);
    return (await this.decide(userId, [episode], now)).get(episode.id)!;
  }

  /** Decisions for many episodes with one entitlement lookup (used by the episode list). */
  async bulkAccess(userId: string | null, episodes: Episode[], now = new Date()): Promise<Map<string, AccessDecision>> {
    return this.decide(userId, episodes, now);
  }

  private async decide(userId: string | null, episodes: Episode[], now: Date): Promise<Map<string, AccessDecision>> {
    const result = new Map<string, AccessDecision>();
    if (userId) {
      const user = await this.users.findOne({ where: { id: userId } });
      if (!user || user.status !== UserStatus.Active) { for (const e of episodes) result.set(e.id, deny(DomainCode.AccountSuspended)); return result; }
    }
    const seriesIds = [...new Set(episodes.map((e) => e.seriesId))];
    const liveSeries = new Set(seriesIds.length ? (await this.series.createQueryBuilder('s').select('s.id', 'id').where('s.id IN (:...ids)', { ids: seriesIds }).andWhere("s.status = 'PUBLISHED' AND s.published_at IS NOT NULL AND s.published_at <= :now", { now }).getRawMany<{ id: string }>()).map((r) => String(r.id)) : []);
    const states = await this.videoState.stateFor(episodes);
    const entitlement = userId ? await this.activeEntitlement(userId, now) : null;
    const everEntitled = userId && !entitlement ? await this.hasEverBeenEntitled(userId) : false;
    const until = userId && entitlement ? contiguousEnd(await this.entitlements.find({ where: { userId, revokedAt: IsNull(), endsAt: MoreThan(now) } }), now) : null;

    for (const e of episodes) {
      const live = e.status === ContentStatus.Published && e.publishedAt !== null && e.publishedAt <= now && liveSeries.has(e.seriesId);
      if (!live) { result.set(e.id, deny(DomainCode.EpisodeNotAvailable)); continue; }
      const video = states.get(e.id) ?? 'UNAVAILABLE';
      if (video === 'PROCESSING') { result.set(e.id, deny(DomainCode.VideoProcessing)); continue; }
      if (video !== 'READY') { result.set(e.id, deny(DomainCode.EpisodeNotAvailable)); continue; }
      if (!userId) { result.set(e.id, deny(DomainCode.SubscriptionRequired, { requiresAuth: true })); continue; }
      if (entitlement) result.set(e.id, { allowed: true, entitledUntil: until ?? entitlement.endsAt });
      else result.set(e.id, deny(everEntitled ? DomainCode.SubscriptionExpired : DomainCode.SubscriptionRequired));
    }
    return result;
  }

  private async afterAccountCheck(userId: string, otherwise: () => AccessDecision): Promise<AccessDecision> {
    const user = await this.users.findOne({ where: { id: userId } });
    return !user || user.status !== UserStatus.Active ? deny(DomainCode.AccountSuspended) : otherwise();
  }
}
