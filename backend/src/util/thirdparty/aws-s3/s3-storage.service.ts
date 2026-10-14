import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { mediaConfig } from '../../../config/media.config';
import { addSeconds } from '../../../common/time';
import { assertSafeKey, ObjectRead, ObjectStat, StorageService, UploadAuthorization } from '../../../modules/storage/storage.service';

/**
 * Amazon S3 or any S3-compatible store (Cloudflare R2: set S3_ENDPOINT and S3_REGION=auto).
 * The bucket MUST be private (no public access). Public images use a separate public prefix/CDN rule; see the README.
 * NOTE: exercised in tests for presigned-URL generation and request shaping, but not against a live bucket (no credentials here).
 */
@Injectable()
export class S3StorageService extends StorageService {
  readonly driver = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(mediaConfig.KEY) cfg: ConfigType<typeof mediaConfig>) {
    super();
    this.bucket = cfg.s3.bucket;
    this.client = new S3Client({ region: cfg.s3.region, endpoint: cfg.s3.endpoint, forcePathStyle: cfg.s3.forcePathStyle, credentials: { accessKeyId: cfg.s3.accessKeyId, secretAccessKey: cfg.s3.secretAccessKey } });
  }

  async put(key: string, body: Buffer | Readable, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: assertSafeKey(key), Body: body, ContentType: contentType, CacheControl: 'private, no-store' }));
  }
  async uploadFile(key: string, filePath: string, contentType: string) {
    const { size } = await stat(filePath);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: assertSafeKey(key), Body: createReadStream(filePath), ContentLength: size, ContentType: contentType, CacheControl: 'private, no-store' }));
  }
  async get(key: string, range?: { start: number; end?: number }): Promise<ObjectRead | null> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: assertSafeKey(key), Range: range ? `bytes=${range.start}-${range.end ?? ''}` : undefined }));
      const m = r.ContentRange ? /bytes (\d+)-(\d+)\/(\d+)/.exec(r.ContentRange) : null;
      return { stream: r.Body as Readable, size: r.ContentLength ?? 0, contentType: r.ContentType ?? null, range: m ? { start: Number(m[1]), end: Number(m[2]), total: Number(m[3]) } : undefined };
    } catch (e) { if (isMissing(e)) return null; throw e; }
  }
  async stat(key: string): Promise<ObjectStat | null> {
    try { const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: assertSafeKey(key) })); return { size: r.ContentLength ?? 0, contentType: r.ContentType ?? null }; }
    catch (e) { if (isMissing(e)) return null; throw e; }
  }
  async downloadTo(key: string, filePath: string) {
    const r = await this.get(key);
    if (!r) throw new Error(`Object not found: ${key}`);
    await mkdir(dirname(filePath), { recursive: true });
    await pipeline(r.stream, createWriteStream(filePath));
  }
  async delete(key: string) { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: assertSafeKey(key) })); }
  async deletePrefix(prefix: string): Promise<number> {
    if (!prefix.endsWith('/')) throw new Error('Prefix must end with /');
    assertSafeKey(prefix.slice(0, -1));
    let token: string | undefined; let total = 0;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length) { await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys } })); total += keys.length; }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return total;
  }

  /** A presigned PUT for exactly one key, bound to the declared Content-Type, expiring quickly. Size is re-checked on completion. */
  async createUploadAuthorization(key: string, contentType: string, _sizeBytes: number, ttlSeconds: number): Promise<UploadAuthorization> {
    const url = await getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: assertSafeKey(key), ContentType: contentType }), { expiresIn: ttlSeconds, signableHeaders: new Set(['content-type']) });
    return { url, method: 'PUT', headers: { 'Content-Type': contentType }, expiresAt: addSeconds(new Date(), ttlSeconds) };
  }
  async presignGet(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: assertSafeKey(key), ResponseCacheControl: 'private, no-store' }), { expiresIn: ttlSeconds });
  }
}

const isMissing = (e: unknown) => { const n = (e as { name?: string; $metadata?: { httpStatusCode?: number } }); return n.name === 'NoSuchKey' || n.name === 'NotFound' || n.$metadata?.httpStatusCode === 404; };
