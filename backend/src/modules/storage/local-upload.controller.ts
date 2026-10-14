import { Controller, ForbiddenException, Headers, HttpCode, NotFoundException, Param, Put, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Inject } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { Transform } from 'node:stream';
import { badRequest, DomainException } from '../../common/errors';
import { mediaConfig } from '../../config/media.config';
import { LocalStorageService } from './local-storage.service';

/**
 * DEVELOPMENT ONLY: stands in for S3's presigned PUT when STORAGE_DRIVER=local. The token is HMAC-signed for ONE key, content
 * type and size, and expires. The body is streamed to disk with a hard byte cap, so a client cannot send more than it declared.
 */
@ApiExcludeController()
@SkipThrottle()
@Controller('storage/local')
export class LocalUploadController {
  constructor(private readonly local: LocalStorageService, @Inject(mediaConfig.KEY) private readonly cfg: ConfigType<typeof mediaConfig>) {}

  @Put(':token') @HttpCode(200)
  async upload(@Param('token') token: string, @Req() req: Request, @Headers('content-type') contentType?: string, @Headers('content-length') contentLength?: string) {
    if (this.cfg.driver !== 'local' || this.cfg.isProduction) throw new NotFoundException();
    const claims = this.local.verifyUploadToken(token);
    if (!claims) throw new ForbiddenException({ code: 'INVALID_UPLOAD_TOKEN', message: 'The upload link is invalid or has expired' });
    if (contentType !== claims.t) throw badRequest('CONTENT_TYPE_MISMATCH', 'Content-Type does not match the upload authorisation');
    if (contentLength !== undefined && Number(contentLength) !== claims.s) throw badRequest('SIZE_MISMATCH', 'Content-Length does not match the declared size');
    // Public images are write-once: a second PUT must not replace bytes that were already verified by POST /admin/images/complete.
    if (claims.k.startsWith('images/') && (await this.local.stat(claims.k))) throw new DomainException(409, 'OBJECT_EXISTS', 'This upload slot has already been used. Request a new one.');
    let seen = 0;
    const cap = new Transform({ transform(chunk, _enc, cb) { seen += chunk.length; seen > claims.s ? cb(new DomainException(413, 'PAYLOAD_TOO_LARGE', 'More data than declared')) : cb(null, chunk); } });
    await this.local.put(claims.k, req.pipe(cap), claims.t);
    return { ok: true };
  }
}
