import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Episode, VideoAsset, VideoSubtitle } from '../../database/entities/index';
import { QueueModule } from '../queues/queue.module';
import { VideoAssetsService } from './video-assets.service';
import { VideoProcessingService } from './video-processing.service';

/** Video services without HTTP controllers (the worker uses the processing service). */
@Module({ imports: [TypeOrmModule.forFeature([VideoAsset, VideoSubtitle, Episode]), QueueModule], providers: [VideoAssetsService, VideoProcessingService], exports: [VideoAssetsService, VideoProcessingService, TypeOrmModule] })
export class VideoAssetsCoreModule {}
