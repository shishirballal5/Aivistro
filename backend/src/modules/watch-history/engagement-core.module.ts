import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsEvent, Episode, PlaybackSession, Series, VideoAsset, WatchHistory, WatchProgress, Watchlist, WatchlistItem } from '../../database/entities/index';
import { AnalyticsService } from '../analytics/analytics.service';
import { CatalogCoreModule } from '../catalog/catalog-core.module';
import { WatchlistService } from '../watchlist/watchlist.service';
import { HistoryService } from './history.service';
import { ProgressService } from './progress.service';

/** Progress, history, watchlist and analytics logic without HTTP controllers (the worker flushes progress). Needs the global RedisModule. */
@Module({
  imports: [TypeOrmModule.forFeature([AnalyticsEvent, Episode, PlaybackSession, Series, VideoAsset, WatchHistory, WatchProgress, Watchlist, WatchlistItem]), CatalogCoreModule],
  providers: [AnalyticsService, ProgressService, HistoryService, WatchlistService],
  exports: [AnalyticsService, ProgressService, HistoryService, WatchlistService],
})
export class EngagementCoreModule {}
