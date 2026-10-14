import { Module } from '@nestjs/common';
import { CampaignsAdminController, InboxController } from './notifications.controller';
import { NotificationsCoreModule } from './notifications-core.module';

@Module({ imports: [NotificationsCoreModule], controllers: [InboxController, CampaignsAdminController], exports: [NotificationsCoreModule] })
export class NotificationsModule {}
