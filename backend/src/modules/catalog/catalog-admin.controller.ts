import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, RequirePermissions } from '../../common/auth/guards';
import { Audit } from '../audit-logs/audit.decorator';
import { AdminSeriesQueryDto, BannerDto, CastMemberDto, CreateEpisodeDto, CreateSeriesDto, HomepageSectionDto, NameDto, ReorderEpisodesDto, ScheduleDto, UpdateEpisodeDto, UpdateSeriesDto } from './catalog.dto';
import { CatalogAdminService } from './catalog-admin.service';

/** Admin CMS. Every route is permission-checked on the server (AdminAuthGuard) and every mutation is written to the audit log. */
@ApiTags('admin-catalog')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin')
export class CatalogAdminController {
  constructor(private readonly svc: CatalogAdminService) {}

  // genres / categories / cast
  @Post('genres') @RequirePermissions('catalog.write') @Audit('genre.create', 'genre') createGenre(@Body() d: NameDto) { return this.svc.createNamed('genre', d); }
  @Patch('genres/:id') @RequirePermissions('catalog.write') @Audit('genre.update', 'genre') updateGenre(@Param('id') id: string, @Body() d: NameDto) { return this.svc.updateNamed('genre', id, d); }
  @Delete('genres/:id') @HttpCode(204) @RequirePermissions('catalog.write') @Audit('genre.delete', 'genre') deleteGenre(@Param('id') id: string) { return this.svc.deleteNamed('genre', id); }
  @Post('categories') @RequirePermissions('catalog.write') @Audit('category.create', 'category') createCategory(@Body() d: NameDto) { return this.svc.createNamed('category', d); }
  @Patch('categories/:id') @RequirePermissions('catalog.write') @Audit('category.update', 'category') updateCategory(@Param('id') id: string, @Body() d: NameDto) { return this.svc.updateNamed('category', id, d); }
  @Delete('categories/:id') @HttpCode(204) @RequirePermissions('catalog.write') @Audit('category.delete', 'category') deleteCategory(@Param('id') id: string) { return this.svc.deleteNamed('category', id); }
  @Get('cast') @RequirePermissions('catalog.read') listCast() { return this.svc.listCast(); }
  @Post('cast') @RequirePermissions('catalog.write') @Audit('cast.create', 'cast_member') createCast(@Body() d: CastMemberDto) { return this.svc.createCast(d); }
  @Patch('cast/:id') @RequirePermissions('catalog.write') @Audit('cast.update', 'cast_member') updateCast(@Param('id') id: string, @Body() d: CastMemberDto) { return this.svc.updateCast(id, d); }

  // series
  @Get('series') @RequirePermissions('catalog.read') listSeries(@Query() q: AdminSeriesQueryDto) { return this.svc.listSeries(q); }
  @Get('series/:id') @RequirePermissions('catalog.read') getSeries(@Param('id') id: string) { return this.svc.getSeries(id); }
  @Post('series') @RequirePermissions('catalog.write') @Audit('series.create', 'series') createSeries(@Body() d: CreateSeriesDto) { return this.svc.createSeries(d); }
  @Patch('series/:id') @RequirePermissions('catalog.write') @Audit('series.update', 'series') updateSeries(@Param('id') id: string, @Body() d: UpdateSeriesDto) { return this.svc.updateSeries(id, d); }
  @Delete('series/:id') @HttpCode(204) @RequirePermissions('catalog.write') @Audit('series.delete', 'series') deleteSeries(@Param('id') id: string) { return this.svc.deleteSeries(id); }
  @Post('series/:id/publish') @HttpCode(200) @RequirePermissions('catalog.publish') @Audit('series.publish', 'series') publishSeries(@Param('id') id: string) { return this.svc.transitionSeries(id, 'publish'); }
  @Post('series/:id/schedule') @HttpCode(200) @RequirePermissions('catalog.publish') @Audit('series.schedule', 'series') scheduleSeries(@Param('id') id: string, @Body() d: ScheduleDto) { return this.svc.transitionSeries(id, 'schedule', d.publishAt); }
  @Post('series/:id/unpublish') @HttpCode(200) @RequirePermissions('catalog.publish') @Audit('series.unpublish', 'series') unpublishSeries(@Param('id') id: string) { return this.svc.transitionSeries(id, 'unpublish'); }
  @Post('series/:id/archive') @HttpCode(200) @RequirePermissions('catalog.publish') @Audit('series.archive', 'series') archiveSeries(@Param('id') id: string) { return this.svc.transitionSeries(id, 'archive'); }
  @Post('series/:id/restore') @HttpCode(200) @RequirePermissions('catalog.publish') @Audit('series.restore', 'series') restoreSeries(@Param('id') id: string) { return this.svc.transitionSeries(id, 'restore'); }

  // episodes
  @Get('series/:id/episodes') @RequirePermissions('catalog.read') listEpisodes(@Param('id') id: string) { return this.svc.listEpisodes(id); }
  @Post('series/:id/episodes') @RequirePermissions('catalog.write') @Audit('episode.create', 'episode') createEpisode(@Param('id') id: string, @Body() d: CreateEpisodeDto) { return this.svc.createEpisode(id, d); }
  @Post('series/:id/episodes/reorder') @HttpCode(200) @RequirePermissions('catalog.write') @Audit('episode.reorder', 'series') reorderEpisodes(@Param('id') id: string, @Body() d: ReorderEpisodesDto) { return this.svc.reorderEpisodes(id, d.episodeIds); }
  @Get('episodes/:id') @RequirePermissions('catalog.read') getEpisode(@Param('id') id: string) { return this.svc.getEpisode(id); }
  @Patch('episodes/:id') @RequirePermissions('catalog.write') @Audit('episode.update', 'episode') updateEpisode(@Param('id') id: string, @Body() d: UpdateEpisodeDto) { return this.svc.updateEpisode(id, d); }
  @Delete('episodes/:id') @HttpCode(204) @RequirePermissions('catalog.write') @Audit('episode.delete', 'episode') deleteEpisode(@Param('id') id: string) { return this.svc.deleteEpisode(id); }
  @Post('episodes/:id/publish') @HttpCode(200) @RequirePermissions('catalog.publish') @Audit('episode.publish', 'episode') publishEpisode(@Param('id') id: string) { return this.svc.transitionEpisode(id, 'publish'); }
  @Post('episodes/:id/schedule') @HttpCode(200) @RequirePermissions('catalog.publish') @Audit('episode.schedule', 'episode') scheduleEpisode(@Param('id') id: string, @Body() d: ScheduleDto) { return this.svc.transitionEpisode(id, 'schedule', d.publishAt); }
  @Post('episodes/:id/unpublish') @HttpCode(200) @RequirePermissions('catalog.publish') @Audit('episode.unpublish', 'episode') unpublishEpisode(@Param('id') id: string) { return this.svc.transitionEpisode(id, 'unpublish'); }
  @Post('episodes/:id/archive') @HttpCode(200) @RequirePermissions('catalog.publish') @Audit('episode.archive', 'episode') archiveEpisode(@Param('id') id: string) { return this.svc.transitionEpisode(id, 'archive'); }
  @Post('episodes/:id/restore') @HttpCode(200) @RequirePermissions('catalog.publish') @Audit('episode.restore', 'episode') restoreEpisode(@Param('id') id: string) { return this.svc.transitionEpisode(id, 'restore'); }

  // homepage CMS
  @Get('homepage-sections') @RequirePermissions('catalog.read') sections() { return this.svc.listSections(); }
  @Post('homepage-sections') @RequirePermissions('homepage.write') @Audit('homepage_section.create', 'homepage_section') createSection(@Body() d: HomepageSectionDto) { return this.svc.saveSection(d); }
  @Put('homepage-sections/:id') @RequirePermissions('homepage.write') @Audit('homepage_section.update', 'homepage_section') updateSection(@Param('id') id: string, @Body() d: HomepageSectionDto) { return this.svc.saveSection(d, id); }
  @Delete('homepage-sections/:id') @HttpCode(204) @RequirePermissions('homepage.write') @Audit('homepage_section.delete', 'homepage_section') deleteSection(@Param('id') id: string) { return this.svc.deleteSection(id); }
  @Get('banners') @RequirePermissions('catalog.read') banners() { return this.svc.listBanners(); }
  @Post('banners') @RequirePermissions('homepage.write') @Audit('banner.create', 'banner') createBanner(@Body() d: BannerDto) { return this.svc.saveBanner(d); }
  @Put('banners/:id') @RequirePermissions('homepage.write') @Audit('banner.update', 'banner') updateBanner(@Param('id') id: string, @Body() d: BannerDto) { return this.svc.saveBanner(d, id); }
  @Delete('banners/:id') @HttpCode(204) @RequirePermissions('homepage.write') @Audit('banner.delete', 'banner') deleteBanner(@Param('id') id: string) { return this.svc.deleteBanner(id); }
}
