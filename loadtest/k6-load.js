// Load test for the AIVISTRO API. Needs a stack running the DEV adapters (OTP outbox + simulated payments) and seeded content.
//   k6 run -e API=http://localhost:3000/api/v1 loadtest/k6-load.js
// For a meaningful run, start the API with the rate limits lifted (THROTTLE_LIMIT=1000000 AUTH_RATE_LIMIT_SCALE=1000), otherwise you are
// measuring the rate limiter, which is doing its job. Scale with -e BROWSE_VUS=200 -e STREAM_VUS=50 -e USERS=50 -e DURATION=2m.
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const API = __ENV.API || 'http://localhost:3000/api/v1';
const BROWSE_VUS = +(__ENV.BROWSE_VUS || 50), AUTHED_VUS = +(__ENV.AUTHED_VUS || 20), STREAM_VUS = +(__ENV.STREAM_VUS || 20), USERS = +(__ENV.USERS || 20), DURATION = __ENV.DURATION || '60s';
const segmentTime = new Trend('segment_fetch_ms', true), keyTime = new Trend('hls_key_ms', true), sessionTime = new Trend('playback_session_ms', true);
const json = { headers: { 'Content-Type': 'application/json' } };
const auth = (t) => ({ headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` } });

export const options = {
  setupTimeout: '300s',
  scenarios: {
    browse: { executor: 'ramping-vus', exec: 'browse', startVUs: 0, stages: [{ duration: '15s', target: BROWSE_VUS }, { duration: DURATION, target: BROWSE_VUS }, { duration: '10s', target: 0 }] },
    signed_in: { executor: 'constant-vus', exec: 'signedIn', vus: AUTHED_VUS, duration: DURATION, startTime: '15s' },
    streaming: { executor: 'constant-vus', exec: 'streaming', vus: STREAM_VUS, duration: DURATION, startTime: '15s' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{scenario:browse}': ['p(95)<400'],
    'http_req_duration{scenario:signed_in}': ['p(95)<600'],
    playback_session_ms: ['p(95)<800'],
    hls_key_ms: ['p(95)<400'],
    segment_fetch_ms: ['p(95)<800'],
  },
};

function phone() { return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`; }

/** Creates real users through the real endpoints: OTP -> profile -> simulated payment -> verified subscription. */
function makeSubscriber(i) {
  const ph = phone();
  http.post(`${API}/auth/otp/request`, JSON.stringify({ phone: ph }), json);
  const msg = http.get(`${API}/dev/outbox?to=${encodeURIComponent('+91' + ph)}`).json('message');
  const code = /(\d{6})/.exec(msg ? msg.body : '')[1];
  const reg = http.post(`${API}/auth/otp/verify`, JSON.stringify({ phone: ph, code, displayName: `Load User ${i}`, email: `load${Date.now()}${i}${Math.floor(Math.random() * 1e4)}@example.com`, dateOfBirth: '1990-01-01' }), json).json();
  const token = reg.accessToken;
  const order = http.post(`${API}/subscriptions/checkout`, JSON.stringify({ planCode: 'monthly' }), auth(token)).json();
  const proof = http.post(`${API}/dev/payments/${order.orderId}/complete`, JSON.stringify({}), auth(token)).json();
  const res = http.post(`${API}/subscriptions/verify`, JSON.stringify(proof), auth(token)).json();
  if (res.status !== 'ACTIVE') throw new Error(`could not create a subscriber: ${JSON.stringify(res).slice(0, 200)}`);
  return token;
}

export function setup() {
  const series = http.get(`${API}/series?limit=20`).json('items');
  if (!series.length) throw new Error('no series: seed content first (backend: npm run seed:dev && npm run seed:demo)');
  const subscribers = [];
  for (let i = 0; i < USERS; i++) subscribers.push(makeSubscriber(i));
  const playable = series.map((s) => ({ slug: s.slug, id: s.id })).filter((s) => s.id);
  const eps = http.get(`${API}/series/${series[0].slug}/episodes`).json('items');
  return { slugs: series.map((s) => s.slug), episodeIds: eps.map((e) => e.id), seriesIds: series.map((s) => s.id), subscribers, playable };
}

export function browse(d) {
  group('anonymous browsing', () => {
    check(http.get(`${API}/home`), { 'home 200': (r) => r.status === 200 });
    check(http.get(`${API}/series?limit=20`), { 'series 200': (r) => r.status === 200 });
    const slug = d.slugs[Math.floor(Math.random() * d.slugs.length)];
    check(http.get(`${API}/series/${slug}`), { 'detail 200': (r) => r.status === 200 });
    check(http.get(`${API}/series/${slug}/episodes`), { 'episodes 200': (r) => r.status === 200 });
    check(http.get(`${API}/plans`), { 'plans 200': (r) => r.status === 200 });
  });
  sleep(1 + Math.random());
}

export function signedIn(d) {
  const token = d.subscribers[(__VU - 1) % d.subscribers.length];
  group('signed-in activity', () => {
    check(http.get(`${API}/me`, auth(token)), { 'me 200': (r) => r.status === 200 });
    check(http.get(`${API}/subscriptions/me`, auth(token)), { 'subscription 200': (r) => r.status === 200 });
    check(http.get(`${API}/me/continue-watching`, auth(token)), { 'continue 200': (r) => r.status === 200 });
    const sid = d.seriesIds[Math.floor(Math.random() * d.seriesIds.length)];
    check(http.put(`${API}/me/watchlist/${sid}`, null, auth(token)), { 'watchlist add': (r) => r.status === 200 });
    // (watch progress is only accepted while a playback session is live: that is exercised in the streaming scenario)
    check(http.get(`${API}/me/notifications/unread-count`, auth(token)), { 'unread 200': (r) => r.status === 200 });
  });
  sleep(1 + Math.random());
}

export function streaming(d) {
  const token = d.subscribers[(__VU - 1) % d.subscribers.length];
  const epId = d.episodeIds[__ITER % d.episodeIds.length];
  const s = http.post(`${API}/episodes/${epId}/playback-session`, null, auth(token));
  sessionTime.add(s.timings.duration);
  if (!check(s, { 'session 201': (r) => r.status === 201 })) { sleep(2); return; }
  const base = s.json('manifestUrl').replace(/\/master\.m3u8$/, '');
  const root = API.replace(/\/api\/v1$/, '');
  const master = http.get(`${root}${base}/master.m3u8`);
  check(master, { 'master playlist 200': (r) => r.status === 200 });
  const variant = (/^(?!#)(.+\.m3u8)/m.exec(master.body) || [])[1];
  const media = http.get(`${root}${base}/${variant}`);
  check(media, { 'variant playlist 200': (r) => r.status === 200 });
  // the key URI is relative to the variant playlist (../enc.key)
  const keyUri = /URI="([^"]+)"/.exec(media.body);
  if (keyUri) { const u = keyUri[1]; const k = http.get(u.startsWith('http') ? u : u.startsWith('../') ? `${root}${base}/${u.slice(3)}` : `${root}${u}`); keyTime.add(k.timings.duration); check(k, { 'key 200, 16 bytes': (r) => r.status === 200 && r.body.length === 16 }); }
  const segs = media.body.split('\n').filter((l) => l && !l.startsWith('#')).slice(0, 3);
  for (const seg of segs) { const r = http.get(`${root}${base}/${variant.split('/')[0]}/${seg}`, { redirects: 5 }); segmentTime.add(r.timings.duration); check(r, { 'segment 200': (x) => x.status === 200 }); sleep(0.3); }
  check(http.put(`${API}/episodes/${epId}/progress`, JSON.stringify({ positionSeconds: 3 }), auth(token)), { 'progress 202 during playback': (r) => r.status === 202 });
  check(http.post(`${API}/playback-sessions/${s.json('sessionId')}/heartbeat`, JSON.stringify({ positionSeconds: 3 }), auth(token)), { 'heartbeat 200': (r) => r.status === 200 });
  http.del(`${API}/playback-sessions/${s.json('sessionId')}`, null, auth(token));
  sleep(1);
}
