import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Res, UseGuards, Inject } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AdminAuthGuard, RequirePermissions } from '../../common/auth/guards';
import { perMinute } from '../../common/throttler/limits';
import { mediaConfig } from '../../config/media.config';
import { Audit } from '../audit-logs/audit.decorator';
import { StorageService } from '../storage/storage.service';
import { CompleteImageUploadDto, RequestImageUploadDto } from './media-images.dto';
import { MediaImagesService } from './media-images.service';
import { TYPE_OF_EXT } from './media-images.util';

@ApiTags('admin-images')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/images')
export class MediaImagesAdminController {
  constructor(private readonly svc: MediaImagesService) {}

  @Post() @HttpCode(201) @RequirePermissions('catalog.write') @Audit('image.upload_requested', 'image') @perMinute(60)
  @ApiOperation({ summary: 'Step 1: get a server-chosen image key and a short-lived upload URL (PUT the file to it)' })
  request(@Body() dto: RequestImageUploadDto) { return this.svc.requestUpload(dto); }

  @Post('complete') @HttpCode(200) @RequirePermissions('catalog.write') @Audit('image.upload_completed', 'image') @perMinute(60)
  @ApiOperation({ summary: 'Step 2: verify the uploaded file (size and magic bytes) and get its public URL' })
  complete(@Body() dto: CompleteImageUploadDto) { return this.svc.complete(dto); }
}

/** Dev-only public image serving (STORAGE_DRIVER=local). With s3, the bucket/CDN at MEDIA_PUBLIC_BASE_URL serves images and this is a 404. */
@ApiTags('media')
@Controller('media/images')
export class MediaImagesPublicController {
  constructor(private readonly storage: StorageService, @Inject(mediaConfig.KEY) private readonly cfg: ConfigType<typeof mediaConfig>) {}

  @Get('*path') @ApiExcludeEndpoint()
  async serve(@Param('path') path: string | string[], @Res() res: Response) {
    if (this.cfg.driver !== 'local') throw new NotFoundException();
    const rel = Array.isArray(path) ? path.join('/') : path;
    const key = `images/${rel}`;
    // Strict allow-list on the decoded path: no "..", no empty/odd segments, a known image extension, and nothing else.
    if (!/^images\/(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9/_.-]{0,200}\.(jpg|png|webp)$/.test(key) || key.includes('//')) throw new NotFoundException();
    const obj = await this.storage.get(key).catch(() => null);
    if (!obj) throw new NotFoundException();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', TYPE_OF_EXT[key.slice(key.lastIndexOf('.') + 1)]);
    res.setHeader('Content-Length', String(obj.size));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    obj.stream.on('error', () => res.destroy());
    obj.stream.pipe(res);
  }
}
