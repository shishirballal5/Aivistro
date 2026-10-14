import { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from './helpers';
import { adminToken, bearer, dsOf, http, resetData } from './factories';

describe('catalog: clearing image keys, bannerUrl, atomic episode reorder (real MySQL + Redis)', () => {
  let app: NestExpressApplication; let admin: string; let editor: string; let support: string;
  beforeAll(async () => {
    app = await createApp({ MEDIA_PUBLIC_BASE_URL: 'https://cdn.aivistro.test' });
    await resetData(app);
    admin = await adminToken(app, ['SUPER_ADMIN']); editor = await adminToken(app, ['EDITOR']); support = await adminToken(app, ['SUPPORT']);
  });
  afterAll(async () => { await app.close(); });

  const api = (p: string) => `/api/v1${p}`;
  const post = (p: string, body: object = {}, t = editor) => http(app).post(api(p)).set(bearer(t)).send(body);
  const patch = (p: string, body: object, t = editor) => http(app).patch(api(p)).set(bearer(t)).send(body);
  let n = 0; const uniq = (p: string) => `${p} ${Date.now()}-${++n}`;
  async function series(over: Record<string, unknown> = {}) {
    const g = (await post('/admin/genres', { name: uniq('G') }, admin).expect(201)).body;
    return (await post('/admin/series', { title: uniq('S'), synopsis: 'A story that is long enough to publish.', posterKey: 'images/2026/10/aaaaaaaaaaaaaaaaaaaaaaaa.jpg', genreIds: [g.id], ...over }).expect(201)).body as Record<string, any>;
  }
  async function episodes(seriesId: string, count: number) {
    const out: { id: string; number: number }[] = [];
    for (let i = 0; i < count; i++) out.push((await post(`/admin/series/${seriesId}/episodes`, { title: `Ep ${i + 1}` }).expect(201)).body);
    return out;
  }
  const order = async (seriesId: string) => ((await http(app).get(api(`/admin/series/${seriesId}/episodes`)).set(bearer(editor)).expect(200)).body as { id: string; number: number }[]).map((e) => e.id);

  describe('clearing keys with explicit null', () => {
    const KEY = 'images/2026/10/bbbbbbbbbbbbbbbbbbbbbbbb.png';
    it('series poster and banner: set, keep when omitted, clear with null; urls follow', async () => {
      const s = await series({ bannerKey: KEY });
      expect(s.posterUrl).toBe('https://cdn.aivistro.test/images/2026/10/aaaaaaaaaaaaaaaaaaaaaaaa.jpg');
      expect(s.bannerUrl).toBe(`https://cdn.aivistro.test/${KEY}`);
      let r = (await patch(`/admin/series/${s.id}`, { title: 'Renamed' }).expect(200)).body;
      expect(r.posterKey).toBeTruthy(); expect(r.bannerKey).toBe(KEY);
      r = (await patch(`/admin/series/${s.id}`, { bannerKey: null }).expect(200)).body;
      expect(r.bannerKey).toBeNull(); expect(r.bannerUrl).toBeNull(); expect(r.posterKey).toBeTruthy();
      r = (await patch(`/admin/series/${s.id}`, { posterKey: null }).expect(200)).body;
      expect(r.posterKey).toBeNull(); expect(r.posterUrl).toBeNull();
      expect((await http(app).get(api(`/admin/series/${s.id}`)).set(bearer(editor)).expect(200)).body.bannerUrl).toBeNull();
    });
    it('series without a banner reports bannerUrl null; the list view has bannerUrl too', async () => {
      const s = await series();
      expect(s.bannerUrl).toBeNull();
      const list = (await http(app).get(api('/admin/series')).set(bearer(editor)).expect(200)).body.items as any[];
      expect(list.find((x) => x.id === s.id)).toHaveProperty('bannerUrl', null);
    });
    it('create accepts null keys too', async () => { const s = await series({ posterKey: null, bannerKey: null }); expect(s.posterKey).toBeNull(); });
    it('validation is otherwise unchanged: bad keys, wrong types and empty strings are still 400', async () => {
      const s = await series();
      for (const bad of ['../x.png', 'private/source/1/a.mp4', 'https://evil/x.png', '', 5, false, {}]) {
        await patch(`/admin/series/${s.id}`, { posterKey: bad }).expect(400);
        await patch(`/admin/series/${s.id}`, { bannerKey: bad }).expect(400);
      }
    });
    it('episode thumbnail', async () => {
      const s = await series(); const [e] = await episodes(s.id, 1);
      let r = (await patch(`/admin/episodes/${e.id}`, { thumbnailKey: KEY }).expect(200)).body;
      expect(r.thumbnailUrl).toBe(`https://cdn.aivistro.test/${KEY}`);
      r = (await patch(`/admin/episodes/${e.id}`, { title: 'T2' }).expect(200)).body; expect(r.thumbnailKey).toBe(KEY);
      r = (await patch(`/admin/episodes/${e.id}`, { thumbnailKey: null }).expect(200)).body; expect(r.thumbnailKey).toBeNull(); expect(r.thumbnailUrl).toBeNull();
      await patch(`/admin/episodes/${e.id}`, { thumbnailKey: 'nope' }).expect(400);
    });
    it('cast photo', async () => {
      const c = (await post('/admin/cast', { name: 'Asha', photoKey: KEY }).expect(201)).body;
      expect(c.photoKey).toBe(KEY);
      expect((await patch(`/admin/cast/${c.id}`, { name: 'Asha K' }).expect(200)).body.photoKey).toBe(KEY);
      expect((await patch(`/admin/cast/${c.id}`, { name: 'Asha K', photoKey: null }).expect(200)).body.photoKey).toBeNull();
      await patch(`/admin/cast/${c.id}`, { name: 'Asha K', photoKey: '../a' }).expect(400);
    });
    it('banner imageKey stays required (the column is NOT NULL): null is a 400, not a 500', async () => {
      await post('/admin/banners', { title: 'B', imageKey: null }, admin).expect(400);
      const b = (await post('/admin/banners', { title: 'B', imageKey: KEY }, admin).expect(201)).body;
      await http(app).put(api(`/admin/banners/${b.id}`)).set(bearer(admin)).send({ title: 'B', imageKey: null }).expect(400);
    });
  });

  describe('POST /admin/series/:id/episodes/reorder', () => {
    const reorder = (id: string, episodeIds: string[], t = editor) => post(`/admin/series/${id}/episodes/reorder`, { episodeIds }, t);

    it('renumbers 1..n in the given order and returns the new listing', async () => {
      const s = await series(); const eps = await episodes(s.id, 4);
      const want = [eps[3].id, eps[0].id, eps[2].id, eps[1].id];
      const res = await reorder(s.id, want).expect(200);
      expect((res.body as { id: string; number: number }[]).map((e) => [e.id, e.number])).toEqual(want.map((id, i) => [id, i + 1]));
      expect(await order(s.id)).toEqual(want);
      const [{ c }] = await dsOf(app).query('SELECT COUNT(*) c FROM audit_logs WHERE action = ?', ['episode.reorder']);
      expect(Number(c)).toBeGreaterThan(0);
    });
    it('closes gaps and works with non-contiguous numbers', async () => {
      const s = await series(); const eps = await episodes(s.id, 3);
      await dsOf(app).query('UPDATE episodes SET number = number * 10 WHERE series_id = ?', [s.id]);
      await reorder(s.id, [eps[2].id, eps[1].id, eps[0].id]).expect(200);
      expect((await dsOf(app).query('SELECT id, number FROM episodes WHERE series_id = ? ORDER BY number', [s.id])).map((r: any) => [r.id, r.number])).toEqual([[eps[2].id, 1], [eps[1].id, 2], [eps[0].id, 3]]);
    });
    it('same order is a no-op success; a single episode and an empty series work', async () => {
      const s = await series(); const eps = await episodes(s.id, 2);
      await reorder(s.id, eps.map((e) => e.id)).expect(200);
      const one = await series(); const [e1] = await episodes(one.id, 1);
      await reorder(one.id, [e1.id]).expect(200);
      const none = await series();
      expect((await reorder(none.id, []).expect(200)).body).toEqual([]);
    });
    it('400 on missing, extra, duplicate, foreign and malformed ids, and changes nothing', async () => {
      const s = await series(); const eps = await episodes(s.id, 3);
      const other = await series(); const [foreign] = await episodes(other.id, 1);
      const ids = eps.map((e) => e.id);
      for (const bad of [ids.slice(0, 2), [...ids, '999999999'], [ids[0], ids[0], ids[1], ids[2]], [ids[0], ids[0], ids[1]], [...ids.slice(0, 2), foreign.id], []]) {
        const res = await reorder(s.id, bad).expect(400); expect(res.body.code).toBe('INVALID_EPISODE_LIST');
      }
      await reorder(s.id, ['abc', ...ids]).expect(400);
      await post(`/admin/series/${s.id}/episodes/reorder`, {}).expect(400);
      await post(`/admin/series/${s.id}/episodes/reorder`, { episodeIds: 'x' }).expect(400);
      expect(await order(s.id)).toEqual(ids);
      expect(await order(other.id)).toEqual([foreign.id]);
    });
    it('404 for an unknown series; never touches another series', async () => {
      await reorder('99999999', ['1']).expect(404);
      const a = await series(); const b = await series();
      const ea = await episodes(a.id, 3); const eb = await episodes(b.id, 3);
      await reorder(a.id, [ea[2].id, ea[1].id, ea[0].id]).expect(200);
      expect(await order(b.id)).toEqual(eb.map((e) => e.id));
      expect((await dsOf(app).query('SELECT number FROM episodes WHERE series_id = ? ORDER BY id', [b.id])).map((r: any) => r.number)).toEqual([1, 2, 3]);
    });
    it('published series and episodes: status and published_at are untouched, only numbers change', async () => {
      const s = await series(); const eps = await episodes(s.id, 3);
      await dsOf(app).query("UPDATE episodes SET status = 'PUBLISHED', published_at = '2026-01-01 00:00:00.000' WHERE id = ?", [eps[0].id]);
      await dsOf(app).query("UPDATE episodes SET status = 'SCHEDULED', publish_at = '2030-01-01 00:00:00.000' WHERE id = ?", [eps[1].id]);
      await dsOf(app).query("UPDATE series SET status = 'PUBLISHED', published_at = '2026-01-01 00:00:00.000' WHERE id = ?", [s.id]);
      const before = await dsOf(app).query('SELECT id, status, publish_at, published_at, current_asset_id FROM episodes WHERE series_id = ? ORDER BY id', [s.id]);
      await reorder(s.id, [eps[2].id, eps[0].id, eps[1].id]).expect(200);
      const after = await dsOf(app).query('SELECT id, status, publish_at, published_at, current_asset_id FROM episodes WHERE series_id = ? ORDER BY id', [s.id]);
      expect(after).toEqual(before);
      expect((await dsOf(app).query('SELECT status FROM series WHERE id = ?', [s.id]))[0].status).toBe('PUBLISHED');
      expect(await order(s.id)).toEqual([eps[2].id, eps[0].id, eps[1].id]);
    });
    it('two concurrent reorders serialise: both succeed and the result is exactly one of the two orders, numbers 1..n', async () => {
      const s = await series(); const eps = await episodes(s.id, 8); const ids = eps.map((e) => e.id);
      const a = [...ids].reverse(); const b = [ids[3], ids[1], ids[7], ids[0], ids[5], ids[2], ids[6], ids[4]];
      const res = await Promise.all([reorder(s.id, a), reorder(s.id, b), reorder(s.id, a), reorder(s.id, b)]);
      expect(res.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      const final = await order(s.id);
      expect([a, b]).toContainEqual(final);
      expect((await dsOf(app).query('SELECT number FROM episodes WHERE series_id = ? ORDER BY number', [s.id])).map((r: any) => r.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });
    it('a reorder racing an episode create never leaves a duplicate number', async () => {
      const s = await series(); const eps = await episodes(s.id, 3);
      const [r] = await Promise.all([reorder(s.id, [eps[2].id, eps[1].id, eps[0].id]), post(`/admin/series/${s.id}/episodes`, { title: 'Late' })]);
      expect([200, 400]).toContain(r.status); // 400 if the new episode landed first and the list is now incomplete
      const nums = (await dsOf(app).query('SELECT number FROM episodes WHERE series_id = ?', [s.id])).map((x: any) => x.number);
      expect(new Set(nums).size).toBe(nums.length);
    });
    it('permissions: SUPPORT 403, anonymous 401', async () => {
      const s = await series(); const eps = await episodes(s.id, 2);
      await reorder(s.id, eps.map((e) => e.id), support).expect(403);
      await http(app).post(api(`/admin/series/${s.id}/episodes/reorder`)).send({ episodeIds: [] }).expect(401);
    });
  });
});
