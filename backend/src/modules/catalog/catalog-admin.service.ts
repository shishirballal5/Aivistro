import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { DomainCode } from '../../common/constants/error-codes';
import { badRequest, conflict } from '../../common/errors';
import { clampLimit, decodeCursor, encodeCursor } from '../../common/pagination';
import { Banner, CastMember, Category, ContentStatus, Episode, Genre, HomepageSection, HomepageSectionItem, Series, SeriesCast } from '../../database/entities/index';
import { AdminSeriesQueryDto, BannerDto, CastMemberDto, CreateEpisodeDto, CreateSeriesDto, HomepageSectionDto, NameDto, UpdateEpisodeDto, UpdateSeriesDto } from './catalog.dto';
import { escapeLike, slugify, uniqueSlug } from './catalog.util';
import { MediaUrlService } from './media-urls.service';
import { PublishPolicy } from './publish.policy';

type Action = 'publish' | 'schedule' | 'unpublish' | 'archive' | 'restore';
const ALLOWED: Record<ContentStatus, ContentStatus[]> = {
  [ContentStatus.Draft]: [ContentStatus.Published, ContentStatus.Scheduled, ContentStatus.Archived],
  [ContentStatus.Scheduled]: [ContentStatus.Published, ContentStatus.Draft, ContentStatus.Archived],
  [ContentStatus.Published]: [ContentStatus.Draft, ContentStatus.Archived],
  [ContentStatus.Archived]: [ContentStatus.Draft],
};
const TARGET: Record<Action, ContentStatus> = { publish: ContentStatus.Published, schedule: ContentStatus.Scheduled, unpublish: ContentStatus.Draft, archive: ContentStatus.Archived, restore: ContentStatus.Draft };

function assertTransition(from: ContentStatus, action: Action): ContentStatus {
  const to = TARGET[action];
  if (!ALLOWED[from].includes(to)) throw conflict(DomainCode.InvalidStateTransition, `Cannot ${action} content that is ${from}`);
  return to;
}

@Injectable()
export class CatalogAdminService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Series) private readonly series: Repository<Series>,
    @InjectRepository(Episode) private readonly episodes: Repository<Episode>,
    @InjectRepository(Genre) private readonly genres: Repository<Genre>,
    @InjectRepository(Category) private readonly categories: Repository<Category>,
    @InjectRepository(CastMember) private readonly castMembers: Repository<CastMember>,
    @InjectRepository(HomepageSection) private readonly sections: Repository<HomepageSection>,
    @InjectRepository(Banner) private readonly banners: Repository<Banner>,
    private readonly policy: PublishPolicy,
    private readonly urls: MediaUrlService,
  ) {}

  // ── genres / categories / cast ──
  async createNamed(kind: 'genre' | 'category', dto: NameDto) {
    const repo = (kind === 'genre' ? this.genres : this.categories) as Repository<Genre & Category>;
    const slug = slugify(dto.name);
    if (await repo.exists({ where: [{ slug }, { name: dto.name }] })) throw conflict('NAME_TAKEN', `A ${kind} with this name already exists`);
    return repo.save({ name: dto.name, slug, ...(kind === 'category' ? { sortOrder: dto.sortOrder ?? 0 } : {}) });
  }
  async updateNamed(kind: 'genre' | 'category', id: string, dto: NameDto) {
    const repo = (kind === 'genre' ? this.genres : this.categories) as Repository<Genre & Category>;
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException();
    const slug = slugify(dto.name);
    const clash = await repo.findOne({ where: [{ slug }, { name: dto.name }] });
    if (clash && clash.id !== id) throw conflict('NAME_TAKEN', `A ${kind} with this name already exists`);
    Object.assign(row, { name: dto.name, slug, ...(kind === 'category' && dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}) });
    return repo.save(row);
  }
  async deleteNamed(kind: 'genre' | 'category', id: string) {
    const repo = (kind === 'genre' ? this.genres : this.categories) as Repository<Genre & Category>;
    const r = await repo.delete({ id });
    if (!r.affected) throw new NotFoundException();
  }
  createCast(dto: CastMemberDto) { return this.castMembers.save({ name: dto.name, bio: dto.bio ?? null, photoKey: dto.photoKey ?? null }); }
  async updateCast(id: string, dto: CastMemberDto) {
    const row = await this.castMembers.findOne({ where: { id } });
    if (!row) throw new NotFoundException();
    return this.castMembers.save({ ...row, name: dto.name, bio: dto.bio ?? row.bio, photoKey: dto.photoKey === undefined ? row.photoKey : dto.photoKey });
  }
  listCast() { return this.castMembers.find({ order: { name: 'ASC' }, take: 500 }); }

  // ── series ──
  async listSeries(q: AdminSeriesQueryDto) {
    const limit = clampLimit(q.limit);
    const cursor = decodeCursor<{ id: number }>(q.cursor, ['id']);
    const qb = this.series.createQueryBuilder('s').orderBy('s.id', 'DESC').take(limit + 1);
    if (cursor) qb.andWhere('s.id < :id', { id: cursor.id });
    if (q.status) qb.andWhere('s.status = :status', { status: q.status });
    if (q.q) qb.andWhere("s.title LIKE :q ESCAPE '\\\\'", { q: `%${escapeLike(q.q)}%` });
    const rows = await qb.getMany();
    const page = rows.slice(0, limit);
    return { items: page.map((s) => this.seriesView(s)), nextCursor: rows.length > limit ? encodeCursor({ id: Number(page[page.length - 1].id) }) : null };
  }

  async getSeries(id: string) {
    const s = await this.series.findOne({ where: { id }, relations: { genres: true, categories: true } });
    if (!s) throw new NotFoundException();
    const cast = await this.ds.getRepository(SeriesCast).find({ where: { seriesId: id }, relations: { castMember: true }, order: { billingOrder: 'ASC' } });
    return { ...this.seriesView(s), genres: s.genres, categories: s.categories, cast: cast.map((c) => ({ castMemberId: c.castMemberId, name: c.castMember.name, roleName: c.roleName, billingOrder: c.billingOrder })) };
  }

  async createSeries(dto: CreateSeriesDto) {
    const id = await this.ds.transaction(async (em) => {
      const slug = await uniqueSlug(em.getRepository(Series) as never, dto.title);
      const s = await em.getRepository(Series).save({
        slug, title: dto.title, synopsis: dto.synopsis, language: dto.language ?? 'hi', maturityRating: dto.maturityRating ?? '16+', releaseYear: dto.releaseYear ?? null,
        posterKey: dto.posterKey ?? null, bannerKey: dto.bannerKey ?? null, status: ContentStatus.Draft, publishAt: null, publishedAt: null, sortWeight: dto.sortWeight ?? 0, isFeatured: dto.isFeatured ?? false,
        genres: await this.loadByIds(this.genres, dto.genreIds, 'genre'), categories: await this.loadByIds(this.categories, dto.categoryIds, 'category'),
      });
      if (dto.cast) await this.replaceCast(em.getRepository(SeriesCast), s.id, dto.cast);
      return s.id;
    });
    return this.getSeries(id);
  }

  async updateSeries(id: string, dto: UpdateSeriesDto) {
    await this.ds.transaction(async (em) => {
      const s = await em.getRepository(Series).findOne({ where: { id }, relations: { genres: true, categories: true } });
      if (!s) throw new NotFoundException();
      for (const k of ['title', 'synopsis', 'language', 'maturityRating', 'releaseYear', 'posterKey', 'bannerKey', 'sortWeight', 'isFeatured'] as const) if (dto[k] !== undefined) (s as unknown as Record<string, unknown>)[k] = dto[k];
      if (dto.genreIds) s.genres = await this.loadByIds(this.genres, dto.genreIds, 'genre');
      if (dto.categoryIds) s.categories = await this.loadByIds(this.categories, dto.categoryIds, 'category');
      await em.getRepository(Series).save(s);
      if (dto.cast) await this.replaceCast(em.getRepository(SeriesCast), id, dto.cast);
    });
    return this.getSeries(id);
  }

  async deleteSeries(id: string) {
    const s = await this.series.findOne({ where: { id } });
    if (!s) throw new NotFoundException();
    if (s.status !== ContentStatus.Draft) throw conflict(DomainCode.InvalidStateTransition, 'Only draft series can be deleted. Archive it instead.');
    if (await this.episodes.exists({ where: { seriesId: id } })) throw conflict(DomainCode.InvalidStateTransition, 'Delete or move its episodes first, or archive the series.');
    await this.series.delete({ id });
  }

  async transitionSeries(id: string, action: Action, publishAt?: string) {
    const s = await this.series.findOne({ where: { id } });
    if (!s) throw new NotFoundException();
    const to = assertTransition(s.status, action);
    const now = new Date();
    if (to === ContentStatus.Published || to === ContentStatus.Scheduled) await this.policy.assertSeriesPublishable(s);
    const patch = this.patchFor(to, action, publishAt, now, s.publishedAt);
    await this.series.update(id, patch);
    return this.seriesView({ ...s, ...patch });
  }

  // ── episodes ──
  async listEpisodes(seriesId: string) {
    if (!(await this.series.exists({ where: { id: seriesId } }))) throw new NotFoundException();
    return (await this.episodes.find({ where: { seriesId }, order: { number: 'ASC' } })).map((e) => this.episodeView(e));
  }
  /**
   * Atomic reorder: numbers become 1..n in the given order. The series row is locked first so two concurrent reorders queue up
   * instead of interleaving. (series_id, number) is unique, so episodes are first parked above every target number, then placed.
   * Status, schedule and video are untouched; only `number` changes.
   */
  async reorderEpisodes(seriesId: string, episodeIds: string[]) {
    await this.ds.transaction(async (em) => {
      if (!(await em.getRepository(Series).findOne({ where: { id: seriesId }, lock: { mode: 'pessimistic_write' } }))) throw new NotFoundException();
      const rows = await em.getRepository(Episode).find({ where: { seriesId }, select: { id: true, number: true }, lock: { mode: 'pessimistic_write' } });
      const have = new Set(rows.map((r) => r.id));
      if (new Set(episodeIds).size !== episodeIds.length) throw badRequest('INVALID_EPISODE_LIST', 'The list contains the same episode more than once');
      const missing = rows.filter((r) => !episodeIds.includes(r.id)).length;
      const extra = episodeIds.filter((i) => !have.has(i)).length;
      if (missing || extra) throw badRequest('INVALID_EPISODE_LIST', `The list must contain exactly the episodes of this series (${missing} missing, ${extra} not in this series)`);
      if (!rows.length) return;
      const offset = Math.max(...rows.map((r) => r.number)) + rows.length + 1;
      await em.query('UPDATE episodes SET number = number + ? WHERE series_id = ?', [offset, seriesId]);
      for (let i = 0; i < episodeIds.length; i++) await em.query('UPDATE episodes SET number = ? WHERE id = ? AND series_id = ?', [i + 1, episodeIds[i], seriesId]);
    });
    return this.listEpisodes(seriesId);
  }
  async getEpisode(id: string) { return this.episodeView(await this.requireEpisode(id)); }

  async createEpisode(seriesId: string, dto: CreateEpisodeDto) {
    if (!(await this.series.exists({ where: { id: seriesId } }))) throw new NotFoundException();
    return this.ds.transaction(async (em) => {
      const repo = em.getRepository(Episode);
      const max = await repo.createQueryBuilder('e').select('COALESCE(MAX(e.number), 0)', 'm').where('e.series_id = :seriesId', { seriesId }).getRawOne<{ m: string }>();
      const number = dto.number ?? Number(max?.m ?? 0) + 1;
      if (await repo.exists({ where: { seriesId, number } })) throw conflict('EPISODE_NUMBER_TAKEN', `Episode ${number} already exists in this series`);
      return this.episodeView(await repo.save({ seriesId, number, title: dto.title, description: dto.description ?? null, thumbnailKey: dto.thumbnailKey ?? null, durationSeconds: 0, status: ContentStatus.Draft, publishAt: null, publishedAt: null, currentAssetId: null }));
    });
  }

  async updateEpisode(id: string, dto: UpdateEpisodeDto) {
    const e = await this.requireEpisode(id);
    if (dto.number !== undefined && dto.number !== e.number && (await this.episodes.exists({ where: { seriesId: e.seriesId, number: dto.number } }))) throw conflict('EPISODE_NUMBER_TAKEN', `Episode ${dto.number} already exists in this series`);
    for (const k of ['number', 'title', 'description', 'thumbnailKey'] as const) if (dto[k] !== undefined) (e as unknown as Record<string, unknown>)[k] = dto[k];
    return this.episodeView(await this.episodes.save(e));
  }

  async deleteEpisode(id: string) {
    const e = await this.requireEpisode(id);
    if (e.status !== ContentStatus.Draft || e.currentAssetId) throw conflict(DomainCode.InvalidStateTransition, 'Only draft episodes without a video can be deleted. Archive it instead.');
    await this.episodes.delete({ id });
  }

  async transitionEpisode(id: string, action: Action, publishAt?: string) {
    const e = await this.requireEpisode(id);
    const to = assertTransition(e.status, action);
    const now = new Date();
    if (to === ContentStatus.Published || to === ContentStatus.Scheduled) await this.policy.assertEpisodePublishable(e);
    const patch = this.patchFor(to, action, publishAt, now, e.publishedAt);
    await this.episodes.update(id, patch);
    return this.episodeView({ ...e, ...patch });
  }

  /** Called every minute by the worker: scheduled content whose time has come goes live. Safe to run concurrently. */
  async publishDue(now = new Date()): Promise<{ series: number; episodes: number }> {
    const flip = async (repo: Repository<Series | Episode>) => (await repo.createQueryBuilder().update().set({ status: ContentStatus.Published, publishedAt: () => 'publish_at' }).where("status = 'SCHEDULED' AND publish_at <= :now", { now }).execute()).affected ?? 0;
    return { episodes: await flip(this.episodes as Repository<Series | Episode>), series: await flip(this.series as Repository<Series | Episode>) };
  }

  // ── homepage ──
  async listSections() {
    const sections = await this.sections.find({ order: { sortOrder: 'ASC', id: 'ASC' } });
    const items = await this.ds.getRepository(HomepageSectionItem).find({ order: { sortOrder: 'ASC', id: 'ASC' } });
    return sections.map((s) => ({ ...s, seriesIds: items.filter((i) => i.sectionId === s.id).map((i) => i.seriesId) }));
  }
  async saveSection(dto: HomepageSectionDto, id?: string) {
    const ids = [...new Set(dto.seriesIds)];
    if (ids.length && (await this.series.count({ where: { id: In(ids) } })) !== ids.length) throw badRequest('UNKNOWN_SERIES', 'One or more series do not exist');
    const savedId = await this.ds.transaction(async (em) => {
      const repo = em.getRepository(HomepageSection);
      let section = id ? await repo.findOne({ where: { id } }) : null;
      if (id && !section) throw new NotFoundException();
      const clash = await repo.findOne({ where: { key: dto.key } });
      if (clash && clash.id !== id) throw conflict('KEY_TAKEN', 'A section with this key already exists');
      section = await repo.save({ ...(section ?? {}), key: dto.key, title: dto.title, type: dto.type, sortOrder: dto.sortOrder ?? section?.sortOrder ?? 0, active: dto.active ?? section?.active ?? true });
      await em.getRepository(HomepageSectionItem).delete({ sectionId: section.id });
      if (ids.length) await em.getRepository(HomepageSectionItem).insert(ids.map((seriesId, i) => ({ sectionId: section!.id, seriesId, sortOrder: i })));
      return section.id;
    });
    return (await this.listSections()).find((s) => s.id === savedId);
  }
  async deleteSection(id: string) { const r = await this.sections.delete({ id }); if (!r.affected) throw new NotFoundException(); }

  listBanners() { return this.banners.find({ order: { sortOrder: 'ASC', id: 'ASC' } }).then((r) => r.map((b) => ({ ...b, imageUrl: this.urls.imageUrl(b.imageKey) }))); }
  async saveBanner(dto: BannerDto, id?: string) {
    if (dto.seriesId && !(await this.series.exists({ where: { id: dto.seriesId } }))) throw badRequest('UNKNOWN_SERIES', 'Series does not exist');
    if (dto.startAt && dto.endAt && new Date(dto.endAt) <= new Date(dto.startAt)) throw badRequest('INVALID_WINDOW', 'endAt must be after startAt');
    const existing = id ? await this.banners.findOne({ where: { id } }) : null;
    if (id && !existing) throw new NotFoundException();
    return this.banners.save({ ...(existing ?? {}), title: dto.title, imageKey: dto.imageKey, seriesId: dto.seriesId ?? null, linkUrl: dto.linkUrl ?? null, active: dto.active ?? existing?.active ?? true, startAt: dto.startAt ? new Date(dto.startAt) : null, endAt: dto.endAt ? new Date(dto.endAt) : null, sortOrder: dto.sortOrder ?? existing?.sortOrder ?? 0 });
  }
  async deleteBanner(id: string) { const r = await this.banners.delete({ id }); if (!r.affected) throw new NotFoundException(); }

  // ── helpers ──
  private patchFor(to: ContentStatus, action: Action, publishAtRaw: string | undefined, now: Date, previousPublishedAt: Date | null) {
    if (to === ContentStatus.Published) return { status: to, publishAt: null, publishedAt: now };
    if (to === ContentStatus.Scheduled) {
      const at = publishAtRaw ? new Date(publishAtRaw) : null;
      if (!at || at <= now) throw badRequest('INVALID_SCHEDULE', 'publishAt must be a time in the future');
      return { status: to, publishAt: at, publishedAt: null };
    }
    return { status: to, publishAt: null, publishedAt: action === 'archive' ? previousPublishedAt : null };
  }

  private async requireEpisode(id: string): Promise<Episode> {
    const e = await this.episodes.findOne({ where: { id } });
    if (!e) throw new NotFoundException();
    return e;
  }
  private async loadByIds<T extends { id: string }>(repo: Repository<T>, ids: string[] | undefined, label: string): Promise<T[]> {
    const unique = [...new Set(ids ?? [])];
    if (!unique.length) return [];
    const found = await repo.find({ where: { id: In(unique) } as never });
    if (found.length !== unique.length) throw badRequest('UNKNOWN_REFERENCE', `One or more ${label}s do not exist`);
    return found;
  }
  private async replaceCast(repo: Repository<SeriesCast>, seriesId: string, cast: { castMemberId: string; roleName?: string; billingOrder?: number }[]) {
    const ids = [...new Set(cast.map((c) => c.castMemberId))];
    if (ids.length !== cast.length) throw badRequest('DUPLICATE_CAST', 'A cast member can only be listed once');
    if (ids.length && (await this.castMembers.count({ where: { id: In(ids) } })) !== ids.length) throw badRequest('UNKNOWN_REFERENCE', 'One or more cast members do not exist');
    await repo.delete({ seriesId });
    if (cast.length) await repo.insert(cast.map((c, i) => ({ seriesId, castMemberId: c.castMemberId, roleName: c.roleName ?? null, billingOrder: c.billingOrder ?? i })));
  }

  private seriesView(s: Series) {
    return { id: s.id, slug: s.slug, title: s.title, synopsis: s.synopsis, language: s.language, maturityRating: s.maturityRating, releaseYear: s.releaseYear, posterKey: s.posterKey, posterUrl: this.urls.imageUrl(s.posterKey), bannerKey: s.bannerKey, bannerUrl: this.urls.imageUrl(s.bannerKey), status: s.status, publishAt: s.publishAt, publishedAt: s.publishedAt, sortWeight: s.sortWeight, isFeatured: s.isFeatured, createdAt: s.createdAt, updatedAt: s.updatedAt };
  }
  private episodeView(e: Episode) {
    return { id: e.id, seriesId: e.seriesId, number: e.number, title: e.title, description: e.description, durationSeconds: e.durationSeconds, thumbnailKey: e.thumbnailKey, thumbnailUrl: this.urls.imageUrl(e.thumbnailKey), status: e.status, publishAt: e.publishAt, publishedAt: e.publishedAt, hasVideo: !!e.currentAssetId, createdAt: e.createdAt };
  }
}
