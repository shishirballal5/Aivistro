import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Banner, CastMember, Category, Episode, Genre, HomepageSection, HomepageSectionItem, Series, SeriesCast, VideoAsset } from '../../database/entities/index';
import { CatalogAdminService } from './catalog-admin.service';
import { CatalogService } from './catalog.service';
import { MediaUrlService } from './media-urls.service';
import { PublishPolicy } from './publish.policy';

/** Catalog services without HTTP controllers, so the worker process can use them too. */
@Module({
  imports: [TypeOrmModule.forFeature([Series, Episode, Genre, Category, CastMember, SeriesCast, HomepageSection, HomepageSectionItem, Banner, VideoAsset])],
  providers: [CatalogService, CatalogAdminService, PublishPolicy, MediaUrlService],
  exports: [CatalogService, CatalogAdminService, PublishPolicy, MediaUrlService, TypeOrmModule],
})
export class CatalogCoreModule {}
