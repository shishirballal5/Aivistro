import { NestExpressApplication } from '@nestjs/platform-express';
import Redis from 'ioredis';
import { AnalyticsEvent, WatchHistory, WatchProgress } from '../src/database/entities/index';
import { REDIS_CLIENT } from '../src/modules/redis/redis.module';
import { isCompleted, ProgressService } from '../src/modules/watch-history/progress.service';
import { createApp } from './helpers';
import { addReadyAsset, adminToken, bearer, dsOf, http, resetData, subscribedViewer, viewerViaOtp } from './factories';

describe('watch progress, continue-watching, history and watchlist (real MySQL + Redis)', () => {
  let app: NestExpressApplication;
  let editor: string; let admin: string;
  beforeAll(async () => { app = await createApp(); });
  beforeEach(async () => {
    await resetData(app);
    await app.get<Redis>(REDIS_CLIENT).flushdb();
    admin = await adminToken(app, ['SUPER_ADMIN']); editor = await adminToken(app, ['EDITOR']);
  });
  afterAll(async () => { await app.close(); });

  const api = (p: string) => `/api/v1${p}`;
  const redis = () => app.get<Redis>(REDIS_CLIENT);
  const progressSvc = () => app.get(ProgressService);
  const clearThrottle = async () => { const keys = await redis().keys('progress:rl:*'); if (keys.length) await redis().del(...keys); };
  let n = 0; const uniq = (p: string) => `${p} ${Date.now()}-${++n}`;

  /** A published series whose episodes each have a READY 300-second video. */
  async function series(episodes = 3, publish = true) {
    const g = (await http(app).post(api('/admin/genres')).set(bearer(admin)).send({ name: uniq('G') }).expect(201)).body;
    const s = (await http(app).post(api('/admin/series')).set(bearer(editor)).send({ title: uniq('Show'), synopsis: 'A story worth watching tonight.', posterKey: 'images/a.jpg', genreIds: [g.id] }).expect(201)).body as { id: string };
    const eps: { id: string; number: number }[] = [];
    for (let i = 1; i <= episodes; i++) {
      const e = (await http(app).post(api(`/admin/series/${s.id}/episodes`)).set(bearer(editor)).send({ title: `Ep ${i}` }).expect(201)).body;
      await dsOf(app).query("UPDATE episodes SET status = 'PUBLISHED', published_at = NOW(3) WHERE id = ?", [e.id]);
      await addReadyAsset(app, e.id);
      eps.push(e);
    }
    if (publish) await http(app).post(api(`/admin/series/${s.id}/publish`)).set(bearer(editor)).expect(200);
    return { series: s, eps };
  }
  const play = async (token: string, episodeId: string) => (await http(app).post(api(`/episodes/${episodeId}/playback-session`)).set(bearer(token)).expect(201)).body as { sessionId: string };
  const save = (token: string, episodeId: string, positionSeconds: unknown) => http(app).put(api(`/episodes/${episodeId}/progress`)).set(bearer(token)).send({ positionSeconds });
  /** Watch to a position, then make sure it is in MySQL (as the worker's flush would). */
  async function watch(token: string, episodeId: string, position: number) {
    await clearThrottle();
    await save(token, episodeId, position).expect(202);
    await progressSvc().flush();
  }

  describe('recording progress', () => {
    it('requires a LIVE playback session: no session, ended session, or no subscription means nothing is stored', async () => {
      const { eps } = await series();
      const sub = await subscribedViewer(app); const free = await viewerViaOtp(app);
      expect((await save(sub.token, eps[0].id, 30).expect(409)).body.code).toBe('PLAYBACK_REQUIRED');
      expect((await save(free.accessToken, eps[0].id, 30).expect(409)).body.code).toBe('PLAYBACK_REQUIRED');
      const s = await play(sub.token, eps[0].id);
      await save(sub.token, eps[0].id, 30).expect(202);
      await http(app).delete(api(`/playback-sessions/${s.sessionId}`)).set(bearer(sub.token)).expect(204);
      await clearThrottle();
      expect((await save(sub.token, eps[0].id, 40).expect(409)).body.code).toBe('PLAYBACK_REQUIRED'); // the session is over
      await http(app).put(api(`/episodes/${eps[0].id}/progress`)).send({ positionSeconds: 5 }).expect(401);
    });

    it('batches writes: the update waits in Redis, reads see it immediately, and the worker flush persists it', async () => {
      const { eps } = await series();
      const sub = await subscribedViewer(app);
      await play(sub.token, eps[0].id);
      const r = await save(sub.token, eps[0].id, 61).expect(202);
      expect(r.body).toEqual({ accepted: true, throttled: false });
      expect(await dsOf(app).getRepository(WatchProgress).count()).toBe(0); // not in MySQL yet: that is the point
      expect(await redis().hlen('progress:pending')).toBe(1);
      const got = (await http(app).get(api(`/episodes/${eps[0].id}/progress`)).set(bearer(sub.token)).expect(200)).body;
      expect(got).toMatchObject({ positionSeconds: 61, durationSeconds: 300, completed: false }); // read-your-writes
      expect(await dsOf(app).getRepository(WatchProgress).count()).toBe(1);
    });

    it('throttles to one accepted write per 5 seconds per episode, but a later one is accepted', async () => {
      const { eps } = await series();
      const sub = await subscribedViewer(app);
      await play(sub.token, eps[0].id);
      await save(sub.token, eps[0].id, 10).expect(202);
      const again = await save(sub.token, eps[0].id, 20).expect(202);
      expect(again.body).toEqual({ accepted: false, throttled: true });
      await progressSvc().flush();
      expect((await dsOf(app).getRepository(WatchProgress).findOneByOrFail({ episodeId: eps[0].id })).positionSeconds).toBe(10);
      await clearThrottle();
      expect((await save(sub.token, eps[0].id, 20).expect(202)).body.accepted).toBe(true);
    });

    it.each([[-1], [1.5], ['10'], [null], [86401], [99999], [undefined]])('rejects an invalid position %p', async (pos) => {
      const { eps } = await series();
      const sub = await subscribedViewer(app);
      await play(sub.token, eps[0].id);
      await save(sub.token, eps[0].id, pos).expect(400);
    });

    it('rejects a position past the end of the (server-known) episode and clamps a tiny overshoot', async () => {
      const { eps } = await series();
      const sub = await subscribedViewer(app);
      await play(sub.token, eps[0].id);
      expect((await save(sub.token, eps[0].id, 400).expect(400)).body.code).toBe('INVALID_POSITION');
      await save(sub.token, eps[0].id, 303).expect(202); // within the 5s tolerance
      await progressSvc().flush();
      expect(await dsOf(app).getRepository(WatchProgress).findOneByOrFail({ episodeId: eps[0].id })).toMatchObject({ positionSeconds: 300, completed: true });
    });

    it('the client cannot report completion or duration: those fields are rejected, and completion is computed from the real duration', async () => {
      const { eps } = await series();
      const sub = await subscribedViewer(app);
      await play(sub.token, eps[0].id);
      await http(app).put(api(`/episodes/${eps[0].id}/progress`)).set(bearer(sub.token)).send({ positionSeconds: 5, completed: true }).expect(400);
      await http(app).put(api(`/episodes/${eps[0].id}/progress`)).set(bearer(sub.token)).send({ positionSeconds: 5, durationSeconds: 5 }).expect(400);
      await watch(sub.token, eps[0].id, 200);
      expect((await dsOf(app).getRepository(WatchProgress).findOneByOrFail({ episodeId: eps[0].id })).completed).toBe(false);
      await watch(sub.token, eps[0].id, 295);
      expect((await dsOf(app).getRepository(WatchProgress).findOneByOrFail({ episodeId: eps[0].id })).completed).toBe(true);
    });

    it('computes completion as the last 8 seconds or 8%', () => {
      expect([isCompleted(291, 300), isCompleted(292, 300), isCompleted(276, 100), isCompleted(92, 100), isCompleted(91, 100), isCompleted(5, 0)]).toEqual([false, true, true, true, false, false]);
    });

    it('heartbeats carry the position too, and ending the session saves it immediately', async () => {
      const { eps } = await series();
      const sub = await subscribedViewer(app);
      const s = await play(sub.token, eps[0].id);
      await http(app).post(api(`/playback-sessions/${s.sessionId}/heartbeat`)).set(bearer(sub.token)).send({ positionSeconds: 77 }).expect(200);
      await http(app).delete(api(`/playback-sessions/${s.sessionId}`)).set(bearer(sub.token)).expect(204);
      expect(await dsOf(app).getRepository(WatchProgress).findOneByOrFail({ episodeId: eps[0].id })).toMatchObject({ positionSeconds: 77 }); // no flush job needed
    });

    it('a user only ever sees and affects their own progress', async () => {
      const { eps } = await series();
      const a = await subscribedViewer(app); const b = await subscribedViewer(app);
      await play(a.token, eps[0].id);
      await watch(a.token, eps[0].id, 120);
      expect((await http(app).get(api(`/episodes/${eps[0].id}/progress`)).set(bearer(b.token)).expect(200)).body.positionSeconds).toBe(0);
      expect((await http(app).get(api('/me/continue-watching')).set(bearer(b.token)).expect(200)).body.items).toEqual([]);
    });
  });

  describe('the batch flush', () => {
    const entry = (u: string, e: string, s: string, p: number, t: number, d = 300) => ({ u, e, s, p, d, t });

    it('writes many users in one pass, then is a no-op; the latest value per user+episode wins', async () => {
      const { series: s, eps } = await series();
      const users = [await subscribedViewer(app), await subscribedViewer(app), await subscribedViewer(app)];
      await Promise.all(users.map(async (u, i) => { await play(u.token, eps[0].id); await save(u.token, eps[0].id, 10 * (i + 1)).expect(202); }));
      expect(await redis().hlen('progress:pending')).toBe(3);
      expect(await progressSvc().flush()).toEqual({ written: 3 });
      expect(await dsOf(app).getRepository(WatchProgress).count()).toBe(3);
      expect(await progressSvc().flush()).toEqual({ written: 0 });
      expect(await redis().exists('progress:pending', 'progress:flushing')).toBe(0);
      void s;
    });

    it('finishes a batch left half-processed by a crashed flush before starting a new one', async () => {
      const { series: s, eps } = await series();
      const u = await subscribedViewer(app);
      await redis().hset('progress:flushing', `${u.id}:${eps[0].id}`, JSON.stringify(entry(u.id, eps[0].id, s.id, 150, Date.now())));
      expect(await progressSvc().flush()).toEqual({ written: 1 });
      expect((await dsOf(app).getRepository(WatchProgress).findOneByOrFail({ userId: u.id })).positionSeconds).toBe(150);
    });

    it('is idempotent and order-safe: older data never overwrites newer, and "completed" is sticky', async () => {
      const { series: s, eps } = await series();
      const u = await subscribedViewer(app);
      const t = Date.now();
      await progressSvc().persist([entry(u.id, eps[0].id, s.id, 290, t, 300)]);
      await progressSvc().persist([entry(u.id, eps[0].id, s.id, 30, t - 60_000)]); // a late, older update
      await progressSvc().persist([entry(u.id, eps[0].id, s.id, 290, t)]); // an exact replay
      const row = await dsOf(app).getRepository(WatchProgress).findOneByOrFail({ userId: u.id });
      expect(row.positionSeconds).toBe(290);
      await progressSvc().persist([entry(u.id, eps[0].id, s.id, 10, t + 60_000)]); // user scrubs back to re-watch
      const after = await dsOf(app).getRepository(WatchProgress).findOneByOrFail({ userId: u.id });
      expect(after.positionSeconds).toBe(10);
      expect(after.completed).toBe(false); // 290/300 is not past the 292s line, so never completed here
      await progressSvc().persist([entry(u.id, eps[0].id, s.id, 299, t + 120_000)]);
      await progressSvc().persist([entry(u.id, eps[0].id, s.id, 5, t + 180_000)]);
      expect((await dsOf(app).getRepository(WatchProgress).findOneByOrFail({ userId: u.id })).completed).toBe(true);
    });

    it('records an analytics event the first time an episode is completed, and not again', async () => {
      const { series: s, eps } = await series();
      const u = await subscribedViewer(app);
      await progressSvc().persist([entry(u.id, eps[0].id, s.id, 299, Date.now())]);
      await progressSvc().persist([entry(u.id, eps[0].id, s.id, 299, Date.now() + 1000)]);
      await new Promise((r) => setTimeout(r, 200));
      expect(await dsOf(app).getRepository(AnalyticsEvent).count({ where: { eventType: 'episode_completed', userId: u.id } })).toBe(1);
    });
  });

  describe('continue watching', () => {
    it('resumes an unfinished episode with its position and percentage', async () => {
      const { series: s, eps } = await series();
      const sub = await subscribedViewer(app);
      await play(sub.token, eps[0].id);
      await watch(sub.token, eps[0].id, 100);
      const r = (await http(app).get(api('/me/continue-watching')).set(bearer(sub.token)).expect(200)).body;
      expect(r.items).toHaveLength(1);
      expect(r.items[0]).toMatchObject({ kind: 'RESUME', positionSeconds: 100, durationSeconds: 300, progressPercent: 33, series: { id: s.id }, episode: { id: eps[0].id, number: 1 } });
    });

    it('offers the NEXT episode after one is finished, and drops the series once the user is all caught up', async () => {
      const { eps } = await series(3);
      const sub = await subscribedViewer(app);
      for (const e of eps.slice(0, 2)) await play(sub.token, e.id);
      await watch(sub.token, eps[0].id, 299);
      let r = (await http(app).get(api('/me/continue-watching')).set(bearer(sub.token)).expect(200)).body;
      expect(r.items[0]).toMatchObject({ kind: 'NEXT', positionSeconds: 0, progressPercent: 0, episode: { number: 2 }, episodesCompleted: 1 });
      await watch(sub.token, eps[1].id, 120); // started episode 2
      r = (await http(app).get(api('/me/continue-watching')).set(bearer(sub.token)).expect(200)).body;
      expect(r.items[0]).toMatchObject({ kind: 'RESUME', episode: { number: 2 }, positionSeconds: 120 });
      await play(sub.token, eps[2].id);
      await watch(sub.token, eps[1].id, 299); await watch(sub.token, eps[2].id, 299);
      r = (await http(app).get(api('/me/continue-watching')).set(bearer(sub.token)).expect(200)).body;
      expect(r.items).toEqual([]); // finished everything
    });

    it('orders by most recent, paginates with a stable cursor, and rejects a bad cursor', async () => {
      const sub = await subscribedViewer(app);
      const made = [];
      for (let i = 0; i < 4; i++) {
        const s = await series(2); made.push(s);
        await play(sub.token, s.eps[0].id); await watch(sub.token, s.eps[0].id, 30);
        await new Promise((r) => setTimeout(r, 15));
      }
      const first = (await http(app).get(api('/me/continue-watching?limit=2')).set(bearer(sub.token)).expect(200)).body;
      expect(first.items.map((i: { series: { id: string } }) => i.series.id)).toEqual([made[3].series.id, made[2].series.id]);
      const second = (await http(app).get(api(`/me/continue-watching?limit=2&cursor=${first.nextCursor}`)).set(bearer(sub.token)).expect(200)).body;
      expect(second.items.map((i: { series: { id: string } }) => i.series.id)).toEqual([made[1].series.id, made[0].series.id]);
      expect(second.nextCursor).toBeNull();
      await http(app).get(api('/me/continue-watching?cursor=garbage')).set(bearer(sub.token)).expect(400);
    });

    it('never shows content that is no longer available', async () => {
      const { series: s, eps } = await series(2);
      const sub = await subscribedViewer(app);
      await play(sub.token, eps[0].id); await watch(sub.token, eps[0].id, 299);
      await dsOf(app).query("UPDATE episodes SET status = 'DRAFT', published_at = NULL WHERE id = ?", [eps[1].id]); // the next episode is withdrawn
      expect((await http(app).get(api('/me/continue-watching')).set(bearer(sub.token)).expect(200)).body.items).toEqual([]);
      await dsOf(app).query("UPDATE episodes SET status = 'PUBLISHED', published_at = NOW(3) WHERE id = ?", [eps[1].id]);
      expect((await http(app).get(api('/me/continue-watching')).set(bearer(sub.token)).expect(200)).body.items).toHaveLength(1);
      await http(app).post(api(`/admin/series/${s.id}/unpublish`)).set(bearer(editor)).expect(200);
      expect((await http(app).get(api('/me/continue-watching')).set(bearer(sub.token)).expect(200)).body.items).toEqual([]);
    });
  });

  describe('history and privacy', () => {
    it('lists watched episodes newest first, and lets the user remove a series or everything', async () => {
      const a = await series(2); const b = await series(2);
      const sub = await subscribedViewer(app);
      await play(sub.token, a.eps[0].id); await watch(sub.token, a.eps[0].id, 299);
      await new Promise((r) => setTimeout(r, 15));
      await play(sub.token, b.eps[0].id); await watch(sub.token, b.eps[0].id, 50);
      const h = (await http(app).get(api('/me/history')).set(bearer(sub.token)).expect(200)).body;
      expect(h.items.map((i: { episode: { id: string }; completed: boolean }) => [i.episode.id, i.completed])).toEqual([[b.eps[0].id, false], [a.eps[0].id, true]]);
      await http(app).delete(api(`/me/history/${a.series.id}`)).set(bearer(sub.token)).expect(204);
      expect((await http(app).get(api('/me/history')).set(bearer(sub.token)).expect(200)).body.items).toHaveLength(1);
      expect(await dsOf(app).getRepository(WatchHistory).count({ where: { seriesId: a.series.id } })).toBe(0);
      await http(app).delete(api('/me/history')).set(bearer(sub.token)).expect(204);
      expect((await http(app).get(api('/me/continue-watching')).set(bearer(sub.token)).expect(200)).body.items).toEqual([]);
      await http(app).delete(api('/me/history/abc')).set(bearer(sub.token)).expect(404);
    });

    it('requires sign-in for every endpoint, and the data is never cacheable', async () => {
      for (const p of ['/me/continue-watching', '/me/history', '/me/watchlist', '/episodes/1/progress']) await http(app).get(api(p)).expect(401);
      const u = await viewerViaOtp(app);
      const r = await http(app).get(api('/me/continue-watching')).set(bearer(u.accessToken)).expect(200);
      expect(r.headers['cache-control']).toBe('private, no-store');
    });
  });

  describe('watchlist', () => {
    it('adds idempotently, lists with the date added, and removes idempotently', async () => {
      const a = await series(1); const b = await series(1);
      const u = await viewerViaOtp(app);
      expect((await http(app).get(api('/me/watchlist')).set(bearer(u.accessToken)).expect(200)).body.items).toEqual([]);
      for (let i = 0; i < 3; i++) expect((await http(app).put(api(`/me/watchlist/${a.series.id}`)).set(bearer(u.accessToken)).expect(200)).body).toEqual({ inWatchlist: true });
      await http(app).put(api(`/me/watchlist/${b.series.id}`)).set(bearer(u.accessToken)).expect(200);
      const list = (await http(app).get(api('/me/watchlist')).set(bearer(u.accessToken)).expect(200)).body;
      expect(list.items.map((i: { id: string }) => i.id)).toEqual([b.series.id, a.series.id]); // newest first
      expect(list.items[0]).toMatchObject({ title: expect.any(String), addedAt: expect.any(String) });
      expect((await http(app).get(api(`/me/watchlist/${a.series.id}`)).set(bearer(u.accessToken)).expect(200)).body).toEqual({ inWatchlist: true });
      await http(app).delete(api(`/me/watchlist/${a.series.id}`)).set(bearer(u.accessToken)).expect(204);
      await http(app).delete(api(`/me/watchlist/${a.series.id}`)).set(bearer(u.accessToken)).expect(204);
      expect((await http(app).get(api(`/me/watchlist/${a.series.id}`)).set(bearer(u.accessToken)).expect(200)).body).toEqual({ inWatchlist: false });
    });

    it('parallel adds of the same series leave exactly one entry', async () => {
      const a = await series(1);
      const u = await viewerViaOtp(app);
      const rs = await Promise.all(Array.from({ length: 6 }, () => http(app).put(api(`/me/watchlist/${a.series.id}`)).set(bearer(u.accessToken))));
      expect(rs.every((r) => r.status === 200)).toBe(true);
      expect((await dsOf(app).query('SELECT COUNT(*) AS n FROM watchlist_items'))[0].n).toBe('1');
      expect((await dsOf(app).query('SELECT COUNT(*) AS n FROM watchlists'))[0].n).toBe('1');
    });

    it('only available series can be added; ones that disappear drop out of the list; lists are private', async () => {
      const live = await series(1); const draft = await series(1, false);
      const u = await viewerViaOtp(app); const other = await viewerViaOtp(app);
      await http(app).put(api(`/me/watchlist/${draft.series.id}`)).set(bearer(u.accessToken)).expect(404);
      await http(app).put(api('/me/watchlist/987654')).set(bearer(u.accessToken)).expect(404);
      await http(app).put(api('/me/watchlist/abc')).set(bearer(u.accessToken)).expect(404);
      await http(app).put(api(`/me/watchlist/${live.series.id}`)).set(bearer(u.accessToken)).expect(200);
      expect((await http(app).get(api('/me/watchlist')).set(bearer(other.accessToken)).expect(200)).body.items).toEqual([]);
      await http(app).post(api(`/admin/series/${live.series.id}/unpublish`)).set(bearer(editor)).expect(200);
      expect((await http(app).get(api('/me/watchlist')).set(bearer(u.accessToken)).expect(200)).body.items).toEqual([]);
    });

    it('paginates and enforces the size cap', async () => {
      const first = await series(1);
      const u = await viewerViaOtp(app);
      const wl = await dsOf(app).query('INSERT INTO watchlists (user_id) VALUES (?)', [u.user.id]);
      await dsOf(app).query("INSERT INTO series (slug, title, synopsis, language, maturity_rating, status, sort_weight, is_featured) WITH RECURSIVE n AS (SELECT 1 AS i UNION ALL SELECT i + 1 FROM n WHERE i < 500) SELECT CONCAT('bulk-', i), CONCAT('Bulk ', i), 'bulk synopsis text', 'hi', '16+', 'DRAFT', 0, 0 FROM n");
      await dsOf(app).query('INSERT INTO watchlist_items (watchlist_id, series_id) SELECT ?, id FROM series WHERE slug LIKE ? LIMIT 500', [wl.insertId, 'bulk-%']);
      const full = await http(app).put(api(`/me/watchlist/${first.series.id}`)).set(bearer(u.accessToken)).expect(409);
      expect(full.body.code).toBe('WATCHLIST_FULL');
      await http(app).delete(api(`/me/watchlist/${first.series.id}`)).set(bearer(u.accessToken)).expect(204);

      const v = await viewerViaOtp(app);
      const made = []; for (let i = 0; i < 5; i++) { const s = await series(1); made.push(s.series.id); await http(app).put(api(`/me/watchlist/${s.series.id}`)).set(bearer(v.accessToken)).expect(200); }
      const seen: string[] = []; let cursor: string | null = null;
      do { const r: { body: { items: { id: string }[]; nextCursor: string | null } } = await http(app).get(api(`/me/watchlist?limit=2${cursor ? `&cursor=${cursor}` : ''}`)).set(bearer(v.accessToken)).expect(200); seen.push(...r.body.items.map((i) => i.id)); cursor = r.body.nextCursor; } while (cursor);
      expect(seen).toEqual([...made].reverse());
    });
  });

  it('records a playback_started analytics event for server-observed playback', async () => {
    const { eps } = await series(1);
    const sub = await subscribedViewer(app);
    await play(sub.token, eps[0].id);
    await new Promise((r) => setTimeout(r, 200));
    expect(await dsOf(app).getRepository(AnalyticsEvent).count({ where: { eventType: 'playback_started', userId: sub.id, entityId: eps[0].id } })).toBe(1);
  });
});
