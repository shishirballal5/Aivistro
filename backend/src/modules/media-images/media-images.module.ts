import { Module } from '@nestjs/common';
import { CatalogCoreModule } from '../catalog/catalog-core.module';
import { MediaImagesAdminController, MediaImagesPublicController } from './media-images.controller';
import { MediaImagesService } from './media-images.service';

@Module({ imports: [CatalogCoreModule], controllers: [MediaImagesAdminController, MediaImagesPublicController], providers: [MediaImagesService] })
export class MediaImagesModule {}
