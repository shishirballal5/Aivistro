import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { randomToken } from '../../common/crypto/crypto.util';
import { badRequest, conflict } from '../../common/errors';
import { MediaUrlService } from '../catalog/media-urls.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { StorageService } from '../storage/storage.service';
import { CompleteImageUploadDto, MAX_IMAGE_BYTES, RequestImageUploadDto } from './media-images.dto';
import { EXT_OF, matchesMagic, TYPE_OF_EXT } from './media-images.util';

const UPLOAD_URL_TTL_SECONDS = 900;
const PENDING_TTL_SECONDS = UPLOAD_URL_TTL_SECONDS + 600;
const pendingKey = (key: string) => `media-image:pending:${key}`;

@Injectable()
export class MediaImagesService {
  private readonly log = new Logger(MediaImagesService.name);
  constructor(private readonly storage: StorageService, private readonly urls: MediaUrlService, @Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Step 1: pick an unguessable key and hand back a short-lived, single-object, write-only upload authorisation. */
  async requestUpload(dto: RequestImageUploadDto) {
    if (dto.filename.includes('..')) throw badRequest('INVALID_FILENAME', 'filename must be a plain file name');
    const ext = EXT_OF[dto.contentType];
    if (!new RegExp(`\\.${ext === 'jpg' ? 'jpe?g' : ext}$`, 'i').test(dto.filename)) throw badRequest('FILENAME_TYPE_MISMATCH', 'The file extension does not match the content type');
    const now = new Date();
    const key = `images/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomToken(18)}.${ext}`;
    // 144 random bits: no collision check (it would cost a bucket round trip). The local driver additionally refuses a second PUT to a used key.
    await this.redis.set(pendingKey(key), JSON.stringify({ s: dto.sizeBytes, t: dto.contentType }), 'EX', PENDING_TTL_SECONDS);
    const upload = await this.storage.createUploadAuthorization(key, dto.contentType, dto.sizeBytes, UPLOAD_URL_TTL_SECONDS);
    return { key, upload: { url: upload.url, method: upload.method, headers: upload.headers, expiresAt: upload.expiresAt }, maxBytes: MAX_IMAGE_BYTES };
  }

  /** Step 2: do not believe the client. Look at what is actually in storage: size, then the real file signature. */
  async complete(dto: CompleteImageUploadDto) {
    const key = dto.key;
    const stat = await this.storage.stat(key);
    if (!stat) throw conflict('UPLOAD_NOT_FOUND', 'No file has been uploaded for this key yet');
    const raw = await this.redis.get(pendingKey(key)).catch(() => null);
    const pending = raw ? (JSON.parse(raw) as { s: number; t: string }) : null;
    const declaredType = pending?.t ?? TYPE_OF_EXT[key.slice(key.lastIndexOf('.') + 1)];
    if (stat.size < 1 || stat.size > MAX_IMAGE_BYTES || (pending && pending.s !== stat.size)) {
      await this.discard(key);
      throw badRequest('UPLOAD_SIZE_MISMATCH', 'The uploaded file does not match what was declared or exceeds 5 MB. Please upload again.');
    }
    const head = await this.readHead(key);
    if (!declaredType || !matchesMagic(declaredType as never, head)) {
      await this.discard(key);
      throw badRequest('IMAGE_CONTENT_MISMATCH', 'The uploaded file is not a valid JPEG, PNG or WebP image of the declared type. It was removed.');
    }
    await this.redis.del(pendingKey(key)).catch(() => undefined);
    return { key, url: this.urls.imageUrl(key) };
  }

  private async readHead(key: string): Promise<Buffer> {
    const obj = await this.storage.get(key, { start: 0, end: 15 });
    if (!obj) return Buffer.alloc(0);
    const chunks: Buffer[] = []; let n = 0;
    for await (const c of obj.stream) { const b = Buffer.from(c); chunks.push(b); n += b.length; if (n >= 16) break; }
    obj.stream.destroy();
    return Buffer.concat(chunks).subarray(0, 16);
  }
  private async discard(key: string) {
    await this.storage.delete(key).catch((err) => this.log.warn({ err }, 'could not delete rejected image'));
    await this.redis.del(pendingKey(key)).catch(() => undefined);
  }
}
