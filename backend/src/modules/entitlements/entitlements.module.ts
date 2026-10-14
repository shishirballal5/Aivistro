import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Entitlement, Episode, Series, User, VideoAsset } from '../../database/entities/index';
import { AccessController } from './access.controller';
import { EntitlementsService, EpisodeVideoStateProvider, VideoStateProvider } from './entitlements.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Entitlement, Episode, Series, User, VideoAsset])],
  controllers: [AccessController],
  providers: [EntitlementsService, { provide: VideoStateProvider, useClass: EpisodeVideoStateProvider }],
  exports: [EntitlementsService, VideoStateProvider],
})
export class EntitlementsModule {}
