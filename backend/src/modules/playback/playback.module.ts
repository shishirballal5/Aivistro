import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Episode, PlaybackSession, VideoAsset, VideoSubtitle } from '../../database/entities/index';
import { EngagementCoreModule } from '../watch-history/engagement-core.module';
import { MediaController } from './media.controller';
import { PlaybackController } from './playback.controller';
import { PlaybackService } from './playback.service';

@Module({ imports: [TypeOrmModule.forFeature([PlaybackSession, VideoAsset, VideoSubtitle, Episode]), EngagementCoreModule], controllers: [PlaybackController, MediaController], providers: [PlaybackService], exports: [PlaybackService] })
export class PlaybackModule {}
