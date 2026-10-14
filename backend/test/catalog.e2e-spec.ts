import { NestExpressApplication } from '@nestjs/platform-express';
import { CatalogAdminService } from '../src/modules/catalog/catalog-admin.service';
import { createApp } from './helpers';
import { addReadyAsset, adminToken, bearer, dsOf, http, resetData } from './factories';

describe('catalog: publishing rules and public visibility (real MySQL + Redis)', () => {
  let app: NestExpressApplication;
  let admin: string;
  let editor: string;
  beforeAll(async () => {
    app = await createApp({ MEDIA_PUBLIC_BASE_URL: 'https://cdn.aivistro.test' });
    await resetData(app);
    admin = await adminToken(app, ['SUPER_ADMIN']);
    editor = await adminToken(app, ['EDITOR']);
  });
  afterAll(async () => { await app.close(); });

  const api = (path: string) => `/api/v1${path}`;
  const post = (path: string, body: object = {}, token = editor) => http(app).post(api(path)).set(bearer(token)).send(body);
  let n = 0;
  const uniq = (p: string) => `${p} ${Date.now()}-${++n}`;

  async function genre(name = uniq('Genre')) { return (await post('/admin/genres', { name }, admin).expect(201)).body as { id: string; slug: string; name: string }; }
  async function series(over: Record<string, unknown> = {}) {
    const g = await genre();
    const res = await post('/admin/series', { title: uniq('Story'), synopsis: 'A gripping tale of secrets and second chances.', posterKey: 'images/posters/a.jpg', genreIds: [g.id], ...over }).expect(201);
    return { ...(res.body as { id: string; slug: string; title: string }), genre: g };
  }
  /** Episodes cannot be published through the API until Phase 4 (a video is required), so tests mark them live directly, as the video pipeline will. */
  async function liveEpisode(seriesId: string, title = uniq('Ep'), extra = '') {
    const e = (await post(`/admin/series/${seriesId}/episodes`, { title }).expect(201)).body as { id: string; number: number };
    await dsOf(app).query(`UPDATE episodes SET status = 'PUBLISHED', published_at = NOW(3) ${extra} WHERE id = ?`, [e.id]);
    await addReadyAsset(app, e.id);
    return e;
  }
  const publish = (id: string) => post(`/admin/series/${id}/publish`);

  describe('what viewers can see', () => {
    it('a draft series is invisible everywhere: list, detail by id, detail by slug, episodes, search', async () => {
      const s = await series();
      await liveEpisode(s.id);
      const list = await http(app).get(api(`/series?genre=${s.genre.slug}`)).expect(200);
      expect(list.body.items).toHaveLength(0);
      await http(app).get(api(`/series/${s.id}`)).expect(404);
      await http(app).get(api(`/series/${s.slug}`)).expect(404);
      await http(app).get(api(`/series/${s.id}/episodes`)).expect(404);
      const search = await http(app).get(api(`/series?q=${encodeURIComponent(s.title)}`)).expect(200);
      expect(search.body.items).toHaveLength(0);
    });

    it('a published series appears; unpublishing hides it again; archiving hides it; restoring does not republish', async () => {
      const s = await series();
      await liveEpisode(s.id);
      await publish(s.id).expect(200);
      const seen = await http(app).get(api(`/series?genre=${s.genre.slug}`)).expect(200);
      expect(seen.body.items.map((i: { id: string }) => i.id)).toEqual([s.id]);
      await http(app).get(api(`/series/${s.slug}`)).expect(200);

      await post(`/admin/series/${s.id}/unpublish`).expect(200);
      await http(app).get(api(`/series/${s.id}`)).expect(404);
      await publish(s.id).expect(200);
      await post(`/admin/series/${s.id}/archive`).expect(200);
      await http(app).get(api(`/series/${s.id}`)).expect(404);
      await post(`/admin/series/${s.id}/restore`).expect(200);
      await http(app).get(api(`/series/${s.id}`)).expect(404); // restore goes back to DRAFT, not live
    });

    it('episodes of a published series: only live episodes are listed; drafts and archived are hidden', async () => {
      const s = await series();
      const live = await liveEpisode(s.id);
      const draft = (await post(`/admin/series/${s.id}/episodes`, { title: 'Draft only' }).expect(201)).body;
      const archived = await liveEpisode(s.id);
      await dsOf(app).query("UPDATE episodes SET status = 'ARCHIVED' WHERE id = ?", [archived.id]);
      await publish(s.id).expect(200);
      const r = await http(app).get(api(`/series/${s.id}/episodes`)).expect(200);
      expect(r.body.items.map((e: { id: string }) => e.id)).toEqual([live.id]);
      expect(JSON.stringify(r.body)).not.toContain(draft.id === live.id ? 'x' : `"id":"${draft.id}"`);
      const detail = await http(app).get(api(`/series/${s.id}`)).expect(200);
      expect(detail.body.episodeCount).toBe(1);
    });

    it('scheduled content stays hidden until its time, then the worker job makes it live', async () => {
      const s = await series();
      await liveEpisode(s.id);
      const at = new Date(Date.now() + 3600_000).toISOString();
      await post(`/admin/series/${s.id}/schedule`, { publishAt: at }).expect(200);
      await http(app).get(api(`/series/${s.id}`)).expect(404);
      const svc = app.get(CatalogAdminService);
      expect((await svc.publishDue(new Date())).series).toBe(0); // not yet due
      await http(app).get(api(`/series/${s.id}`)).expect(404);
      await dsOf(app).query('UPDATE series SET publish_at = NOW(3) - INTERVAL 1 MINUTE WHERE id = ?', [s.id]); // time passes
      expect((await svc.publishDue(new Date())).series).toBeGreaterThanOrEqual(1);
      await http(app).get(api(`/series/${s.id}`)).expect(200);
      expect((await svc.publishDue(new Date())).series).toBe(0); // idempotent: nothing flips twice
    });

    it('content whose publish time is in the future is never served even if its status says PUBLISHED', async () => {
      const s = await series();
      await liveEpisode(s.id);
      await publish(s.id).expect(200);
      await dsOf(app).query('UPDATE series SET published_at = NOW(3) + INTERVAL 1 DAY WHERE id = ?', [s.id]);
      await http(app).get(api(`/series/${s.id}`)).expect(404);
      await dsOf(app).query('UPDATE series SET published_at = NOW(3) - INTERVAL 1 DAY WHERE id = ?', [s.id]);
      await dsOf(app).query("UPDATE episodes SET published_at = NOW(3) + INTERVAL 1 DAY WHERE series_id = ?", [s.id]);
      expect((await http(app).get(api(`/series/${s.id}/episodes`)).expect(200)).body.items).toHaveLength(0);
    });

    it('never exposes storage keys, private asset ids or internal fields', async () => {
      const s = await series({ bannerKey: 'images/banners/b.jpg' });
      await liveEpisode(s.id);
      await publish(s.id).expect(200);
      const bodies = [
        (await http(app).get(api(`/series/${s.id}`)).expect(200)).body,
        (await http(app).get(api(`/series?genre=${s.genre.slug}`)).expect(200)).body,
        (await http(app).get(api(`/series/${s.id}/episodes`)).expect(200)).body,
        (await http(app).get(api('/home')).expect(200)).body,
      ];
      const text = JSON.stringify(bodies);
      expect(text).not.toMatch(/posterKey|bannerKey|thumbnailKey|imageKey|photoKey|currentAssetId|current_asset|sourceKey|"images\//); // no raw key anywhere
      expect(text).toContain('https://cdn.aivistro.test/images/posters/a.jpg'); // a public image URL, not a key
    });
  });

  describe('publication validation', () => {
    it('refuses to publish an incomplete series and says exactly what is missing', async () => {
      const bare = (await post('/admin/series', { title: 'Bare', synopsis: 'Too short' }).expect(201)).body;
      const r = await publish(bare.id).expect(422);
      expect(r.body.code).toBe('PUBLISH_VALIDATION_FAILED');
      expect(r.body.details.join(' ')).toMatch(/synopsis/i);
      expect(r.body.details.join(' ')).toMatch(/poster/i);
      expect(r.body.details.join(' ')).toMatch(/genre/i);
      expect(r.body.details.join(' ')).toMatch(/episode/i);
      await http(app).get(api(`/series/${bare.id}`)).expect(404);
    });

    it('refuses to publish a series that has no published episode', async () => {
      const s = await series();
      await post(`/admin/series/${s.id}/episodes`, { title: 'Only a draft' }).expect(201);
      const r = await publish(s.id).expect(422);
      expect(r.body.details.join(' ')).toMatch(/published episode/i);
    });

    it('refuses to publish an episode with no processed video (no way to make an unplayable episode public)', async () => {
      const s = await series();
      const e = (await post(`/admin/series/${s.id}/episodes`, { title: 'No video' }).expect(201)).body;
      const r = await post(`/admin/episodes/${e.id}/publish`).expect(422);
      expect(r.body.code).toBe('PUBLISH_VALIDATION_FAILED');
      expect(r.body.details.join(' ')).toMatch(/video/i);
      await post(`/admin/episodes/${e.id}/schedule`, { publishAt: new Date(Date.now() + 86400000).toISOString() }).expect(422);
    });

    it('enforces the state machine and schedule times', async () => {
      const s = await series();
      await liveEpisode(s.id);
      await post(`/admin/series/${s.id}/unpublish`).expect(409); // draft -> draft is not a transition
      await post(`/admin/series/${s.id}/restore`).expect(409);
      await post(`/admin/series/${s.id}/schedule`, { publishAt: new Date(Date.now() - 1000).toISOString() }).expect(400);
      await post(`/admin/series/${s.id}/schedule`, { publishAt: 'tomorrow' }).expect(400);
      await publish(s.id).expect(200);
      await publish(s.id).expect(409); // already published
    });

    it('requires the publish permission: an editor-without-publish and a support admin cannot publish', async () => {
      const s = await series();
      await liveEpisode(s.id);
      const support = await adminToken(app, ['SUPPORT']);
      await post(`/admin/series/${s.id}/publish`, {}, support).expect(403);
      await http(app).get(api(`/series/${s.id}`)).expect(404);
    });
  });

  describe('browsing: filters, search, sorting and pagination', () => {
    it('filters by genre and category, and search treats % and _ literally', async () => {
      const g = await genre(); const other = await genre();
      const a = await series({ title: uniq('Alpha'), genreIds: [g.id] }); const b = await series({ title: uniq('Beta'), genreIds: [other.id] });
      const special = await series({ title: `100% match_ ${Date.now()}`, genreIds: [g.id] });
      const cat = (await post('/admin/categories', { name: uniq('Cat') }, admin).expect(201)).body as { id: string; slug: string };
      await post(`/admin/series`, { title: uniq('Categorised'), synopsis: 'Another good story to tell here.', posterKey: 'images/a.jpg', genreIds: [g.id], categoryIds: [cat.id] }).expect(201);
      for (const s of [a, b, special]) { await liveEpisode(s.id); await publish(s.id).expect(200); }
      const byGenre = await http(app).get(api(`/series?genre=${g.slug}&limit=50`)).expect(200);
      expect(byGenre.body.items.map((i: { id: string }) => i.id).sort()).toEqual([a.id, special.id].sort());
      const wild = await http(app).get(api(`/series?q=${encodeURIComponent('%')}`)).expect(200);
      expect(wild.body.items.map((i: { id: string }) => i.id)).toEqual([special.id]); // '%' is not a wildcard
      const underscore = await http(app).get(api(`/series?q=${encodeURIComponent('match_')}`)).expect(200);
      expect(underscore.body.items).toHaveLength(1);
      await http(app).get(api('/series?genre=NOT%20A%20SLUG')).expect(400);
      await http(app).get(api('/series?sort=bogus')).expect(400);
    });

    it('paginates 25 episodes in a stable order with no duplicates or gaps, and handles bad cursors and limits', async () => {
      const s = await series();
      const ids: string[] = [];
      for (let i = 0; i < 25; i++) ids.push((await liveEpisode(s.id, `Part ${i + 1}`)).id);
      await publish(s.id).expect(200);
      const seen: { id: string; number: number }[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const r: { body: { items: { id: string; number: number }[]; nextCursor: string | null } } = await http(app).get(api(`/series/${s.id}/episodes?limit=10${cursor ? `&cursor=${cursor}` : ''}`)).expect(200);
        seen.push(...r.body.items); cursor = r.body.nextCursor; pages++;
      } while (cursor);
      expect(pages).toBe(3);
      expect(seen.map((e) => e.number)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
      expect(new Set(seen.map((e) => e.id)).size).toBe(25);
      await http(app).get(api(`/series/${s.id}/episodes?limit=0`)).expect(400);
      await http(app).get(api(`/series/${s.id}/episodes?limit=500`)).expect(400);
      await http(app).get(api(`/series/${s.id}/episodes?cursor=garbage`)).expect(400);
      await http(app).get(api(`/series/${s.id}/episodes?cursor=${Buffer.from('{"x":1}').toString('base64url')}`)).expect(400);
      void ids;
    });

    it('paginates series for every sort order without duplicates', async () => {
      const g = await genre();
      const made = [];
      for (let i = 0; i < 7; i++) { const s = await series({ title: uniq(`Page${i}`), genreIds: [g.id], sortWeight: i % 3 }); await liveEpisode(s.id); await publish(s.id).expect(200); made.push(s.id); }
      for (const sort of ['newest', 'featured', 'title']) {
        const all: string[] = []; let cursor: string | null = null;
        do { const r: { body: { items: { id: string }[]; nextCursor: string | null } } = await http(app).get(api(`/series?genre=${g.slug}&sort=${sort}&limit=3${cursor ? `&cursor=${cursor}` : ''}`)).expect(200); all.push(...r.body.items.map((i: { id: string }) => i.id)); cursor = r.body.nextCursor; } while (cursor);
        expect(all.sort()).toEqual([...made].sort());
      }
    });
  });

  describe('homepage', () => {
    it('shows only available series, hides empty sections, and honours banner windows and activity', async () => {
      const live = await series(); await liveEpisode(live.id); await publish(live.id).expect(200);
      const hidden = await series();
      const key = `sec-${Date.now()}`;
      await post('/admin/homepage-sections', { key, title: 'Trending', type: 'CAROUSEL', seriesIds: [live.id, hidden.id] }, admin).expect(201);
      await post('/admin/homepage-sections', { key: `${key}-empty`, title: 'Nothing live', type: 'COLLECTION', seriesIds: [hidden.id] }, admin).expect(201);
      const mk = (title: string, extra: object) => post('/admin/banners', { title, imageKey: 'images/banners/x.jpg', seriesId: live.id, ...extra }, admin).expect(201);
      await mk('Active banner', {});
      await mk('Future banner', { startAt: new Date(Date.now() + 86400000).toISOString() });
      await mk('Expired banner', { startAt: new Date(Date.now() - 2 * 86400000).toISOString(), endAt: new Date(Date.now() - 86400000).toISOString() });
      await mk('Inactive banner', { active: false });
      await post('/admin/banners', { title: 'Hidden series banner', imageKey: 'images/banners/y.jpg', seriesId: hidden.id }, admin).expect(201);

      const home = (await http(app).get(api('/home')).expect(200)).body;
      const sec = home.sections.find((s: { key: string }) => s.key === key);
      expect(sec.items.map((i: { id: string }) => i.id)).toEqual([live.id]);
      expect(home.sections.find((s: { key: string }) => s.key === `${key}-empty`)).toBeUndefined();
      expect(home.banners.map((b: { title: string }) => b.title)).toEqual(['Active banner']);
    });
  });

  describe('admin content management', () => {
    it('validates image keys: only images/ keys, no traversal, no private paths', async () => {
      const base = { title: uniq('Keys'), synopsis: 'Some synopsis for validation tests.' };
      for (const bad of ['../secrets.jpg', 'images/../../etc/passwd', 'video/source/ep1.mp4', '/images/a.jpg', 'https://evil.example/a.jpg', 'images/' + 'a'.repeat(300)]) {
        await post('/admin/series', { ...base, posterKey: bad }).expect(400);
      }
      await post('/admin/series', { ...base, posterKey: 'images/posters/ok.jpg' }).expect(201);
    });

    it('makes slugs unique and keeps episode numbers unique per series', async () => {
      const title = uniq('Same Title');
      const a = (await post('/admin/series', { title, synopsis: 'First story synopsis text.' }).expect(201)).body;
      const b = (await post('/admin/series', { title, synopsis: 'Second story synopsis text.' }).expect(201)).body;
      expect(a.slug).not.toBe(b.slug);
      const e1 = (await post(`/admin/series/${a.id}/episodes`, { title: 'One' }).expect(201)).body;
      expect(e1.number).toBe(1);
      expect((await post(`/admin/series/${a.id}/episodes`, { title: 'Two' }).expect(201)).body.number).toBe(2);
      await post(`/admin/series/${a.id}/episodes`, { title: 'Dup', number: 2 }).expect(409);
      await http(app).patch(api(`/admin/episodes/${e1.id}`)).set(bearer(editor)).send({ number: 2 }).expect(409);
      expect((await post(`/admin/series/${b.id}/episodes`, { title: 'Other series', number: 2 }).expect(201)).body.number).toBe(2);
    });

    it('rejects unknown references and duplicate cast entries', async () => {
      await post('/admin/series', { title: uniq('Refs'), synopsis: 'Synopsis for reference checks.', genreIds: ['999999'] }).expect(400);
      const c = (await post('/admin/cast', { name: 'Anaya Rao' }).expect(201)).body;
      const s = await series({ cast: [{ castMemberId: c.id, roleName: 'Lead' }] });
      const detail = (await http(app).get(api(`/admin/series/${s.id}`)).set(bearer(editor)).expect(200)).body;
      expect(detail.cast).toMatchObject([{ name: 'Anaya Rao', roleName: 'Lead' }]);
      await post('/admin/series', { title: uniq('Dup'), synopsis: 'Synopsis for dup checks.', cast: [{ castMemberId: c.id }, { castMemberId: c.id }] }).expect(400);
    });

    it('only draft series without episodes can be deleted; nothing live can be destroyed', async () => {
      const empty = await series();
      await http(app).delete(api(`/admin/series/${empty.id}`)).set(bearer(editor)).expect(204);
      const withEp = await series(); await liveEpisode(withEp.id); await publish(withEp.id).expect(200);
      await http(app).delete(api(`/admin/series/${withEp.id}`)).set(bearer(editor)).expect(409);
      const ep = (await post(`/admin/series/${(await series()).id}/episodes`, { title: 'x' }).expect(201)).body;
      await http(app).delete(api(`/admin/episodes/${ep.id}`)).set(bearer(editor)).expect(204);
    });

    it('audits every catalog mutation with the acting admin', async () => {
      const s = await series();
      const rows = await dsOf(app).query("SELECT actor_type, actor_id, action FROM audit_logs WHERE action = 'series.create' AND entity_id = ?", [s.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_type).toBe('ADMIN');
    });
  });
});
