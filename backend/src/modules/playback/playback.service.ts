import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, MoreThan, Repository } from 'typeorm';
import { ClientInfo } from '../../common/decorators/params';
import { DomainCode } from '../../common/constants/error-codes';
import { randomToken, sha256Hex } from '../../common/crypto/crypto.util';
import { badRequest, DomainException, unauthorized } from '../../common/errors';
import { addSeconds } from '../../common/time';
import { mediaConfig } from '../../config/media.config';
import { Episode, PlaybackSession, User, UserStatus, VideoAsset, VideoStatus } from '../../database/entities/index';
import { AnalyticsService } from '../analytics/analytics.service';
import { AccessDecision, EntitlementsService } from '../entitlements/entitlements.service';
import { ProgressService } from '../watch-history/progress.service';

export const HEARTBEAT_INTERVAL_SECONDS = 30;

/** Maps an access denial to an HTTP error carrying the stable denial code. */
export function denialError(d: AccessDecision): DomainException {
  const status = d.code === DomainCode.EpisodeNotAvailable ? HttpStatus.NOT_FOUND : d.code === DomainCode.VideoProcessing ? HttpStatus.CONFLICT : HttpStatus.FORBIDDEN;
  return new DomainException(status, d.code ?? DomainCode.EpisodeNotAvailable, d.message ?? 'Not available');
}

/** Ends every live playback session of a user immediately (suspension, refund, ...). */
export async function revokePlaybackSessions(em: EntityManager, userId: string, reason: string): Promise<number> {
  const r = await em.getRepository(PlaybackSession).createQueryBuilder().update().set({ revokedAt: new Date(), revokedReason: reason }).where('user_id = :userId AND revoked_at IS NULL AND ended_at IS NULL', { userId }).execute();
  return r.affected ?? 0;
}

@Injectable()
export class PlaybackService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(PlaybackSession) private readonly sessions: Repository<PlaybackSession>,
    @InjectRepository(VideoAsset) private readonly assets: Repository<VideoAsset>,
    @InjectRepository(Episode) private readonly episodes: Repository<Episode>,
    private readonly entitlements: EntitlementsService,
    private readonly progress: ProgressService,
    private readonly analytics: AnalyticsService,
    @Inject(mediaConfig.KEY) private readonly cfg: ConfigType<typeof mediaConfig>,
  ) {}

  /**
   * THE gate to protected video. Every call re-checks, from scratch and on the server: account status, that the episode is live,
   * that its video is READY, and that the user holds a valid subscription. Only then is a temporary token issued.
   * Having seen the episode in a list, or a previous session, grants nothing.
   */
  async createSession(userId: string, episodeId: string, client: ClientInfo) {
    const decision = await this.entitlements.checkEpisode(userId, episodeId);
    if (!decision.allowed) throw denialError(decision);
    const episode = await this.episodes.findOneOrFail({ where: { id: episodeId } });
    const asset = episode.currentAssetId ? await this.assets.findOne({ where: { id: episode.currentAssetId } }) : null;
    if (!asset || asset.status !== VideoStatus.Ready || !asset.hlsPrefix) throw denialError({ allowed: false, code: DomainCode.EpisodeNotAvailable, message: 'This episode is not available' });

    const token = randomToken(32);
    const now = new Date();
    const { session, replaced } = await this.ds.transaction(async (em) => {
      await em.getRepository(User).findOne({ where: { id: userId }, lock: { mode: 'pessimistic_write' } }); // serialise parallel "play" taps by one user
      const live = await em.getRepository(PlaybackSession).find({ where: { userId, endedAt: IsNull(), revokedAt: IsNull(), expiresAt: MoreThan(now) }, order: { lastHeartbeatAt: 'ASC' } });
      const excess = Math.max(0, live.length - (this.cfg.maxConcurrentStreams - 1));
      for (const old of live.slice(0, excess)) await em.getRepository(PlaybackSession).update(old.id, { revokedAt: now, revokedReason: 'concurrent_limit' }); // newest wins
      const s = await em.getRepository(PlaybackSession).save({
        userId, episodeId, assetId: asset.id, tokenHash: sha256Hex(token), expiresAt: addSeconds(now, this.cfg.sessionTtlSeconds), hardExpiresAt: addSeconds(now, this.cfg.sessionMaxHours * 3600),
        lastHeartbeatAt: now, positionSeconds: 0, ipAddress: client.ip, userAgent: client.userAgent, endedAt: null, revokedAt: null, revokedReason: null,
      });
      return { session: s, replaced: excess };
    });
    this.analytics.track({ userId, type: 'playback_started', entityType: 'episode', entityId: episodeId, properties: { series_id: episode.seriesId } });
    return {
      sessionId: session.id,
      manifestUrl: `/api/v1/media/hls/${token}/master.m3u8`,
      expiresAt: session.expiresAt,
      heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
      episode: { id: episode.id, number: episode.number, title: episode.title, durationSeconds: asset.durationSeconds },
      endedOtherStreams: replaced,
    };
  }

  /** Proves the viewer is still there AND still entitled. A subscription that ended mid-episode stops the stream at the next beat. */
  async heartbeat(userId: string, sessionId: string, positionSeconds?: number) {
    const s = await this.ownSession(userId, sessionId);
    this.assertLive(s);
    const decision = await this.entitlements.checkEpisode(userId, s.episodeId);
    if (!decision.allowed) {
      await this.sessions.update(s.id, { revokedAt: new Date(), revokedReason: decision.code ?? 'not_entitled' });
      throw denialError(decision);
    }
    const asset = await this.assets.findOneOrFail({ where: { id: s.assetId } });
    if (positionSeconds !== undefined && positionSeconds > (asset.durationSeconds ?? 0) + 5) throw badRequest('INVALID_POSITION', 'Position is beyond the end of the episode');
    const now = new Date();
    const expiresAt = new Date(Math.min(addSeconds(now, this.cfg.sessionTtlSeconds).getTime(), s.hardExpiresAt.getTime()));
    await this.sessions.update(s.id, { lastHeartbeatAt: now, expiresAt, ...(positionSeconds !== undefined ? { positionSeconds } : {}) });
    if (positionSeconds !== undefined) { const ep = await this.episodes.findOneOrFail({ where: { id: s.episodeId } }); await this.progress.enqueue(userId, s.episodeId, ep.seriesId, positionSeconds, asset.durationSeconds ?? 0); }
    return { ok: true, expiresAt, hardExpiresAt: s.hardExpiresAt };
  }

  async end(userId: string, sessionId: string): Promise<void> {
    const s = await this.ownSession(userId, sessionId);
    if (!s.endedAt) await this.sessions.update(s.id, { endedAt: new Date() });
    await this.progress.flushUser(userId); // the position at the moment they stopped is saved immediately
  }

  /** Used by the media endpoints on EVERY request (playlist, key, segment). Invalid, expired, ended, revoked or suspended-user tokens all look identical. */
  async authorizeToken(token: string): Promise<{ session: PlaybackSession; asset: VideoAsset }> {
    const fail = () => unauthorized('PLAYBACK_TOKEN_INVALID', 'This playback link is no longer valid');
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) throw fail();
    const session = await this.sessions.findOne({ where: { tokenHash: sha256Hex(token) } });
    const now = new Date();
    if (!session || session.revokedAt || session.endedAt || session.expiresAt <= now || session.hardExpiresAt <= now) throw fail();
    const user = await this.ds.getRepository(User).findOne({ where: { id: session.userId }, select: ['id', 'status'] });
    if (!user || user.status !== UserStatus.Active) throw fail();
    const asset = await this.assets.findOne({ where: { id: session.assetId } });
    if (!asset || asset.status === VideoStatus.Failed || !asset.hlsPrefix || !asset.variants) throw fail();
    return { session, asset };
  }

  private async ownSession(userId: string, sessionId: string): Promise<PlaybackSession> {
    if (!/^\d+$/.test(sessionId)) throw new NotFoundException();
    const s = await this.sessions.findOne({ where: { id: sessionId, userId } }); // owner-scoped: someone else's id is simply "not found"
    if (!s) throw new NotFoundException();
    return s;
  }
  private assertLive(s: PlaybackSession): void {
    const now = new Date();
    if (s.revokedAt) throw new DomainException(HttpStatus.CONFLICT, 'PLAYBACK_SESSION_REVOKED', s.revokedReason === 'concurrent_limit' ? 'Your account started playing on another device' : 'This playback session was ended');
    if (s.endedAt) throw new DomainException(HttpStatus.CONFLICT, 'PLAYBACK_SESSION_ENDED', 'This playback session has ended');
    if (s.expiresAt <= now || s.hardExpiresAt <= now) throw new DomainException(HttpStatus.CONFLICT, 'PLAYBACK_SESSION_EXPIRED', 'This playback session has expired. Start a new one.');
  }
}
