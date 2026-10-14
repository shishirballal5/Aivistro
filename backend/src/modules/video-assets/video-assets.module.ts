import { Module } from '@nestjs/common';
import { LocalUploadController } from '../storage/local-upload.controller';
import { VideoAssetsCoreModule } from './video-assets-core.module';
import { VideoAssetsController } from './video-assets.controller';

@Module({ imports: [VideoAssetsCoreModule], controllers: [VideoAssetsController, LocalUploadController], exports: [VideoAssetsCoreModule] })
export class VideoAssetsModule {}
