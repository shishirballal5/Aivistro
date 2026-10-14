import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { conflict } from '../../common/errors';
import { clampLimit, decodeCursor, encodeCursor } from '../../common/pagination';
import { Series, Watchlist, WatchlistItem } from '../../database/entities/index';
import { CatalogService } from '../catalog/catalog.service';
import { AVAILABLE } from '../catalog/catalog.util';

export const WATCHLIST_MAX = 500;
const dup = (e: unknown) => (e as { driverError?: { code?: string } })?.driverError?.code === 'ER_DUP_ENTRY';

@Injectable()
export class WatchlistService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Watchlist) private readonly lists: Repository<Watchlist>,
    @InjectRepository(WatchlistItem) private readonly items: Repository<WatchlistItem>,
    @InjectRepository(Series) private readonly series: Repository<Series>,
    private readonly catalog: CatalogService,
  ) {}

  async list(userId: string, cursorRaw?: string, limitRaw?: number) {
    const limit = clampLimit(limitRaw, 20, 50);
    const cursor = decodeCursor<{ id: number }>(cursorRaw, ['id']);
    const wl = await this.lists.findOne({ where: { userId } });
    if (!wl) return { items: [], nextCursor: null };
    const qb = this.items.createQueryBuilder('i').innerJoin('i.series', 's').where('i.watchlist_id = :wid', { wid: wl.id }).andWhere(AVAILABLE('s'), { now: new Date() });
    if (cursor) qb.andWhere('i.id < :id', { id: cursor.id });
    const rows = await qb.orderBy('i.id', 'DESC').take(limit + 1).getMany();
    const page = rows.slice(0, limit);
    const cards = await this.catalog.cardsByIds(page.map((r) => r.seriesId));
    const added = new Map(page.map((r) => [r.seriesId, r.addedAt]));
    return { items: cards.map((c) => ({ ...c, addedAt: added.get(c.id) })), nextCursor: rows.length > limit ? encodeCursor({ id: Number(page[page.length - 1].id) }) : null };
  }

  /** Idempotent: adding something already on the list succeeds and changes nothing. Only available series can be added. */
  async add(userId: string, seriesId: string): Promise<{ inWatchlist: true }> {
    const live = /^\d+$/.test(seriesId) ? await this.series.createQueryBuilder('s').where('s.id = :seriesId', { seriesId }).andWhere(AVAILABLE('s'), { now: new Date() }).getOne() : null;
    if (!live) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Series not found' });
    let wl = await this.lists.findOne({ where: { userId } });
    if (!wl) { try { wl = await this.lists.save({ userId }); } catch (e) { if (!dup(e)) throw e; wl = await this.lists.findOneByOrFail({ userId }); } }
    if (await this.items.exists({ where: { watchlistId: wl.id, seriesId } })) return { inWatchlist: true };
    if ((await this.items.count({ where: { watchlistId: wl.id } })) >= WATCHLIST_MAX) throw conflict('WATCHLIST_FULL', `Your list can hold up to ${WATCHLIST_MAX} series`);
    try { await this.items.insert({ watchlistId: wl.id, seriesId }); } catch (e) { if (!dup(e)) throw e; } // a parallel add already did it
    return { inWatchlist: true };
  }

  async remove(userId: string, seriesId: string): Promise<void> {
    if (!/^\d+$/.test(seriesId)) return;
    const wl = await this.lists.findOne({ where: { userId } });
    if (wl) await this.items.delete({ watchlistId: wl.id, seriesId });
  }

  async has(userId: string, seriesId: string): Promise<{ inWatchlist: boolean }> {
    if (!/^\d+$/.test(seriesId)) return { inWatchlist: false };
    const wl = await this.lists.findOne({ where: { userId } });
    return { inWatchlist: !!wl && (await this.items.exists({ where: { watchlistId: wl.id, seriesId } })) };
  }
}
