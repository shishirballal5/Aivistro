import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { encryptString, sha256Hex } from '../src/common/crypto/crypto.util';
import { KeyService } from '../src/common/crypto/key.service';
import { PlaybackSession, User, UserStatus, VideoAsset, VideoStatus } from '../src/database/entities/index';
import { StorageService } from '../src/modules/storage/storage.service';
import { createApp } from './helpers';
import { addReadyAsset, adminToken, bearer, dsOf, getBinary, http, resetData, subscribedViewer, viewerViaOtp } from './factories';

describe('playback authorisation and protected media delivery (real MySQL + Redis)', () => {
  let app: NestExpressApplication;
  let dir: string;
  let editor: string;
  let admin: string;
  const KEY = randomBytes(16);
  const SEG0 = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
  const PLAYLIST = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-KEY:METHOD=AES-128,URI="../enc.key"\n#EXTINF:4.0,\nseg_0000.ts\n#EXT-X-ENDLIST\n';

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aiv-play-'));
    app = await createApp({ STORAGE_LOCAL_DIR: dir, MAX_CONCURRENT_STREAMS: '2' });
  });
  afterAll(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  beforeEach(async () => { await resetData(app); admin = await adminToken(app, ['SUPER_ADMIN']); editor = await adminToken(app, ['EDITOR']); });

  const api = (p: string) => `/api/v1${p}`;
  let n = 0; const uniq = (p: string) => `${p} ${Date.now()}-${++n}`;
  const storage = () => app.get(StorageService);

  /** A live series with one episode whose video is READY, with real files in storage so media endpoints can be exercised. */
  async function fixture() {
    const g = (await http(app).post(api('/admin/genres')).set(bearer(admin)).send({ name: uniq('G') }).expect(201)).body;
    const s = (await http(app).post(api('/admin/series')).set(bearer(editor)).send({ title: uniq('Show'), synopsis: 'A story worth watching tonight.', posterKey: 'images/a.jpg', genreIds: [g.id] }).expect(201)).body;
    const e = (await http(app).post(api(`/admin/series/${s.id}/episodes`)).set(bearer(editor)).send({ title: 'Pilot' }).expect(201)).body;
    const assetId = await addReadyAsset(app, e.id, { encryptionKeyEnc: encryptString(app.get(KeyService).mediaEncryption, KEY) });
    const prefix = `private/hls/pf-${assetId}/g1/`;
    await dsOf(app).query('UPDATE video_assets SET hls_prefix = ? WHERE id = ?', [prefix, assetId]);
    await storage().put(`${prefix}720p/index.m3u8`, Buffer.from(PLAYLIST), 'application/vnd.apple.mpegurl');
    await storage().put(`${prefix}720p/seg_0000.ts`, SEG0, 'video/mp2t');
    await http(app).post(api(`/admin/episodes/${e.id}/publish`)).set(bearer(editor)).expect(200);
    await http(app).post(api(`/admin/series/${s.id}/publish`)).set(bearer(editor)).expect(200);
    return { series: s as { id: string }, ep: e as { id: string }, assetId };
  }
  const start = (token: string, episodeId: string) => http(app).post(api(`/episodes/${episodeId}/playback-session`)).set(bearer(token));
  const sessionsCount = () => dsOf(app).getRepository(PlaybackSession).count();
  const baseOf = (manifestUrl: string) => manifestUrl.replace('master.m3u8', '');

  describe('who can obtain a playback session', () => {
    it('a signed-in user WITHOUT a subscription never receives a token (SUBSCRIPTION_REQUIRED), and nothing is created', async () => {
      const { ep } = await fixture();
      const free = await viewerViaOtp(app);
      const r = await start(free.accessToken, ep.id).expect(403);
      expect(r.body.code).toBe('SUBSCRIPTION_REQUIRED');
      expect(JSON.stringify(r.body)).not.toMatch(/manifest|token|m3u8/i);
      expect(await sessionsCount()).toBe(0);
    });

    it('anonymous callers are rejected with 401, and a tampered token too', async () => {
      const { ep } = await fixture();
      await http(app).post(api(`/episodes/${ep.id}/playback-session`)).expect(401);
      const sub = await subscribedViewer(app);
      await start(`${sub.token.slice(0, -3)}abc`, ep.id).expect(401);
      expect(await sessionsCount()).toBe(0);
    });

    it('an EXPIRED subscription is refused with SUBSCRIPTION_EXPIRED', async () => {
      const { ep } = await fixture();
      const sub = await subscribedViewer(app);
      await dsOf(app).query('UPDATE entitlements SET starts_at = NOW(3) - INTERVAL 2 MONTH, ends_at = NOW(3) - INTERVAL 1 DAY WHERE user_id = ?', [sub.id]);
      expect((await start(sub.token, ep.id).expect(403)).body.code).toBe('SUBSCRIPTION_EXPIRED');
      expect(await sessionsCount()).toBe(0);
    });

    it('a revoked entitlement and a refunded purchase are refused', async () => {
      const { ep } = await fixture();
      const sub = await subscribedViewer(app);
      await dsOf(app).query("UPDATE entitlements SET revoked_at = NOW(3) WHERE user_id = ?", [sub.id]);
      await start(sub.token, ep.id).expect(403);
    });

    it('a suspended account is refused with ACCOUNT_SUSPENDED', async () => {
      const { ep } = await fixture();
      const sub = await subscribedViewer(app);
      await dsOf(app).getRepository(User).update(sub.id, { status: UserStatus.Suspended });
      const r = await start(sub.token, ep.id).expect(403);
      expect(r.body.code).toBe('ACCOUNT_SUSPENDED');
    });

    it.each([
      ['a draft episode', "status = 'DRAFT', published_at = NULL"],
      ['an archived episode', "status = 'ARCHIVED'"],
      ['an episode scheduled for the future', "status = 'SCHEDULED', published_at = NULL, publish_at = NOW(3) + INTERVAL 1 DAY"],
      ['an episode whose release time has not come', 'published_at = NOW(3) + INTERVAL 1 DAY'],
      ['an episode with no video', 'current_asset_id = NULL'],
    ])('%s is EPISODE_NOT_AVAILABLE (404) even for a paying subscriber', async (_l, set) => {
      const { ep } = await fixture();
      const sub = await subscribedViewer(app);
      await dsOf(app).query(`UPDATE episodes SET ${set} WHERE id = ?`, [ep.id]);
      const r = await start(sub.token, ep.id).expect(404);
      expect(r.body.code).toBe('EPISODE_NOT_AVAILABLE');
      expect(await sessionsCount()).toBe(0);
    });

    it('an unpublished SERIES hides its episodes; unknown and hidden episodes answer identically', async () => {
      const { series, ep } = await fixture();
      const sub = await subscribedViewer(app);
      await http(app).post(api(`/admin/series/${series.id}/unpublish`)).set(bearer(editor)).expect(200);
      const hidden = await start(sub.token, ep.id).expect(404);
      const missing = await start(sub.token, '987654').expect(404);
      const junk = await start(sub.token, 'abc').expect(404);
      expect(hidden.body.code).toBe(missing.body.code);
      expect(hidden.body.message).toBe(missing.body.message);
      expect(junk.body.code).toBe('EPISODE_NOT_AVAILABLE');
    });

    it('an asset still processing => VIDEO_PROCESSING (409); a FAILED or unusable asset => not available', async () => {
      const { ep, assetId } = await fixture();
      const sub = await subscribedViewer(app);
      for (const st of [VideoStatus.Processing, VideoStatus.Uploaded]) {
        await dsOf(app).getRepository(VideoAsset).update(assetId, { status: st });
        expect((await start(sub.token, ep.id).expect(409)).body.code).toBe('VIDEO_PROCESSING');
      }
      await dsOf(app).getRepository(VideoAsset).update(assetId, { status: VideoStatus.Failed });
      expect((await start(sub.token, ep.id).expect(404)).body.code).toBe('EPISODE_NOT_AVAILABLE');
      expect(await sessionsCount()).toBe(0);
    });

    it('seeing an episode in a list, or its access state, grants NOTHING: only an explicit, re-verified session request does', async () => {
      const { series, ep } = await fixture();
      const free = await viewerViaOtp(app);
      const list = (await http(app).get(api(`/series/${series.id}/episodes`)).set(bearer(free.accessToken)).expect(200)).body;
      expect(list.items[0].access.allowed).toBe(false);
      expect(JSON.stringify(list)).not.toMatch(/manifest|m3u8|token/i);
      await start(free.accessToken, ep.id).expect(403);

      const sub = await subscribedViewer(app);
      const subList = (await http(app).get(api(`/series/${series.id}/episodes`)).set(bearer(sub.token)).expect(200)).body;
      expect(subList.items[0].access.allowed).toBe(true); // allowed to ASK...
      expect(JSON.stringify(subList)).not.toMatch(/manifest|m3u8|token/i); // ...but the list carries no media authorisation
      expect(await sessionsCount()).toBe(0);
    });

    it('nothing the client sends can change the decision', async () => {
      const { ep } = await fixture();
      const free = await viewerViaOtp(app);
      await http(app).post(api(`/episodes/${ep.id}/playback-session?subscribed=true&free=1`)).set(bearer(free.accessToken)).set('x-subscribed', 'true').set('x-plan', 'annual').send({ subscribed: true, plan: 'annual' }).expect(403);
      expect(await sessionsCount()).toBe(0);
    });
  });

  describe('using the media endpoints', () => {
    it('a subscriber gets a token and can fetch master, variant, key and segment (with Range support)', async () => {
      const { ep } = await fixture();
      const sub = await subscribedViewer(app);
      const s = (await start(sub.token, ep.id).expect(201)).body;
      expect(s).toMatchObject({ heartbeatIntervalSeconds: 30, episode: { id: ep.id, number: 1 } });
      const base = baseOf(s.manifestUrl);
      const master = await http(app).get(s.manifestUrl).expect(200);
      expect(master.text).toContain('720p/index.m3u8');
      expect(master.headers['content-type']).toMatch(/mpegurl/);
      expect((await http(app).get(`${base}720p/index.m3u8`).expect(200)).text).toBe(PLAYLIST);
      expect(((await getBinary(app, `${base}enc.key`).expect(200)).body as Buffer).equals(KEY)).toBe(true);
      expect(((await getBinary(app, `${base}720p/seg_0000.ts`).expect(200)).body as Buffer).equals(SEG0)).toBe(true);
      const part = await getBinary(app, `${base}720p/seg_0000.ts`, { Range: 'bytes=10-19' }).expect(206);
      expect((part.body as Buffer).equals(SEG0.subarray(10, 20))).toBe(true);
      expect(part.headers['content-range']).toBe('bytes 10-19/1000');
      for (const url of [s.manifestUrl, `${base}720p/index.m3u8`, `${base}enc.key`, `${base}720p/seg_0000.ts`]) {
        const r = await http(app).get(url);
        expect(r.headers['cache-control']).toBe('no-store');
        expect(r.headers['referrer-policy']).toBe('no-referrer');
      }
    });

    it('media requests need ONLY the token (no Authorization header), and ignore any other identity', async () => {
      const { ep } = await fixture();
      const sub = await subscribedViewer(app);
      const other = await viewerViaOtp(app);
      const s = (await start(sub.token, ep.id).expect(201)).body;
      await http(app).get(s.manifestUrl).expect(200);
      await http(app).get(s.manifestUrl).set(bearer(other.accessToken)).expect(200); // someone else's login does not matter, the token decides
    });

    it('invalid, malformed, truncated, altered and unknown tokens are all rejected identically', async () => {
      const { ep } = await fixture();
      const sub = await subscribedViewer(app);
      const s = (await start(sub.token, ep.id).expect(201)).body;
      const token = s.manifestUrl.split('/')[5];
      const bad = ['x', 'a'.repeat(43), token.slice(0, -1), `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`, token.toUpperCase(), `${token}extra`, '..', '%2e%2e'];
      const bodies = [];
      for (const t of bad) { const r = await http(app).get(`/api/v1/media/hls/${t}/master.m3u8`); expect([401, 404]).toContain(r.status); if (r.status === 401) bodies.push(r.body.code); }
      expect(new Set(bodies)).toEqual(new Set(['PLAYBACK_TOKEN_INVALID']));
      await http(app).get(`/api/v1/media/hls/${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}/enc.key`).expect(401);
    });

    it('only the SHA-256 hash of the token is stored', async () => {
      const { ep } = await fixture();
      const sub = await subscribedViewer(app);
      const s = (await start(sub.token, ep.id).expect(201)).body;
      const token = s.manifestUrl.split('/')[5];
      const [row] = await dsOf(app).query('SELECT token_hash FROM playback_sessions WHERE id = ?', [s.sessionId]);
      expect(row.token_hash).toBe(sha256Hex(token));
      expect(JSON.stringify(await dsOf(app).query('SELECT * FROM playback_sessions'))).not.toContain(token);
    });

    it('cannot be coaxed into serving other files: path tricks, unknown variants, odd segment names', async () => {
      const { ep } = await fixture();
      const sub = await subscribedViewer(app);
      const base = baseOf((await start(sub.token, ep.id).expect(201)).body.manifestUrl);
      for (const path of ['..%2F..%2Fsecret/index.m3u8', '1080p/index.m3u8', '720p/seg_0001.ts', '720p/seg_0000.ts.bak', '720p/..%2Fenc.key', '720p/seg_00.ts', '720p/%2e%2e%2f%2e%2e%2fetc%2fpasswd', 'nope/seg_0000.ts', 'subs/..%2Fx.vtt', 'subs/fr.m3u8']) {
        const r = await http(app).get(`${base}${path}`);
        expect([404]).toContain(r.status);
      }
    });
  });

  describe('lifetime and revocation', () => {
    it('heartbeats keep the session alive up to a hard cap, and validate the playback position', async () => {
      const { ep } = await fixture();
      const sub = await subscribedViewer(app);
      const s = (await start(sub.token, ep.id).expect(201)).body;
      const hb = (body: object) => http(app).post(api(`/playback-sessions/${s.sessionId}/heartbeat`)).set(bearer(sub.token)).send(body);
      await dsOf(app).query('UPDATE playback_sessions SET expires_at = NOW(3) + INTERVAL 5 SECOND WHERE id = ?', [s.sessionId]);
      const ok = (await hb({ positionSeconds: 42 }).expect(200)).body;
      expect(new Date(ok.expiresAt).getTime()).toBeGreaterThan(Date.now() + 250_000); // pushed out by the TTL
      expect((await dsOf(app).query('SELECT position_seconds AS p FROM playback_sessions WHERE id = ?', [s.sessionId]))[0].p).toBe(42);

      await dsOf(app).query('UPDATE playback_sessions SET hard_expires_at = NOW(3) + INTERVAL 20 SECOND WHERE id = ?', [s.sessionId]);
      const capped = (await hb({}).expect(200)).body;
      expect(new Date(capped.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 21_000); // a heartbeat can never outlive the hard cap

      await hb({ positionSeconds: -1 }).expect(400);
      await hb({ positionSeconds: 'abc' }).expect(400);
      await hb({ positionSeconds: 99999 }).expect(400);
      await hb({ role: 'admin' }).expect(400);
    });

    it('an idle session expires on its own (media 401, heartbeat 409) and a hard-expired one cannot be revived', async () => {
      const { ep } = await fixture();
      const sub = await subscribedViewer(app);
      const s = (await start(sub.token, ep.id).expect(201)).body;
      await dsOf(app).query('UPDATE playback_sessions SET expires_at = NOW(3) - INTERVAL 1 SECOND WHERE id = ?', [s.sessionId]);
      await http(app).get(s.manifestUrl).expect(401);
      const hb = await http(app).post(api(`/playback-sessions/${s.sessionId}/heartbeat`)).set(bearer(sub.token)).send({}).expect(409);
      expect(hb.body.code).toBe('PLAYBACK_SESSION_EXPIRED');
      const s2 = (await start(sub.token, ep.id).expect(201)).body;
      await dsOf(app).query('UPDATE playback_sessions SET hard_expires_at = NOW(3) - INTERVAL 1 SECOND WHERE id = ?', [s2.sessionId]);
      await http(app).get(s2.manifestUrl).expect(401);
    });

    it('ending a session kills its token; ending twice is harmless; other people cannot end or ping it', async () => {
      const { ep } = await fixture();
      const sub = await subscribedViewer(app); const other = await subscribedViewer(app);
      const s = (await start(sub.token, ep.id).expect(201)).body;
      await http(app).delete(api(`/playback-sessions/${s.sessionId}`)).set(bearer(other.token)).expect(404);
      await http(app).post(api(`/playback-sessions/${s.sessionId}/heartbeat`)).set(bearer(other.token)).send({}).expect(404);
      await http(app).get(s.manifestUrl).expect(200); // the failed attempts did not disturb it
      await http(app).delete(api(`/playback-sessions/${s.sessionId}`)).set(bearer(sub.token)).expect(204);
      await http(app).delete(api(`/playback-sessions/${s.sessionId}`)).set(bearer(sub.token)).expect(204);
      await http(app).get(s.manifestUrl).expect(401);
      expect((await http(app).post(api(`/playback-sessions/${s.sessionId}/heartbeat`)).set(bearer(sub.token)).send({}).expect(409)).body.code).toBe('PLAYBACK_SESSION_ENDED');
      await http(app).delete(api('/playback-sessions/abc')).set(bearer(sub.token)).expect(404);
      await http(app).delete(api(`/playback-sessions/${s.sessionId}`)).expect(401);
    });

    it('a subscription that ends mid-episode stops the stream at the next heartbeat', async () => {
      const { ep } = await fixture();
      const sub = await subscribedViewer(app);
      const s = (await start(sub.token, ep.id).expect(201)).body;
      await http(app).get(s.manifestUrl).expect(200);
      await dsOf(app).query('UPDATE entitlements SET starts_at = NOW(3) - INTERVAL 2 MONTH, ends_at = NOW(3) - INTERVAL 1 SECOND WHERE user_id = ?', [sub.id]);
      const hb = await http(app).post(api(`/playback-sessions/${s.sessionId}/heartbeat`)).set(bearer(sub.token)).send({}).expect(403);
      expect(hb.body.code).toBe('SUBSCRIPTION_EXPIRED');
      await http(app).get(s.manifestUrl).expect(401); // and the token died with it
    });

    it('a REFUND cuts the stream immediately, without waiting for a heartbeat', async () => {
      const { ep } = await fixture();
      const sub = await subscribedViewer(app, 'annual');
      const s = (await start(sub.token, ep.id).expect(201)).body;
      await http(app).get(s.manifestUrl).expect(200);
      const [p] = await dsOf(app).query('SELECT id FROM payments WHERE user_id = ?', [sub.id]);
      const fin = await adminToken(app, ['FINANCE']);
      await http(app).post(api(`/admin/payments/${p.id}/refund`)).set(bearer(fin)).send({ reason: 'Refund mid-stream' }).expect(200);
      await http(app).get(s.manifestUrl).expect(401);
      await start(sub.token, ep.id).expect(403);
    });

    it('revoking the subscription or suspending the account cuts the stream immediately', async () => {
      const { ep } = await fixture();
      const a = await subscribedViewer(app); const b = await subscribedViewer(app);
      const sa = (await start(a.token, ep.id).expect(201)).body;
      const sb = (await start(b.token, ep.id).expect(201)).body;
      const fin = await adminToken(app, ['FINANCE']); const support = await adminToken(app, ['SUPPORT']);
      const [subRow] = await dsOf(app).query('SELECT id FROM subscriptions WHERE user_id = ?', [a.id]);
      await http(app).post(api(`/admin/subscriptions/${subRow.id}/revoke`)).set(bearer(fin)).send({ reason: 'fraud' }).expect(200);
      await http(app).get(sa.manifestUrl).expect(401);
      await http(app).post(api(`/admin/users/${b.id}/suspend`)).set(bearer(support)).send({ reason: 'abuse' }).expect(200);
      await http(app).get(sb.manifestUrl).expect(401);
    });

    it('even a direct database suspension is honoured on the very next media request', async () => {
      const { ep } = await fixture();
      const sub = await subscribedViewer(app);
      const s = (await start(sub.token, ep.id).expect(201)).body;
      await http(app).get(s.manifestUrl).expect(200);
      await dsOf(app).getRepository(User).update(sub.id, { status: UserStatus.Suspended });
      await http(app).get(s.manifestUrl).expect(401);
    });

    it('if the asset is removed or fails after the session started, media requests stop', async () => {
      const { ep, assetId } = await fixture();
      const sub = await subscribedViewer(app);
      const s = (await start(sub.token, ep.id).expect(201)).body;
      await dsOf(app).getRepository(VideoAsset).update(assetId, { status: VideoStatus.Failed });
      await http(app).get(s.manifestUrl).expect(401);
    });
  });

  describe('concurrent streams', () => {
    it('allows 2 at once; a 3rd ends the OLDEST, which learns why', async () => {
      const { ep } = await fixture();
      const sub = await subscribedViewer(app);
      const s1 = (await start(sub.token, ep.id).expect(201)).body;
      await new Promise((r) => setTimeout(r, 30));
      const s2 = (await start(sub.token, ep.id).expect(201)).body;
      await http(app).get(s1.manifestUrl).expect(200);
      await http(app).get(s2.manifestUrl).expect(200);
      await new Promise((r) => setTimeout(r, 30));
      const s3 = (await start(sub.token, ep.id).expect(201)).body;
      expect(s3.endedOtherStreams).toBe(1);
      await http(app).get(s1.manifestUrl).expect(401);
      await http(app).get(s2.manifestUrl).expect(200);
      await http(app).get(s3.manifestUrl).expect(200);
      const hb = await http(app).post(api(`/playback-sessions/${s1.sessionId}/heartbeat`)).set(bearer(sub.token)).send({}).expect(409);
      expect(hb.body.code).toBe('PLAYBACK_SESSION_REVOKED');
      expect(hb.body.message).toMatch(/another device/);
    });

    it('six simultaneous play taps never leave more than 2 live sessions', async () => {
      const { ep } = await fixture();
      const sub = await subscribedViewer(app);
      const rs = await Promise.all(Array.from({ length: 6 }, () => start(sub.token, ep.id)));
      expect(rs.every((r) => r.status === 201)).toBe(true);
      const [{ n }] = await dsOf(app).query('SELECT COUNT(*) AS n FROM playback_sessions WHERE user_id = ? AND revoked_at IS NULL AND ended_at IS NULL AND expires_at > NOW(3)', [sub.id]);
      expect(Number(n)).toBeLessThanOrEqual(2);
    });

    it('is per user: one account streaming does not affect another', async () => {
      const { ep } = await fixture();
      const a = await subscribedViewer(app); const b = await subscribedViewer(app);
      const sa = (await start(a.token, ep.id).expect(201)).body;
      for (let i = 0; i < 3; i++) await start(b.token, ep.id).expect(201);
      await http(app).get(sa.manifestUrl).expect(200);
    });
  });

  it('with the S3/R2 driver a segment request is a 302 to a 60-second signed URL, issued only after the token check; the key never needs storage', async () => {
    const s3 = await createApp({ STORAGE_DRIVER: 's3', S3_BUCKET: 'aivistro-media', S3_REGION: 'auto', S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com', S3_ACCESS_KEY_ID: 'AKIDEXAMPLE', S3_SECRET_ACCESS_KEY: 'SECRETEXAMPLE123' });
    try {
      await resetData(s3);
      const root = await adminToken(s3, ['SUPER_ADMIN']);
      const ed = await adminToken(s3, ['EDITOR']);
      const g = (await http(s3).post(api('/admin/genres')).set(bearer(root)).send({ name: uniq('G') }).expect(201)).body;
      const sr = (await http(s3).post(api('/admin/series')).set(bearer(ed)).send({ title: uniq('S3Show'), synopsis: 'A story worth watching tonight.', posterKey: 'images/a.jpg', genreIds: [g.id] }).expect(201)).body;
      const e = (await http(s3).post(api(`/admin/series/${sr.id}/episodes`)).set(bearer(ed)).send({ title: 'Pilot' }).expect(201)).body;
      await addReadyAsset(s3, e.id, { encryptionKeyEnc: encryptString(s3.get(KeyService).mediaEncryption, KEY) });
      await http(s3).post(api(`/admin/episodes/${e.id}/publish`)).set(bearer(ed)).expect(200);
      await http(s3).post(api(`/admin/series/${sr.id}/publish`)).set(bearer(ed)).expect(200);
      const sub = await subscribedViewer(s3);
      const ses = (await http(s3).post(api(`/episodes/${e.id}/playback-session`)).set(bearer(sub.token)).expect(201)).body;
      const base = baseOf(ses.manifestUrl);
      const seg = await http(s3).get(`${base}720p/seg_0000.ts`).redirects(0).expect(302);
      const loc = new URL(seg.headers.location);
      expect(loc.hostname).toBe('aivistro-media.acct.r2.cloudflarestorage.com');
      expect(loc.searchParams.get('X-Amz-Expires')).toBe('60');
      expect(loc.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
      expect(seg.headers.location).not.toContain('SECRETEXAMPLE123');
      expect(seg.headers['cache-control']).toBe('no-store');
      expect(((await getBinary(s3, `${base}enc.key`).expect(200)).body as Buffer).equals(KEY)).toBe(true);
      await http(s3).get(`${ses.manifestUrl.replace(/\/[^/]+\/master\.m3u8$/, '/bogus-token-value-that-is-long-enough-xxxxxxxx/master.m3u8')}`).expect(401);
      await http(s3).get(`/api/v1/media/hls/${(() => { const t = ses.manifestUrl.split('/')[5]; return t.slice(0, -1) + (t.endsWith('Z') ? 'Y' : 'Z'); })()}/720p/seg_0000.ts`).redirects(0).expect(401); // no redirect without a valid token
    } finally { await s3.close(); }
  });
});
