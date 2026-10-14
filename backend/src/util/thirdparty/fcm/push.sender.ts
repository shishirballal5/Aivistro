import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { importPKCS8, SignJWT } from 'jose';
import { pushConfig } from '../../../config/media.config';

export type PushResult = 'sent' | 'unregistered' | 'failed';
export interface PushMessage { title: string; body: string; data?: Record<string, string> }

/** Push provider boundary. FCM is used only when configured; otherwise in-app notifications still work. */
export abstract class PushSender {
  abstract readonly enabled: boolean;
  abstract send(token: string, message: PushMessage): Promise<PushResult>;
}

/** Captures pushes in memory for development and tests. Never exists in production. */
@Injectable()
export class PushOutbox { readonly sent: { token: string; message: PushMessage }[] = []; unregister = new Set<string>(); clear() { this.sent.length = 0; this.unregister.clear(); } }

@Injectable()
export class DevPushSender extends PushSender {
  readonly enabled = true;
  constructor(private readonly outbox: PushOutbox) { super(); }
  async send(token: string, message: PushMessage): Promise<PushResult> {
    if (this.outbox.unregister.has(token)) return 'unregistered';
    this.outbox.sent.push({ token, message });
    return 'sent';
  }
}
@Injectable()
export class DisabledPushSender extends PushSender { readonly enabled = false; async send(): Promise<PushResult> { return 'failed'; } }

/**
 * Firebase Cloud Messaging via the HTTP v1 API: a service-account JWT is exchanged for a short-lived OAuth token, which is cached.
 * NOTE: request shaping is unit-tested; it has not been exercised against Firebase's live servers here (no credentials).
 */
@Injectable()
export class FcmPushSender extends PushSender {
  readonly enabled = true;
  private readonly log = new Logger(FcmPushSender.name);
  private cache?: { token: string; expiresAt: number };

  constructor(@Inject(pushConfig.KEY) private readonly cfg: ConfigType<typeof pushConfig>) { super(); }

  private async accessToken(): Promise<string> {
    if (this.cache && this.cache.expiresAt > Date.now() + 60_000) return this.cache.token;
    const sa = JSON.parse(this.cfg.serviceAccountJson) as { client_email: string; private_key: string };
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setIssuer(sa.client_email).setSubject(sa.client_email).setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('55m')
      .sign(await importPKCS8(sa.private_key, 'RS256'));
    const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }), signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`FCM auth failed: ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.cache = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  async send(token: string, m: PushMessage): Promise<PushResult> {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.cfg.projectId)}/messages:send`, {
        method: 'POST', headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message: { token, notification: { title: m.title, body: m.body }, ...(m.data ? { data: m.data } : {}) } }), signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return 'sent';
      const err = (await res.json().catch(() => ({}))) as { error?: { status?: string } };
      if (res.status === 404 || err.error?.status === 'NOT_FOUND' || err.error?.status === 'UNREGISTERED') return 'unregistered'; // the app was uninstalled: stop using this token
      this.log.warn(`FCM rejected a message: ${res.status} ${err.error?.status ?? ''}`);
      return 'failed';
    } catch (e) { this.log.warn({ err: e }, 'FCM request failed'); return 'failed'; }
  }
}
