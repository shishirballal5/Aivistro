import { spawn } from 'node:child_process';

export interface ProbeResult { durationSeconds: number; width: number; height: number; fps: number; hasAudio: boolean; formatName: string }
export interface Rendition { name: string; width: number; height: number; videoKbps: number; maxrateKbps: number; audioKbps: number }

/** Containers we accept. Anything else (hls, concat, image2, sdp, ...) can make FFmpeg read local files or open network URLs. */
const ALLOWED_FORMATS = ['mov,mp4,m4a,3gp,3g2,mj2', 'matroska,webm'];
export const isAllowedContainer = (formatName: string): boolean => ALLOWED_FORMATS.includes(formatName);

/** Ladder by SHORT side, so vertical (9:16) and horizontal video get equivalent quality steps. */
const LADDER = [
  { short: 1080, videoKbps: 4500, maxrateKbps: 5400 },
  { short: 720, videoKbps: 2500, maxrateKbps: 3000 },
  { short: 480, videoKbps: 1200, maxrateKbps: 1450 },
  { short: 360, videoKbps: 700, maxrateKbps: 850 },
];
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Never upscales. Always returns at least one rendition (the source's own size if it is below the smallest step). */
export function chooseLadder(width: number, height: number): Rendition[] {
  const portrait = height > width;
  const short = Math.min(width, height);
  const dims = (s: number) => (portrait ? { width: even(s), height: even((s * height) / width) } : { width: even((s * width) / height), height: even(s) });
  const rungs = LADDER.filter((r) => r.short <= short);
  if (!rungs.length) return [{ name: `${even(short)}p`, ...dims(short), videoKbps: 500, maxrateKbps: 600, audioKbps: 96 }];
  return rungs.map((r) => ({ name: `${r.short}p`, ...dims(r.short), videoKbps: r.videoKbps, maxrateKbps: r.maxrateKbps, audioKbps: 96 }));
}

export function parseProbe(json: { streams?: Record<string, unknown>[]; format?: Record<string, unknown> }): ProbeResult | { error: string } {
  const streams = json.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition as { attached_pic?: number } | undefined)?.attached_pic);
  if (!v) return { error: 'The file contains no video stream' };
  let width = Number(v.width), height = Number(v.height);
  const rotation = Math.abs(Number(((v.side_data_list as { rotation?: number }[] | undefined) ?? []).find((d) => d.rotation !== undefined)?.rotation ?? (v.tags as { rotate?: string } | undefined)?.rotate ?? 0));
  if (rotation === 90 || rotation === 270) [width, height] = [height, width]; // phones often store portrait video as rotated landscape
  const [num, den] = String(v.avg_frame_rate ?? '0/1').split('/').map(Number);
  const duration = Number((json.format?.duration as string | number | undefined) ?? v.duration ?? 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 64 || height < 64) return { error: 'The video dimensions are invalid or too small' };
  if (!Number.isFinite(duration) || duration <= 0) return { error: 'The video has no readable duration' };
  return { durationSeconds: duration, width, height, fps: den ? num / den : 25, hasAudio: streams.some((s) => s.codec_type === 'audio'), formatName: String(json.format?.format_name ?? '') };
}

/** One rendition as an AES-128 encrypted, 4-second-segment, VOD HLS playlist. All input is controlled by us; nothing user-supplied reaches the argument list. */
export function transcodeArgs(o: { input: string; outDir: string; rendition: Rendition; fps: number; hasAudio: boolean; keyInfoFile: string }): string[] {
  const r = o.rendition;
  const gop = Math.max(1, Math.round(Math.min(Math.max(o.fps, 12), 60) * 4)); // a keyframe at every segment boundary
  return [
    '-hide_banner', '-nostdin', '-y', '-protocol_whitelist', 'file',
    '-i', o.input,
    '-map', '0:v:0', ...(o.hasAudio ? ['-map', '0:a:0'] : []),
    '-vf', `scale=${r.width}:${r.height}:force_original_aspect_ratio=decrease,pad=${r.width}:${r.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-b:v', `${r.videoKbps}k`, '-maxrate', `${r.maxrateKbps}k`, '-bufsize', `${r.maxrateKbps * 2}k`,
    '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0',
    ...(o.hasAudio ? ['-c:a', 'aac', '-b:a', `${r.audioKbps}k`, '-ac', '2', '-ar', '48000'] : ['-an']),
    '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_list_size', '0', '-hls_segment_type', 'mpegts',
    '-hls_flags', 'independent_segments', '-hls_key_info_file', o.keyInfoFile,
    '-hls_segment_filename', `${o.outDir}/seg_%04d.ts`, `${o.outDir}/index.m3u8`,
  ];
}

export const thumbnailArgs = (input: string, out: string, atSeconds: number) => ['-hide_banner', '-nostdin', '-y', '-protocol_whitelist', 'file', '-ss', atSeconds.toFixed(2), '-i', input, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', out];

export function buildMasterPlaylist(variants: { name: string; width: number; height: number; bandwidth: number }[], subtitles: { language: string; label: string }[] = []): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-INDEPENDENT-SEGMENTS'];
  for (const [i, s] of subtitles.entries()) lines.push(`#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="${s.label.replace(/"/g, '')}",LANGUAGE="${s.language}",DEFAULT=NO,AUTOSELECT=${i === 0 ? 'YES' : 'NO'},URI="subs/${s.language}.m3u8"`);
  for (const v of [...variants].sort((a, b) => b.bandwidth - a.bandwidth)) {
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${v.bandwidth},RESOLUTION=${v.width}x${v.height},CODECS="avc1.4d401f,mp4a.40.2"${subtitles.length ? ',SUBTITLES="subs"' : ''}`, `${v.name}/index.m3u8`);
  }
  return `${lines.join('\n')}\n`;
}

export interface PlaylistCheck { ok: boolean; segments: string[]; problems: string[] }
/** Structural check of a media playlist we generated: complete (ENDLIST), encrypted, and at least one segment. */
export function checkMediaPlaylist(text: string): PlaylistCheck {
  const problems: string[] = [];
  if (!text.startsWith('#EXTM3U')) problems.push('not an HLS playlist');
  if (!text.includes('#EXT-X-ENDLIST')) problems.push('playlist is not complete (no ENDLIST)');
  if (!/#EXT-X-KEY:METHOD=AES-128,URI="[^"]+"/.test(text)) problems.push('segments are not AES-128 encrypted');
  const segments = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!segments.length) problems.push('playlist has no segments');
  if (segments.some((s) => !/^seg_\d{4}\.ts$/.test(s))) problems.push('unexpected segment name');
  return { ok: problems.length === 0, segments, problems };
}

/** Runs a binary with an argument array (never a shell), a hard timeout, and a bounded copy of stderr for error reports. */
export function run(cmd: string, args: string[], opts: { timeoutMs: number; cwd?: string }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { if (stdout.length < 2_000_000) stdout += d; });
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${cmd} timed out after ${Math.round(opts.timeoutMs / 1000)}s`)); }, opts.timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject((e as NodeJS.ErrnoException).code === 'ENOENT' ? new Error(`FFMPEG_NOT_FOUND: ${cmd} is not installed or FFMPEG_PATH/FFPROBE_PATH is wrong`) : e); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exited with code ${code}: ${stderr.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 400)}`)); });
  });
}
