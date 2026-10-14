import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminContext } from '../../common/auth/auth.types';
import { AdminAuthGuard, RequirePermissions } from '../../common/auth/guards';
import { CurrentAdmin } from '../../common/decorators/params';
import { perMinute } from '../../common/throttler/limits';
import { Audit } from '../audit-logs/audit.decorator';
import { RequestUploadDto, SubtitleDto } from './video-assets.dto';
import { VideoAssetsService } from './video-assets.service';

@ApiTags('admin-video')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin')
export class VideoAssetsController {
  constructor(private readonly svc: VideoAssetsService) {}

  @Post('episodes/:id/video-assets') @HttpCode(201) @RequirePermissions('video.manage') @Audit('video.upload_requested', 'episode') @perMinute(30)
  @ApiOperation({ summary: 'Step 1: get a short-lived upload URL for a video (PUT the file to it)' })
  request(@CurrentAdmin() a: AdminContext, @Param('id') id: string, @Body() dto: RequestUploadDto) { return this.svc.requestUpload(a.adminId, id, dto); }

  @Post('video-assets/:id/complete') @HttpCode(200) @RequirePermissions('video.manage') @Audit('video.upload_completed', 'video_asset')
  @ApiOperation({ summary: 'Step 2: tell the server the upload finished. It verifies the file, then queues processing.' })
  complete(@Param('id') id: string) { return this.svc.complete(id); }

  @Post('video-assets/:id/reprocess') @HttpCode(200) @RequirePermissions('video.manage') @Audit('video.reprocess', 'video_asset')
  reprocess(@Param('id') id: string) { return this.svc.reprocess(id); }

  @Get('episodes/:id/video-assets') @RequirePermissions('video.manage') list(@Param('id') id: string) { return this.svc.list(id); }
  @Get('video-assets/:id') @RequirePermissions('video.manage') get(@Param('id') id: string) { return this.svc.get(id); }

  @Post('video-assets/:id/subtitles') @HttpCode(200) @RequirePermissions('video.manage') @Audit('video.subtitle_set', 'video_asset')
  addSubtitle(@Param('id') id: string, @Body() dto: SubtitleDto) { return this.svc.addSubtitle(id, dto); }
  @Delete('video-assets/:id/subtitles/:language') @HttpCode(204) @RequirePermissions('video.manage') @Audit('video.subtitle_removed', 'video_asset')
  removeSubtitle(@Param('id') id: string, @Param('language') language: string) { return this.svc.removeSubtitle(id, language); }
}
