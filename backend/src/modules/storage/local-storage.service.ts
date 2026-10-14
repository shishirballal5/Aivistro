import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { hmacSha256Hex, safeEqual } from '../../common/crypto/crypto.util';
import { KeyService } from '../../common/crypto/key.service';
import { mediaConfig } from '../../config/media.config';
import { addSeconds } from '../../common/time';
import { assertSafeKey, ObjectRead, ObjectStat, StorageService, UploadAuthorization } from './storage.service';

export interface LocalUploadClaims { k: string; t: string; s: number; e: number }

/** DEVELOPMENT driver: objects are files under STORAGE_LOCAL_DIR. Never allowed in production. */
@Injectable()
export class LocalStorageService extends StorageService {
  readonly driver = 'local' as const;
  private readonly root: string;

  constructor(@Inject(mediaConfig.KEY) cfg: ConfigType<typeof mediaConfig>, private readonly keys: KeyService) {
    super();
    this.root = resolve(cfg.localDir);
  }

  private path(key: string): string {
    const p = resolve(join(this.root, assertSafeKey(key)));
    if (!p.startsWith(this.root + sep)) throw new Error('Key escapes the storage root'); // defence in depth against traversal
    return p;
  }

  async put(key: string, body: Buffer | Readable, contentType: string): Promise<void> {
    const dest = this.path(key);
    await mkdir(dirname(dest), { recursive: true });
    const tmp = `${dest}.part-${process.pid}-${Date.now()}`;
    if (Buffer.isBuffer(body)) await pipeline(Readable.from([body]), createWriteStream(tmp));
    else await pipeline(body, createWriteStream(tmp));
    await rename(tmp, dest);
    void contentType;
  }
  async uploadFile(key: string, filePath: string, _contentType?: string): Promise<void> {
    const dest = this.path(key);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(filePath, dest);
  }
  async get(key: string, range?: { start: number; end?: number }): Promise<ObjectRead | null> {
    const p = this.path(key);
    const st = await stat(p).catch(() => null);
    if (!st?.isFile()) return null;
    if (!range) return { stream: createReadStream(p), size: st.size, contentType: null };
    const end = Math.min(range.end ?? st.size - 1, st.size - 1);
    if (range.start > end) return null;
    return { stream: createReadStream(p, { start: range.start, end }), size: end - range.start + 1, contentType: null, range: { start: range.start, end, total: st.size } };
  }
  async stat(key: string): Promise<ObjectStat | null> {
    const st = await stat(this.path(key)).catch(() => null);
    return st?.isFile() ? { size: st.size, contentType: null } : null;
  }
  async downloadTo(key: string, filePath: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await copyFile(this.path(key), filePath);
  }
  async delete(key: string): Promise<void> { await rm(this.path(key), { force: true }); }
  async deletePrefix(prefix: string): Promise<number> {
    if (!prefix.endsWith('/')) throw new Error('Prefix must end with /');
    const dir = this.path(prefix.slice(0, -1));
    const count = async (d: string): Promise<number> => { let n = 0; for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) n += e.isDirectory() ? await count(join(d, e.name)) : 1; return n; };
    const n = await count(dir);
    await rm(dir, { recursive: true, force: true });
    return n;
  }

  /** The "presigned URL" for local development: an HMAC-signed token for a single key/type/size, valid until `e`. */
  async createUploadAuthorization(key: string, contentType: string, sizeBytes: number, ttlSeconds: number): Promise<UploadAuthorization> {
    assertSafeKey(key);
    const expiresAt = addSeconds(new Date(), ttlSeconds);
    const claims: LocalUploadClaims = { k: key, t: contentType, s: sizeBytes, e: expiresAt.getTime() };
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const token = `${body}.${hmacSha256Hex(this.keys.mediaSigning, body)}`;
    return { url: `/api/v1/storage/local/${token}`, method: 'PUT', headers: { 'Content-Type': contentType }, expiresAt };
  }
  verifyUploadToken(token: string): LocalUploadClaims | null {
    const [body, sig] = token.split('.');
    if (!body || !sig || !safeEqual(hmacSha256Hex(this.keys.mediaSigning, body), sig)) return null;
    try {
      const c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LocalUploadClaims;
      return typeof c.k === 'string' && typeof c.t === 'string' && Number.isSafeInteger(c.s) && c.e > Date.now() ? c : null;
    } catch { return null; }
  }
  async presignGet(): Promise<string | null> { return null; } // always streamed through the API (which checks the playback token first)
}
