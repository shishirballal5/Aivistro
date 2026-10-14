import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { hmacSha256Hex } from '../src/common/crypto/crypto.util';
import { KeyService } from '../src/common/crypto/key.service';
import { StorageService } from '../src/modules/storage/storage.service';
import { createApp } from './helpers';
import { adminToken, bearer, http, resetData, viewerViaOtp } from './factories';

// Real (tiny but valid) image files.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
function makePng(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0]))), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = makePng();
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>alert(1)</script></svg>');
const FILES = { 'image/jpeg': { buf: JPEG, name: 'poster.jpg', ext: 'jpg' }, 'image/png': { buf: PNG, name: 'banner.png', ext: 'png' }, 'image/webp': { buf: WEBP, name: 'thumb.webp', ext: 'webp' } } as const;

describe('admin image upload + public serving (real MySQL, Redis, local storage)', () => {
  let app: NestExpressApplication; let work: string;
  let editor: string; let admin: string; let support: string;
  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), 'aiv-img-test-'));
    app = await createApp({ STORAGE_LOCAL_DIR: join(work, 'storage'), MEDIA_PUBLIC_BASE_URL: '/api/v1/media' });
    await resetData(app);
    admin = await adminToken(app, ['SUPER_ADMIN']); editor = await adminToken(app, ['EDITOR']); support = await adminToken(app, ['SUPPORT']);
  });
  afterAll(async () => { await app.close(); await rm(work, { recursive: true, force: true }); });

  const api = (p: string) => `/api/v1${p}`;
  const request = (body: object, token = editor) => http(app).post(api('/admin/images')).set(bearer(token)).send(body);
  const complete = (key: string, token = editor) => http(app).post(api('/admin/images/complete')).set(bearer(token)).send({ key });
  const put = (url: string, buf: Buffer, type: string) => http(app).put(url).set('Content-Type', type).send(buf);
  async function reserve(type: keyof typeof FILES, size = FILES[type].buf.length) {
    const res = await request({ filename: FILES[type].name, contentType: type, sizeBytes: size }).expect(201);
    return res.body as { key: string; upload: { url: string; method: string; headers: Record<string, string>; expiresAt: string } };
  }

  describe.each(Object.keys(FILES) as (keyof typeof FILES)[])('happy path %s', (type) => {
    it('request, PUT, complete, then the public URL serves the exact bytes with safe headers', async () => {
      const f = FILES[type];
      const r = await reserve(type);
      expect(r.key).toMatch(new RegExp(`^images/\\d{4}/\\d{2}/[A-Za-z0-9_-]{22,}\\.${f.ext}$`));
      expect(r.upload.method).toBe('PUT');
      expect(r.upload.headers['Content-Type']).toBe(type);
      await put(r.upload.url, f.buf, type).expect(200);
      const done = (await complete(r.key).expect(200)).body as { key: string; url: string };
      expect(done).toEqual({ key: r.key, url: `/api/v1/media/${r.key}` });
      const pub = await http(app).get(done.url).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
      expect(Buffer.compare(pub.body as Buffer, f.buf)).toBe(0);
      expect(pub.headers['content-type']).toBe(type);
      expect(pub.headers['x-content-type-options']).toBe('nosniff');
      expect(pub.headers['cache-control']).toContain('immutable');
    });
  });

  it('keys are unguessable and unique per request', async () => {
    const keys = new Set<string>();
    for (let i = 0; i < 5; i++) keys.add((await reserve('image/png')).key);
    expect(keys.size).toBe(5);
  });

  describe('request validation', () => {
    it.each([
      ['svg type', { filename: 'a.svg', contentType: 'image/svg+xml', sizeBytes: 100 }],
      ['gif type', { filename: 'a.gif', contentType: 'image/gif', sizeBytes: 100 }],
      ['html type', { filename: 'a.html', contentType: 'text/html', sizeBytes: 100 }],
      ['path-ish filename', { filename: '../../etc/passwd.png', contentType: 'image/png', sizeBytes: 100 }],
      ['slash in filename', { filename: 'a/b.png', contentType: 'image/png', sizeBytes: 100 }],
      ['backslash filename', { filename: 'a\\b.png', contentType: 'image/png', sizeBytes: 100 }],
      ['double dot filename', { filename: 'a..b.png', contentType: 'image/png', sizeBytes: 100 }],
      ['extension/type mismatch', { filename: 'a.png', contentType: 'image/jpeg', sizeBytes: 100 }],
      ['zero size', { filename: 'a.png', contentType: 'image/png', sizeBytes: 0 }],
      ['negative size', { filename: 'a.png', contentType: 'image/png', sizeBytes: -5 }],
      ['oversize', { filename: 'a.png', contentType: 'image/png', sizeBytes: 5 * 1024 * 1024 + 1 }],
      ['fractional size', { filename: 'a.png', contentType: 'image/png', sizeBytes: 10.5 }],
      ['missing fields', {}],
    ])('rejects %s with 400', async (_n, body) => { await request(body).expect(400); });
    it('accepts exactly 5 MB', async () => { await request({ filename: 'a.png', contentType: 'image/png', sizeBytes: 5 * 1024 * 1024 }).expect(201); });
    it('complete rejects keys that were not minted by the server', async () => {
      for (const key of ['images/poster.jpg', 'images/../x.jpg', 'private/source/1/a.mp4', 'images/2026/10/short.jpg', 'images/2026/10/aaaaaaaaaaaaaaaaaaaaaaaaaaaa.svg']) await complete(key).expect(400);
    });
  });

  describe('complete verifies what is really stored', () => {
    it('wrong type: a PNG uploaded under a JPEG authorisation is deleted and rejected', async () => {
      const r = await reserve('image/jpeg', PNG.length);
      await put(r.upload.url, PNG, 'image/jpeg').expect(200);
      const res = await complete(r.key).expect(400);
      expect(res.body.code).toBe('IMAGE_CONTENT_MISMATCH');
      expect(await app.get(StorageService).stat(r.key)).toBeNull();
    });
    it('svg disguised as png (magic bytes) is deleted and rejected', async () => {
      const r = await reserve('image/png', SVG.length);
      await put(r.upload.url, SVG, 'image/png').expect(200);
      const res = await complete(r.key).expect(400);
      expect(res.body.code).toBe('IMAGE_CONTENT_MISMATCH');
      expect(await app.get(StorageService).stat(r.key)).toBeNull();
      await http(app).get(api(`/media/${r.key}`)).expect(404);
    });
    it('html disguised as webp is rejected', async () => {
      const html = Buffer.from('<html><body>RIFF....WEBP</body></html>');
      const r = await reserve('image/webp', html.length);
      await put(r.upload.url, html, 'image/webp').expect(200);
      await complete(r.key).expect(400);
    });
    it('RIFF container that is not WEBP (e.g. WAVE) is rejected', async () => {
      const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WAVEfmt '), Buffer.alloc(20)]);
      const r = await reserve('image/webp', wav.length);
      await put(r.upload.url, wav, 'image/webp').expect(200);
      await complete(r.key).expect(400);
    });
    it('oversize: the upload endpoint refuses a body larger than declared', async () => {
      const r = await reserve('image/png', PNG.length);
      const res = await put(r.upload.url, Buffer.concat([PNG, Buffer.alloc(1000)]), 'image/png');
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await app.get(StorageService).stat(r.key)).toBeNull();
    });
    it('a different Content-Type on the PUT is refused', async () => {
      const r = await reserve('image/png');
      await put(r.upload.url, PNG, 'image/jpeg').expect(400);
    });
    it('size that differs from the declared size is deleted and rejected on complete (object written behind the API)', async () => {
      const r = await reserve('image/png', PNG.length);
      await app.get(StorageService).put(r.key, Buffer.concat([PNG, Buffer.alloc(10)]), 'image/png'); // simulates a bucket that did not enforce Content-Length
      const res = await complete(r.key).expect(400);
      expect(res.body.code).toBe('UPLOAD_SIZE_MISMATCH');
      expect(await app.get(StorageService).stat(r.key)).toBeNull();
    });
    it('an object over 5 MB written behind the API is deleted and rejected', async () => {
      const r = await reserve('image/png', PNG.length);
      await app.get(StorageService).put(r.key, Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), 'image/png');
      await complete(r.key).expect(400);
      expect(await app.get(StorageService).stat(r.key)).toBeNull();
    });
    it('complete without any upload is a 409', async () => {
      const r = await reserve('image/png');
      const res = await complete(r.key).expect(409);
      expect(res.body.code).toBe('UPLOAD_NOT_FOUND');
    });
    it('double complete is idempotent and re-verifies; the verified object cannot be overwritten', async () => {
      const r = await reserve('image/png');
      await put(r.upload.url, PNG, 'image/png').expect(200);
      const a = (await complete(r.key).expect(200)).body; const b = (await complete(r.key).expect(200)).body;
      expect(b).toEqual(a);
      const again = await put(r.upload.url, Buffer.alloc(PNG.length, 0x41), 'image/png'); // same, still-valid token
      expect(again.status).toBe(409);
      await complete(r.key).expect(200);
      const pub = await http(app).get(api(`/media/${r.key}`)).expect(200);
      expect(pub.headers['content-type']).toBe('image/png');
    });
  });

  describe('upload token', () => {
    it('a tampered token is refused', async () => {
      const r = await reserve('image/png');
      const [body, sig] = r.upload.url.split('/').pop()!.split('.');
      const claims = JSON.parse(Buffer.from(body, 'base64url').toString()); claims.k = 'images/2026/10/aaaaaaaaaaaaaaaaaaaaaaaa.png';
      const forged = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${sig}`;
      await put(`/api/v1/storage/local/${forged}`, PNG, 'image/png').expect(403);
      await put(`${r.upload.url}x`, PNG, 'image/png').expect(403);
    });
    it('an expired token is refused', async () => {
      const keys = app.get(KeyService);
      const body = Buffer.from(JSON.stringify({ k: 'images/2026/10/bbbbbbbbbbbbbbbbbbbbbbbb.png', t: 'image/png', s: PNG.length, e: Date.now() - 1000 })).toString('base64url');
      const token = `${body}.${hmacSha256Hex(keys.mediaSigning, body)}`;
      await put(`/api/v1/storage/local/${token}`, PNG, 'image/png').expect(403);
    });
  });

  describe('public serving is locked down', () => {
    beforeAll(async () => {
      await mkdir(join(work, 'storage', 'private'), { recursive: true });
      await writeFile(join(work, 'storage', 'private', 'secret.txt'), 'TOP SECRET');
      await writeFile(join(work, 'secret-outside.txt'), 'OUTSIDE');
      const r = await reserve('image/png'); await put(r.upload.url, PNG, 'image/png'); await complete(r.key);
    });
    const hit = (p: string) => http(app).get(p);
    it.each([
      '/api/v1/media/images/../private/secret.txt',
      '/api/v1/media/images/%2e%2e/private/secret.txt',
      '/api/v1/media/images/%2e%2e%2fprivate%2fsecret.txt',
      '/api/v1/media/images/..%2fprivate%2fsecret.txt',
      '/api/v1/media/images/2026/%2e%2e/%2e%2e/private/secret.txt',
      '/api/v1/media/images//etc/passwd',
      '/api/v1/media/images/%2Fetc%2Fpasswd',
      '/api/v1/media/images/%252e%252e/private/secret.txt',
      '/api/v1/media/images/..\\..\\private\\secret.txt',
      '/api/v1/media/images/x.png%00.txt',
    ])('%s is not served', async (p) => {
      const res = await hit(p);
      expect([400, 403, 404]).toContain(res.status);
      expect(JSON.stringify(res.body) + res.text).not.toMatch(/TOP SECRET|OUTSIDE|root:/);
    });
    it('no directory listing, no non-image extensions, no private keys', async () => {
      await hit('/api/v1/media/images/').expect(404);
      await hit('/api/v1/media/images').expect(404);
      await hit('/api/v1/media/images/2026').expect(404);
      await hit(`/api/v1/media/images/${new Date().getUTCFullYear()}/`).expect(404);
      await hit('/api/v1/media/private/secret.txt').expect(404);
      await hit('/api/v1/media/images/x.svg').expect(404);
    });
    it('needs no login', async () => {
      const r = await reserve('image/jpeg'); await put(r.upload.url, JPEG, 'image/jpeg'); await complete(r.key);
      await hit(`/api/v1/media/${r.key}`).expect(200);
    });
  });

  describe('permissions', () => {
    it('EDITOR and SUPER_ADMIN may upload', async () => { await request({ filename: 'a.png', contentType: 'image/png', sizeBytes: 10 }, editor).expect(201); await request({ filename: 'a.png', contentType: 'image/png', sizeBytes: 10 }, admin).expect(201); });
    it('SUPPORT gets 403 on both endpoints', async () => {
      await request({ filename: 'a.png', contentType: 'image/png', sizeBytes: 10 }, support).expect(403);
      await complete('images/2026/10/aaaaaaaaaaaaaaaaaaaaaaaa.png', support).expect(403);
    });
    it('a viewer token and anonymous callers get 401', async () => {
      const v = await viewerViaOtp(app);
      await request({ filename: 'a.png', contentType: 'image/png', sizeBytes: 10 }, v.accessToken).expect(401);
      await http(app).post(api('/admin/images')).send({ filename: 'a.png', contentType: 'image/png', sizeBytes: 10 }).expect(401);
      await http(app).post(api('/admin/images/complete')).send({ key: 'images/2026/10/aaaaaaaaaaaaaaaaaaaaaaaa.png' }).expect(401);
    });
    it('both calls are written to the audit log', async () => {
      const r = await reserve('image/png'); await put(r.upload.url, PNG, 'image/png'); await complete(r.key);
      const rows: { action: string }[] = await app.get(require('typeorm').DataSource).query("SELECT action FROM audit_logs WHERE action LIKE 'image.%'");
      expect(rows.map((x) => x.action)).toEqual(expect.arrayContaining(['image.upload_requested', 'image.upload_completed']));
    });
  });

  describe('images are catalog-usable', () => {
    it('a completed key can be set as series poster, and null clears it (see catalog-reorder spec for the full matrix)', async () => {
      const r = await reserve('image/png'); await put(r.upload.url, PNG, 'image/png'); await complete(r.key);
      const g = (await http(app).post(api('/admin/genres')).set(bearer(admin)).send({ name: `G${Date.now()}` }).expect(201)).body;
      const s = (await http(app).post(api('/admin/series')).set(bearer(editor)).send({ title: `S${Date.now()}`, synopsis: 'A story that needs a poster.', posterKey: r.key, genreIds: [g.id] }).expect(201)).body;
      expect(s.posterUrl).toBe(`/api/v1/media/${r.key}`);
      expect(await stat(join(work, 'storage', r.key))).toBeTruthy();
    });
  });
});

describe('public image route with STORAGE_DRIVER=s3', () => {
  let app: NestExpressApplication;
  beforeAll(async () => { app = await createApp({ STORAGE_DRIVER: 's3', S3_BUCKET: 'test-bucket', S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'AKIATEST', S3_SECRET_ACCESS_KEY: 'secret', MEDIA_PUBLIC_BASE_URL: 'https://cdn.aivistro.test' }); });
  afterAll(async () => { await app.close(); });
  it('returns 404 (the bucket/CDN serves images)', async () => {
    await http(app).get('/api/v1/media/images/2026/10/aaaaaaaaaaaaaaaaaaaaaaaa.png').expect(404);
  });
  it('request issues a presigned PUT for the bucket (not executed against a live bucket)', async () => {
    const editor = await adminToken(app, ['EDITOR']);
    const res = await http(app).post('/api/v1/admin/images').set(bearer(editor)).send({ filename: 'a.png', contentType: 'image/png', sizeBytes: 100 }).expect(201);
    expect(res.body.upload.url).toMatch(/^https:\/\/.*test-bucket.*X-Amz-Signature=/);
    expect(res.body.upload.method).toBe('PUT');
  });
});
