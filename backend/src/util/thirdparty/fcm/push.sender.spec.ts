import { exportPKCS8, generateKeyPair, jwtVerify, KeyLike } from 'jose';
import { NotificationCategory } from '../../../database/entities/index';
import { DevPushSender, FcmPushSender, PushOutbox } from './push.sender';
import { wants } from '../../../modules/notifications/notifications.service';

describe('wants (notification preferences)', () => {
  it('billing notices ignore preferences; marketing and new-episode notices respect them', () => {
    const off = { marketing: false, newEpisodes: false, billing: false };
    expect(wants(NotificationCategory.Billing, off)).toBe(true);
    expect(wants(NotificationCategory.Marketing, off)).toBe(false);
    expect(wants(NotificationCategory.NewEpisodes, off)).toBe(false);
    expect(wants(NotificationCategory.Marketing, { marketing: true })).toBe(true);
    expect(wants(NotificationCategory.NewEpisodes, { marketing: false, newEpisodes: true })).toBe(true);
    expect(wants(NotificationCategory.Marketing, null)).toBe(true); // default is opted in
    expect(wants(NotificationCategory.Marketing, {})).toBe(true);
  });
});

describe('FcmPushSender (request shapes, no network)', () => {
  let pub: KeyLike; let sender: FcmPushSender; let fetchMock: jest.SpyInstance;
  const reply = (status: number, body: unknown) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
    pub = publicKey;
    sender = new FcmPushSender({ provider: 'fcm', projectId: 'aivistro-prod', serviceAccountJson: JSON.stringify({ client_email: 'svc@aivistro-prod.iam.gserviceaccount.com', private_key: await exportPKCS8(privateKey) }) } as never);
  });
  beforeEach(() => { fetchMock = jest.spyOn(global, 'fetch'); });
  afterEach(() => fetchMock.mockRestore());

  it('exchanges a correctly signed service-account JWT for a token, then posts the message; the token is cached', async () => {
    reply(200, { access_token: 'ya29.token', expires_in: 3600 });
    reply(200, { name: 'projects/aivistro-prod/messages/1' });
    expect(await sender.send('device-token-abc', { title: 'New episodes', body: 'Watch now', data: { seriesId: '7' } })).toBe('sent');

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(String(tokenInit.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const { payload } = await jwtVerify(form.get('assertion')!, pub, { algorithms: ['RS256'] }); // signed with the service-account key
    expect(payload).toMatchObject({ iss: 'svc@aivistro-prod.iam.gserviceaccount.com', sub: 'svc@aivistro-prod.iam.gserviceaccount.com', aud: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/firebase.messaging' });

    const [sendUrl, sendInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(sendUrl).toBe('https://fcm.googleapis.com/v1/projects/aivistro-prod/messages:send');
    expect((sendInit.headers as Record<string, string>).authorization).toBe('Bearer ya29.token');
    expect(JSON.parse(String(sendInit.body))).toEqual({ message: { token: 'device-token-abc', notification: { title: 'New episodes', body: 'Watch now' }, data: { seriesId: '7' } } });

    reply(200, {});
    await sender.send('another-token', { title: 't', body: 'b' });
    expect(fetchMock).toHaveBeenCalledTimes(3); // no second token exchange
  });

  it('treats an uninstalled app (404 / UNREGISTERED) as unregistered so the token is retired, and other errors as failed', async () => {
    reply(404, { error: { status: 'NOT_FOUND' } });
    expect(await sender.send('gone', { title: 't', body: 'b' })).toBe('unregistered');
    reply(400, { error: { status: 'UNREGISTERED' } });
    expect(await sender.send('gone2', { title: 't', body: 'b' })).toBe('unregistered');
    reply(500, { error: { status: 'INTERNAL' } });
    expect(await sender.send('x', { title: 't', body: 'b' })).toBe('failed');
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    expect(await sender.send('x', { title: 't', body: 'b' })).toBe('failed'); // never throws into the caller
  });
});

describe('DevPushSender', () => {
  it('captures messages and can simulate an uninstalled app', async () => {
    const outbox = new PushOutbox(); const s = new DevPushSender(outbox);
    expect(await s.send('t1', { title: 'a', body: 'b' })).toBe('sent');
    outbox.unregister.add('t2');
    expect(await s.send('t2', { title: 'a', body: 'b' })).toBe('unregistered');
    expect(outbox.sent).toHaveLength(1);
  });
});
