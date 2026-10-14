import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { clampLimit, decodeCursor, encodeCursor, Page } from '../../common/pagination';
import { Banner, Category, Episode, Genre, HomepageSection, HomepageSectionItem, Series, SeriesCast } from '../../database/entities/index';
import { SeriesListQueryDto } from './catalog.dto';
import { AVAILABLE, escapeLike } from './catalog.util';
import { MediaUrlService } from './media-urls.service';

export interface SeriesCard {
  id: string; slug: string; title: string; synopsis: string; language: string; maturityRating: string; releaseYear: number | null;
  posterUrl: string | null; bannerUrl: string | null; featured: boolean; episodeCount: number;
  genres: { id: string; name: string; slug: string }[]; categories: { id: string; name: string; slug: string }[];
}
export interface EpisodeBase { id: string; seriesId: string; number: number; title: string; description: string | null; durationSeconds: number; thumbnailUrl: string | null; releasedAt: Date | null }

type SortKey = 'newest' | 'featured' | 'title';
const SORTS: Record<SortKey, { column: string; prop: string; dir: 'ASC' | 'DESC'; value: (s: Series) => string | number; param: (v: string | number) => unknown }> = {
  newest: { column: 's.published_at', prop: 's.publishedAt', dir: 'DESC', value: (s) => s.publishedAt!.getTime(), param: (v) => new Date(Number(v)) },
  featured: { column: 's.sort_weight', prop: 's.sortWeight', dir: 'DESC', value: (s) => s.sortWeight, param: (v) => Number(v) },
  title: { column: 's.title', prop: 's.title', dir: 'ASC', value: (s) => s.title, param: (v) => String(v) },
};

/**
 * Read side of the catalog for viewers. EVERY query is restricted to content that is published AND whose
 * publish time has passed (AVAILABLE). Drafts, scheduled, archived and not-yet-live content never appear.
 */
@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Series) private readonly series: Repository<Series>,
    @InjectRepository(Episode) private readonly episodes: Repository<Episode>,
    @InjectRepository(Genre) private readonly genres: Repository<Genre>,
    @InjectRepository(Category) private readonly categories: Repository<Category>,
    @InjectRepository(SeriesCast) private readonly cast: Repository<SeriesCast>,
    @InjectRepository(HomepageSection) private readonly sections: Repository<HomepageSection>,
    @InjectRepository(HomepageSectionItem) private readonly sectionItems: Repository<HomepageSectionItem>,
    @InjectRepository(Banner) private readonly banners: Repository<Banner>,
    private readonly urls: MediaUrlService,
  ) {}

  listGenres() { return this.genres.find({ order: { name: 'ASC' } }).then((r) => r.map((g) => ({ id: g.id, name: g.name, slug: g.slug }))); }
  listCategories() { return this.categories.find({ order: { sortOrder: 'ASC', name: 'ASC' } }).then((r) => r.map((c) => ({ id: c.id, name: c.name, slug: c.slug }))); }

  async listSeries(q: SeriesListQueryDto): Promise<Page<SeriesCard>> {
    const limit = clampLimit(q.limit, 20, 50);
    const sort = SORTS[q.sort ?? 'newest'];
    const now = new Date();
    const qb = this.series.createQueryBuilder('s').where(AVAILABLE('s'), { now });
    if (q.genre) qb.innerJoin('s.genres', 'g', 'g.slug = :genre', { genre: q.genre });
    if (q.category) qb.innerJoin('s.categories', 'c', 'c.slug = :category', { category: q.category });
    if (q.q) qb.andWhere("s.title LIKE :q ESCAPE '\\\\'", { q: `%${escapeLike(q.q)}%` });

    const cursor = decodeCursor<{ v: string | number; id: number }>(q.cursor, ['v', 'id']);
    if (cursor) {
      const op = sort.dir === 'DESC' ? '<' : '>';
      qb.andWhere(`(${sort.column} ${op} :cv OR (${sort.column} = :cv AND s.id ${op} :cid))`, { cv: sort.param(cursor.v), cid: cursor.id });
    }
    const rows = await qb.orderBy(sort.prop, sort.dir).addOrderBy('s.id', sort.dir).take(limit + 1).getMany();
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return { items: await this.cards(page), nextCursor: rows.length > limit && last ? encodeCursor({ v: sort.value(last), id: Number(last.id) }) : null };
  }

  /** Looks a series up by numeric id or slug. Anything not currently available is a 404 (existence is not revealed). */
  async requireAvailable(ref: string): Promise<Series> {
    const qb = this.series.createQueryBuilder('s').where(AVAILABLE('s'), { now: new Date() });
    if (/^\d+$/.test(ref)) qb.andWhere('s.id = :ref', { ref }); else qb.andWhere('s.slug = :ref', { ref });
    const s = await qb.getOne();
    if (!s) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Series not found' });
    return s;
  }

  /** Cards for specific series, in the order given, silently dropping anything that is not currently available. */
  async cardsByIds(ids: string[]): Promise<SeriesCard[]> {
    if (!ids.length) return [];
    const live = await this.series.createQueryBuilder('s').where('s.id IN (:...ids)', { ids }).andWhere(AVAILABLE('s'), { now: new Date() }).getMany();
    const byId = new Map(live.map((s) => [s.id, s]));
    return this.cards(ids.map((id) => byId.get(id)).filter((s): s is Series => !!s));
  }

  async getSeries(ref: string) {
    const s = await this.requireAvailable(ref);
    const [card] = await this.cards([s]);
    const cast = await this.cast.find({ where: { seriesId: s.id }, relations: { castMember: true }, order: { billingOrder: 'ASC', id: 'ASC' } });
    return { ...card, cast: cast.map((c) => ({ id: c.castMember.id, name: c.castMember.name, roleName: c.roleName, photoUrl: this.urls.imageUrl(c.castMember.photoKey) })) };
  }

  /** Stable order by episode number; keyset-paginated so inserts during paging never duplicate or skip rows. */
  async listEpisodes(ref: string, cursorRaw: string | undefined, limitRaw: number | undefined): Promise<{ series: Series; episodes: Episode[]; nextCursor: string | null }> {
    const series = await this.requireAvailable(ref);
    const limit = clampLimit(limitRaw, 10, 50);
    const cursor = decodeCursor<{ n: number }>(cursorRaw, ['n']);
    const qb = this.episodes.createQueryBuilder('e').where('e.series_id = :sid', { sid: series.id }).andWhere(AVAILABLE('e'), { now: new Date() });
    if (cursor) qb.andWhere('e.number > :n', { n: cursor.n });
    const rows = await qb.orderBy('e.number', 'ASC').take(limit + 1).getMany();
    const page = rows.slice(0, limit);
    return { series, episodes: page, nextCursor: rows.length > limit ? encodeCursor({ n: page[page.length - 1].number }) : null };
  }

  episodeBase(e: Episode): EpisodeBase {
    return { id: e.id, seriesId: e.seriesId, number: e.number, title: e.title, description: e.description, durationSeconds: e.durationSeconds, thumbnailUrl: this.urls.imageUrl(e.thumbnailKey), releasedAt: e.publishedAt };
  }

  async home() {
    const now = new Date();
    const banners = await this.banners.createQueryBuilder('b').leftJoinAndSelect('b.series', 's')
      .where('b.active = 1').andWhere('(b.start_at IS NULL OR b.start_at <= :now)', { now }).andWhere('(b.end_at IS NULL OR b.end_at > :now)', { now })
      .andWhere(`(b.series_id IS NULL OR (${AVAILABLE('s')}))`, { now }).orderBy('b.sortOrder', 'ASC').addOrderBy('b.id', 'ASC').getMany();

    const sections = await this.sections.find({ where: { active: true }, order: { sortOrder: 'ASC', id: 'ASC' } });
    const result = [];
    for (const section of sections) {
      const items = await this.sectionItems.createQueryBuilder('i').innerJoinAndSelect('i.series', 's').where('i.section_id = :sid', { sid: section.id })
        .andWhere(AVAILABLE('s'), { now }).orderBy('i.sortOrder', 'ASC').addOrderBy('i.id', 'ASC').take(30).getMany();
      if (items.length) result.push({ key: section.key, title: section.title, type: section.type, items: await this.cards(items.map((i) => i.series)) });
    }
    return {
      banners: banners.map((b) => ({ id: b.id, title: b.title, imageUrl: this.urls.imageUrl(b.imageKey), seriesId: b.seriesId, linkUrl: b.linkUrl })),
      sections: result,
    };
  }

  private async cards(list: Series[]): Promise<SeriesCard[]> {
    if (!list.length) return [];
    const ids = list.map((s) => s.id);
    const full = await this.series.find({ where: { id: In(ids) }, relations: { genres: true, categories: true } });
    const byId = new Map(full.map((s) => [s.id, s]));
    const counts = await this.episodes.createQueryBuilder('e').select('e.series_id', 'sid').addSelect('COUNT(*)', 'n').where('e.series_id IN (:...ids)', { ids }).andWhere(AVAILABLE('e'), { now: new Date() }).groupBy('e.series_id').getRawMany<{ sid: string; n: string }>();
    const countBy = new Map(counts.map((c) => [String(c.sid), Number(c.n)]));
    return ids.map((id) => {
      const s = byId.get(id)!;
      return {
        id: s.id, slug: s.slug, title: s.title, synopsis: s.synopsis, language: s.language, maturityRating: s.maturityRating, releaseYear: s.releaseYear,
        posterUrl: this.urls.imageUrl(s.posterKey), bannerUrl: this.urls.imageUrl(s.bannerKey), featured: s.isFeatured, episodeCount: countBy.get(id) ?? 0,
        genres: s.genres.map((g) => ({ id: g.id, name: g.name, slug: g.slug })), categories: s.categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
      };
    });
  }
}
