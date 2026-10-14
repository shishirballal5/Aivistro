import { ChildProcess, spawn } from 'node:child_process';
import { createServer, Socket } from 'node:net';
import { Body, Controller, Get, Post } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { IsEmail, IsInt, IsString, Max, Min } from 'class-validator';
import { AppModule } from '../src/app.module';
import { appConfig } from '../src/config/app.config';
import { setupApp } from '../src/setup-app';

export class EchoDto {
  @IsEmail() email: string;
  @IsString() name: string;
  @IsInt() @Min(1) @Max(5) rating: number;
}

/** Test-only endpoints that exercise the global pipes, filter and throttler (Phase 1 has no feature endpoints yet). */
@Controller('echo')
export class EchoController {
  @Post() echo(@Body() dto: EchoDto) { return dto; }
  @Get('boom') boom(): never { throw new Error('secret internal detail: db password is hunter2'); }
  @Get('ping') ping() { return { ok: true }; }
}

/** Boots the real AppModule with the same setup as main.ts. `env` overrides are applied only while booting. */
export async function createApp(env: Record<string, string> = {}, customize?: (b: TestingModuleBuilder) => TestingModuleBuilder, extra: { imports?: any[]; providers?: any[] } = {}): Promise<NestExpressApplication> {
  // The config module may write into process.env; snapshot and restore everything so apps never leak into each other.
  const snapshot = { ...process.env };
  Object.assign(process.env, env);
  try {
    let builder = Test.createTestingModule({ imports: [AppModule, ...(extra.imports ?? [])], controllers: [EchoController], providers: extra.providers ?? [] });
    if (customize) builder = customize(builder);
    const moduleRef = await builder.compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true, rawBody: true });
    setupApp(app, app.get<ConfigType<typeof appConfig>>(appConfig.KEY));
    await app.init();
    return app;
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in snapshot)) delete process.env[k];
    Object.assign(process.env, snapshot);
  }
}


export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address() as { port: number }; srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

export interface ServerProcess { child: ChildProcess; port: number; stderr: () => string; exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>; }

/** Starts the REAL server entry point (src/main.ts) as a child process, the way a container would. */
export async function startServer(env: Record<string, string>): Promise<ServerProcess> {
  const port = await freePort();
  const child = spawn(process.execPath, ['-r', 'ts-node/register', 'src/main.ts'], { env: { ...process.env, NODE_ENV: 'test', ...env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr!.on('data', (d) => { err += d; });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  return { child, port, stderr: () => err, exited };
}

export async function waitForPort(port: number, ms = 25_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = new Socket();
      s.once('connect', () => { s.destroy(); resolve(true); });
      s.once('error', () => { s.destroy(); resolve(false); });
      s.connect(port, '127.0.0.1');
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Server did not start listening on :${port} within ${ms}ms`);
}

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms); })]);
  } finally { clearTimeout(timer); }
}
