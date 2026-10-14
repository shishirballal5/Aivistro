import { Module } from '@nestjs/common';
import { EngagementController } from './engagement.controller';
import { EngagementCoreModule } from './engagement-core.module';

@Module({ imports: [EngagementCoreModule], controllers: [EngagementController], exports: [EngagementCoreModule] })
export class EngagementModule {}
