import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { KeyService } from '../../common/crypto/key.service';
import { redactUrl } from '../../common/logging/logger.module';
import { LocalStorageService } from './local-storage.service';
import { S3StorageService } from '../../util/thirdparty/aws-s3/s3-storage.service';
import { assertSafeKey } from './storage.service';

const auth = { secret: 's'.repeat(40) } as never;
const read = async (s: Readable) => { const c: Buffer[] = []; for await (const x of s) c.push(Buffer.from(x)); return Buffer.concat(c); };

describe('storage keys', () => {
  it.each(['private/hls/1/g1/720p/seg_0000.ts', 'images/thumbs/ep-1-2.jpg', 'a'])('accepts %s', (k) => expect(assertSafeKey(k)).toBe(k));
  it.each(['', '/etc/passwd', '../x', 'a/../b', 'a//b', 'a\\b', 'a b', 'a\0b', 'a?b', 'a#b', '.hidden', 'x'.repeat(600), 'a%2e%2e/b'])('rejects %j', (k) => expect(() => assertSafeKey(k)).toThrow(/Unsafe/));
});

describe('LocalStorageService', () => {
  let dir: string; let st: LocalStorageService;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'aiv-st-')); st = new LocalStorageService({ localDir: dir } as never, new KeyService(auth)); });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('stores, reads, stats, ranges and deletes objects', async () => {
    await st.put('private/a/b.bin', Buffer.from('0123456789'), 'application/octet-stream');
    expect(await st.stat('private/a/b.bin')).toEqual({ size: 10, contentType: null });
    expect((await read((await st.get('private/a/b.bin'))!.stream)).toString()).toBe('0123456789');
    const r = (await st.get('private/a/b.bin', { start: 2, end: 5 }))!;
    expect(r.range).toEqual({ start: 2, end: 5, total: 10 });
    expect((await read(r.stream)).toString()).toBe('2345');
    expect((await st.get('private/a/b.bin', { start: 4 }))!.range).toEqual({ start: 4, end: 9, total: 10 });
    expect(await st.get('private/a/b.bin', { start: 50 })).toBeNull();
    expect(await st.get('private/missing.bin')).toBeNull();
    await st.delete('private/a/b.bin');
    expect(await st.stat('private/a/b.bin')).toBeNull();
  });
  it('refuses keys that try to leave the storage root', async () => {
    await expect(st.put('../escape.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow(/Unsafe/);
    await expect(st.get('a/../../etc/passwd')).rejects.toThrow(/Unsafe/);
  });
  it('deletes a whole prefix and counts what it removed; the prefix must end with /', async () => {
    for (const f of ['x/1.ts', 'x/2.ts', 'x/sub/3.ts', 'y/keep.ts']) await st.put(`private/${f}`, Buffer.from('d'), 'video/mp2t');
    expect(await st.deletePrefix('private/x/')).toBe(3);
    expect(await st.stat('private/x/1.ts')).toBeNull();
    expect(await st.stat('private/y/keep.ts')).not.toBeNull();
    await expect(st.deletePrefix('private/y')).rejects.toThrow(/end with/);
  });
  it('downloads and uploads files', async () => {
    const src = join(dir, 'in.bin'); await writeFile(src, 'hello');
    await st.uploadFile('private/up/in.bin', src, 'x/y');
    await st.downloadTo('private/up/in.bin', join(dir, 'out', 'copy.bin'));
    expect((await readFile(join(dir, 'out', 'copy.bin'))).toString()).toBe('hello');
  });
  it('local upload tokens are bound to one key/type/size, expire, and reject tampering', async () => {
    const a = await st.createUploadAuthorization('private/source/1/a.mp4', 'video/mp4', 123, 60);
    const token = a.url.split('/').pop()!;
    expect(st.verifyUploadToken(token)).toMatchObject({ k: 'private/source/1/a.mp4', t: 'video/mp4', s: 123 });
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), k: 'private/source/9/evil.mp4' })).toString('base64url');
    expect(st.verifyUploadToken(`${forged}.${sig}`)).toBeNull();
    expect(st.verifyUploadToken(`${body}.${'0'.repeat(64)}`)).toBeNull();
    expect(st.verifyUploadToken('garbage')).toBeNull();
    const expired = await st.createUploadAuthorization('private/x/a.mp4', 'video/mp4', 1, -5);
    expect(st.verifyUploadToken(expired.url.split('/').pop()!)).toBeNull();
    const other = new LocalStorageService({ localDir: dir } as never, new KeyService({ secret: 'z'.repeat(40) } as never));
    expect(other.verifyUploadToken(token)).toBeNull(); // signed with a different secret
  });
});

describe('S3StorageService presigning (offline: signing needs no network)', () => {
  const cfg = { s3: { bucket: 'aivistro-media', region: 'auto', endpoint: 'https://abc123.r2.cloudflarestorage.com', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'SECRETEXAMPLEKEY123', forcePathStyle: false } } as never;
  const s3 = new S3StorageService(cfg);

  it('issues a short-lived write-only upload URL for ONE key, bound to the Content-Type, without leaking the secret', async () => {
    const u = await s3.createUploadAuthorization('private/source/5/9-abc.mp4', 'video/mp4', 1000, 900);
    const url = new URL(u.url);
    expect(url.hostname).toBe('aivistro-media.abc123.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/private/source/5/9-abc.mp4');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-type');
    expect(u.headers).toEqual({ 'Content-Type': 'video/mp4' });
    expect(u.url).not.toContain('SECRETEXAMPLEKEY123');
    expect(u.url).toContain('AKIDEXAMPLE'); // the PUBLIC key id is part of every presigned URL by design
    expect(u.expiresAt.getTime()).toBeGreaterThan(Date.now() + 800_000);
  });
  it('issues a 60-second read URL for a segment, and refuses unsafe keys', async () => {
    const u = new URL((await s3.presignGet('private/hls/1/g1/720p/seg_0000.ts', 60)) as string);
    expect(u.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(u.searchParams.get('response-cache-control')).toBe('private, no-store');
    await expect(s3.presignGet('../private/x', 60)).rejects.toThrow(/Unsafe/);
    await expect(s3.createUploadAuthorization('a/../b', 'video/mp4', 1, 60)).rejects.toThrow(/Unsafe/);
  });
});

describe('log redaction', () => {
  it('never lets playback or upload tokens reach the logs', () => {
    expect(redactUrl('/api/v1/media/hls/abcDEF123-_secretToken/720p/seg_0000.ts?x=1')).toBe('/api/v1/media/hls/[redacted]/720p/seg_0000.ts?x=1');
    expect(redactUrl('/api/v1/media/hls/tok/master.m3u8')).toBe('/api/v1/media/hls/[redacted]/master.m3u8');
    expect(redactUrl('/api/v1/storage/local/body.sig')).toBe('/api/v1/storage/local/[redacted]');
    expect(redactUrl('/api/v1/series/3')).toBe('/api/v1/series/3');
  });
});
