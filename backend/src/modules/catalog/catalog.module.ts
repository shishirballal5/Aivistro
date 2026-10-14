import { Module } from '@nestjs/common';
import { CatalogAdminController } from './catalog-admin.controller';
import { CatalogController } from './catalog.controller';
import { CatalogCoreModule } from './catalog-core.module';

@Module({ imports: [CatalogCoreModule], controllers: [CatalogController, CatalogAdminController], exports: [CatalogCoreModule] })
export class CatalogModule {}
