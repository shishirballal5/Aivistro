import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { authConfig } from '../../config/auth.config';

/**
 * Turns an image object key into a public URL (posters, banners, thumbnails). Raw keys are never returned by the API.
 * This is for PUBLIC images only. Video is never exposed through here, see the playback module.
 */
@Injectable()
export class MediaUrlService {
  constructor(@Inject(authConfig.KEY) private readonly cfg: ConfigType<typeof authConfig>) {}
  imageUrl(key: string | null | undefined): string | null {
    if (!key || !this.cfg.mediaPublicBaseUrl) return null;
    return `${this.cfg.mediaPublicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }
}
