import { Global, Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { mediaConfig } from '../../config/media.config';
import { LocalStorageService } from './local-storage.service';
import { S3StorageService } from '../../util/thirdparty/aws-s3/s3-storage.service';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [
    LocalStorageService,
    {
      provide: StorageService,
      inject: [mediaConfig.KEY, LocalStorageService],
      useFactory: (cfg: ConfigType<typeof mediaConfig>, local: LocalStorageService): StorageService => (cfg.driver === 's3' ? new S3StorageService(cfg) : local),
    },
  ],
  exports: [StorageService, LocalStorageService],
})
export class StorageModule {}
