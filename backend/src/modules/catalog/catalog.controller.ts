import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserContext } from '../../common/auth/auth.types';
import { OptionalUserAuthGuard } from '../../common/auth/guards';
import { MaybeUser } from '../../common/decorators/params';
import { PageQueryDto } from '../../common/pagination.dto';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { SeriesListQueryDto } from './catalog.dto';
import { CatalogService } from './catalog.service';

const PUBLIC_CACHE = 'public, max-age=30, stale-while-revalidate=60';

/** Public browse APIs. Only published, currently-available content is returned, and never any storage keys. */
@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService, private readonly entitlements: EntitlementsService) {}

  @Get('genres') @Header('Cache-Control', PUBLIC_CACHE) genres() { return this.catalog.listGenres(); }
  @Get('categories') @Header('Cache-Control', PUBLIC_CACHE) categories() { return this.catalog.listCategories(); }

  @Get('home') @Header('Cache-Control', PUBLIC_CACHE)
  @ApiOperation({ summary: 'Homepage banners and sections (only available series)' })
  home() { return this.catalog.home(); }

  @Get('series') @Header('Cache-Control', PUBLIC_CACHE)
  @ApiOperation({ summary: 'Search and filter series. Cursor-paginated.' })
  list(@Query() q: SeriesListQueryDto) { return this.catalog.listSeries(q); }

  @Get('series/:ref') @Header('Cache-Control', PUBLIC_CACHE)
  @ApiOperation({ summary: 'Series detail by id or slug' })
  detail(@Param('ref') ref: string) { return this.catalog.getSeries(ref); }

  @Get('series/:ref/episodes') @Header('Cache-Control', 'private, no-store') @UseGuards(OptionalUserAuthGuard)
  @ApiOperation({ summary: 'Ordered episode list with each episode\'s access state. Metadata only: this never grants playback.' })
  async episodes(@Param('ref') ref: string, @Query() q: PageQueryDto, @MaybeUser() u?: UserContext) {
    const r = await this.catalog.listEpisodes(ref, q.cursor, q.limit);
    const access = await this.entitlements.bulkAccess(u?.userId ?? null, r.episodes);
    return { items: r.episodes.map((e) => { const { allowed, code, message, requiresAuth } = access.get(e.id)!; return { ...this.catalog.episodeBase(e), access: { allowed, ...(code ? { code, message } : {}), ...(requiresAuth ? { requiresAuth } : {}) } }; }), nextCursor: r.nextCursor };
  }
}
