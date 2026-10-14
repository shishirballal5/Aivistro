import { Module } from '@nestjs/common';
import { EngagementCoreModule } from '../watch-history/engagement-core.module';
import { AnalyticsController } from './analytics.controller';
import { DashboardService } from './dashboard.service';

@Module({ imports: [EngagementCoreModule], controllers: [AnalyticsController], providers: [DashboardService] })
export class AnalyticsModule {}
