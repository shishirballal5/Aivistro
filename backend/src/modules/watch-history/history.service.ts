import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { clampLimit, decodeCursor, encodeCursor } from '../../common/pagination';
import { Episode, WatchHistory, WatchProgress } from '../../database/entities/index';
import { CatalogService } from '../catalog/catalog.service';
import { AVAILABLE } from '../catalog/catalog.util';
import { ProgressService } from './progress.service';

@Injectable()
export class HistoryService {
  constructor(
    @InjectRepository(WatchHistory) private readonly history: Repository<WatchHistory>,
    @InjectRepository(WatchProgress) private readonly progress: Repository<WatchProgress>,
    @InjectRepository(Episode) private readonly episodes: Repository<Episode>,
    private readonly catalog: CatalogService,
    private readonly progressSvc: ProgressService,
  ) {}

  /**
   * One card per series the user is part-way through: resume the unfinished episode, or offer the next one if they finished it.
   * Series that are no longer available, or that the user has fully caught up on, are left out.
   */
  async continueWatching(userId: string, cursorRaw?: string, limitRaw?: number) {
    await this.progressSvc.flushUser(userId);
    const limit = clampLimit(limitRaw, 10, 30);
    const cursor = decodeCursor<{ t: number; id: number }>(cursorRaw, ['t', 'id']);
    const now = new Date();
    const qb = this.history.createQueryBuilder('h').innerJoin('h.series', 's').where('h.user_id = :userId', { userId }).andWhere(AVAILABLE('s'), { now });
    if (cursor) qb.andWhere('(h.last_watched_at < :t OR (h.last_watched_at = :t AND h.id < :id))', { t: new Date(cursor.t), id: cursor.id });
    const rows = await qb.orderBy('h.lastWatchedAt', 'DESC').addOrderBy('h.id', 'DESC').take(limit + 1).getMany();
    const page = rows.slice(0, limit);

    const cards = new Map((await this.catalog.cardsByIds(page.map((r) => r.seriesId))).map((c) => [c.id, c]));
    const items = [];
    for (const h of page) {
      const card = cards.get(h.seriesId);
      if (!card) continue;
      const liveEpisode = (qbE: ReturnType<Repository<Episode>['createQueryBuilder']>) => qbE.andWhere(AVAILABLE('e'), { now });
      let target: Episode | null; let kind: 'RESUME' | 'NEXT';
      if (!h.lastCompleted) { target = await liveEpisode(this.episodes.createQueryBuilder('e').where('e.id = :id', { id: h.lastEpisodeId })).getOne(); kind = 'RESUME'; }
      else { target = await liveEpisode(this.episodes.createQueryBuilder('e').where('e.series_id = :sid AND e.number > :n', { sid: h.seriesId, n: h.lastEpisodeNumber })).orderBy('e.number', 'ASC').getOne(); kind = 'NEXT'; }
      if (!target) continue;
      const position = kind === 'RESUME' ? h.lastPositionSeconds : 0;
      items.push({
        series: { id: card.id, slug: card.slug, title: card.title, posterUrl: card.posterUrl },
        episode: this.catalog.episodeBase(target), kind, positionSeconds: position, durationSeconds: target.durationSeconds,
        progressPercent: target.durationSeconds ? Math.min(100, Math.round((position / target.durationSeconds) * 100)) : 0,
        episodesCompleted: h.episodesCompleted, lastWatchedAt: h.lastWatchedAt,
      });
    }
    const last = page[page.length - 1];
    return { items, nextCursor: rows.length > limit && last ? encodeCursor({ t: last.lastWatchedAt.getTime(), id: Number(last.id) }) : null };
  }

  /** Every episode the user has watched, newest first (only content that is still available). */
  async episodeHistory(userId: string, cursorRaw?: string, limitRaw?: number) {
    await this.progressSvc.flushUser(userId);
    const limit = clampLimit(limitRaw, 20, 50);
    const cursor = decodeCursor<{ t: number; id: number }>(cursorRaw, ['t', 'id']);
    const qb = this.progress.createQueryBuilder('p').innerJoinAndSelect('p.episode', 'e').innerJoin('e.series', 's').where('p.user_id = :userId', { userId }).andWhere(AVAILABLE('e'), { now: new Date() }).andWhere("s.status = 'PUBLISHED'");
    if (cursor) qb.andWhere('(p.last_watched_at < :t OR (p.last_watched_at = :t AND p.id < :id))', { t: new Date(cursor.t), id: cursor.id });
    const rows = await qb.orderBy('p.lastWatchedAt', 'DESC').addOrderBy('p.id', 'DESC').take(limit + 1).getMany();
    const page = rows.slice(0, limit);
    const cards = new Map((await this.catalog.cardsByIds([...new Set(page.map((p) => p.seriesId))])).map((c) => [c.id, c]));
    const last = page[page.length - 1];
    return {
      items: page.filter((p) => cards.has(p.seriesId)).map((p) => ({ episode: this.catalog.episodeBase(p.episode), series: { id: p.seriesId, title: cards.get(p.seriesId)!.title, posterUrl: cards.get(p.seriesId)!.posterUrl }, positionSeconds: p.positionSeconds, durationSeconds: p.durationSeconds, completed: p.completed, lastWatchedAt: p.lastWatchedAt })),
      nextCursor: rows.length > limit && last ? encodeCursor({ t: last.lastWatchedAt.getTime(), id: Number(last.id) }) : null,
    };
  }

  async positionFor(userId: string, episodeId: string) {
    await this.progressSvc.flushUser(userId);
    if (!/^\d+$/.test(episodeId)) throw new NotFoundException();
    const p = await this.progress.findOne({ where: { userId, episodeId } });
    return { episodeId, positionSeconds: p?.positionSeconds ?? 0, durationSeconds: p?.durationSeconds ?? 0, completed: p?.completed ?? false, lastWatchedAt: p?.lastWatchedAt ?? null };
  }

  /** Privacy controls: the user can remove a series (or everything) from their history. */
  async removeSeries(userId: string, seriesId: string): Promise<void> {
    await this.progressSvc.flushUser(userId);
    if (!/^\d+$/.test(seriesId)) throw new NotFoundException();
    await this.progress.delete({ userId, seriesId });
    await this.history.delete({ userId, seriesId });
  }
  async clearAll(userId: string): Promise<void> {
    await this.progressSvc.flushUser(userId);
    await this.progress.delete({ userId });
    await this.history.delete({ userId });
  }
}
