import { SentryErrorReporter } from './sentry.reporter';

/** The adapter must load the real @sentry/node, tag errors with the request id, and NEVER throw into a request. */
describe('SentryErrorReporter', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sentry = require('@sentry/node');
  const cfg = (dsn?: string) => ({ nodeEnv: 'production', sentryDsn: dsn }) as never;

  afterEach(() => jest.restoreAllMocks());

  it('initialises Sentry without personal data and captures with request-id and path tags only (query strings stripped)', () => {
    const init = jest.spyOn(sentry, 'init').mockImplementation(() => undefined);
    const tags: Record<string, string> = {};
    jest.spyOn(sentry, 'withScope').mockImplementation(((fn: (s: { setTag(k: string, v: string): void }) => void) => fn({ setTag: (k, v) => { tags[k] = v; } })) as never);
    const capture = jest.spyOn(sentry, 'captureException').mockImplementation(() => 'evt');
    const reporter = new SentryErrorReporter(cfg('https://public@o0.ingest.sentry.io/0'));
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ dsn: 'https://public@o0.ingest.sentry.io/0', environment: 'production', sendDefaultPii: false }));
    const err = new Error('boom');
    reporter.capture(err, { requestId: 'req-123', path: '/api/v1/me?token=SECRET' });
    expect(capture).toHaveBeenCalledWith(err);
    expect(tags).toEqual({ request_id: 'req-123', path: '/api/v1/me' });
  });

  it('never throws even if Sentry itself fails', () => {
    jest.spyOn(sentry, 'init').mockImplementation(() => undefined);
    jest.spyOn(sentry, 'withScope').mockImplementation(() => { throw new Error('sentry down'); });
    const reporter = new SentryErrorReporter(cfg('https://public@o0.ingest.sentry.io/0'));
    expect(() => reporter.capture(new Error('x'), { requestId: 'r', path: '/p' })).not.toThrow();
  });

  it('really initialises against the installed SDK (no network call is awaited)', () => {
    expect(() => new SentryErrorReporter(cfg('https://public@o0.ingest.sentry.io/0'))).not.toThrow();
    expect(typeof sentry.captureException).toBe('function');
  });
});
