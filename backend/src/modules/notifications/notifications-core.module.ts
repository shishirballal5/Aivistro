import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { pushConfig } from '../../config/media.config';
import { DeviceToken, Notification, Profile, UserNotification } from '../../database/entities/index';
import { QueueModule } from '../queues/queue.module';
import { NotificationsService } from './notifications.service';
import { DevPushSender, DisabledPushSender, FcmPushSender, PushOutbox, PushSender } from '../../util/thirdparty/fcm/push.sender';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, UserNotification, DeviceToken, Profile]), QueueModule],
  providers: [
    NotificationsService, PushOutbox,
    { provide: PushSender, inject: [pushConfig.KEY, PushOutbox], useFactory: (c: ConfigType<typeof pushConfig>, outbox: PushOutbox): PushSender => (c.provider === 'fcm' ? new FcmPushSender(c) : c.provider === 'dev' ? new DevPushSender(outbox) : new DisabledPushSender()) },
  ],
  exports: [NotificationsService, PushOutbox, PushSender],
})
export class NotificationsCoreModule {}
