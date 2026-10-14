import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { authConfig } from '../../../config/auth.config';
import { unavailable } from '../../../common/errors';

export interface OutboxMessage { kind: 'sms' | 'email'; to: string; subject?: string; body: string; at: Date }

/** In-memory capture of dev messages so tests and local dev can read OTPs and links. Never exists in production. */
@Injectable()
export class DevOutbox {
  readonly messages: OutboxMessage[] = [];
  push(m: Omit<OutboxMessage, 'at'>) { this.messages.push({ ...m, at: new Date() }); if (this.messages.length > 200) this.messages.shift(); }
  last(to: string): OutboxMessage | undefined { return [...this.messages].reverse().find((m) => m.to === to); }
  clear() { this.messages.length = 0; }
}

export abstract class SmsSender { abstract send(to: string, body: string): Promise<void>; abstract readonly enabled: boolean; }
export abstract class EmailSender { abstract send(to: string, subject: string, body: string): Promise<void>; abstract readonly enabled: boolean; }

@Injectable()
export class DevSmsSender extends SmsSender {
  readonly enabled = true;
  private readonly log = new Logger('DevSms');
  constructor(private readonly outbox: DevOutbox) { super(); }
  async send(to: string, body: string) { this.outbox.push({ kind: 'sms', to, body }); this.log.warn(`DEV ONLY - SMS to ${to}: ${body}`); }
}
@Injectable()
export class DevEmailSender extends EmailSender {
  readonly enabled = true;
  private readonly log = new Logger('DevEmail');
  constructor(private readonly outbox: DevOutbox) { super(); }
  async send(to: string, subject: string, body: string) { this.outbox.push({ kind: 'email', to, subject, body }); this.log.warn(`DEV ONLY - email to ${to}: ${subject}`); }
}

/** Posts `{ to, message }` (SMS) or `{ to, subject, text }` (email) as JSON to a gateway you operate or a provider's HTTP API. */
async function postJson(url: string, authorization: string | undefined, payload: unknown): Promise<void> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Provider responded ${res.status}`);
}
@Injectable()
export class HttpSmsSender extends SmsSender {
  readonly enabled = true;
  constructor(@Inject(authConfig.KEY) private readonly cfg: ConfigType<typeof authConfig>) { super(); }
  async send(to: string, body: string) { await postJson(this.cfg.sms.url!, this.cfg.sms.authorization, { to, message: body }); }
}
@Injectable()
export class HttpEmailSender extends EmailSender {
  readonly enabled = true;
  constructor(@Inject(authConfig.KEY) private readonly cfg: ConfigType<typeof authConfig>) { super(); }
  async send(to: string, subject: string, body: string) { await postJson(this.cfg.email.url!, this.cfg.email.authorization, { to, subject, text: body }); }
}

@Injectable()
export class DisabledSmsSender extends SmsSender {
  readonly enabled = false;
  async send(): Promise<void> { throw unavailable('SMS_NOT_CONFIGURED', 'Phone sign-in is not available right now'); }
}
@Injectable()
export class DisabledEmailSender extends EmailSender {
  readonly enabled = false;
  async send(): Promise<void> { throw unavailable('EMAIL_NOT_CONFIGURED', 'Email sign-in is not available right now'); }
}
