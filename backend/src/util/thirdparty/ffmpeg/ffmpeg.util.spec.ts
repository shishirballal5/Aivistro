import { buildMasterPlaylist, checkMediaPlaylist, chooseLadder, isAllowedContainer, parseProbe, thumbnailArgs, transcodeArgs } from './ffmpeg.util';

describe('chooseLadder', () => {
  it('builds a vertical 9:16 ladder from the SHORT side and never upscales', () => {
    expect(chooseLadder(1080, 1920).map((r) => [r.name, r.width, r.height])).toEqual([['1080p', 1080, 1920], ['720p', 720, 1280], ['480p', 480, 854], ['360p', 360, 640]]);
    expect(chooseLadder(720, 1280).map((r) => r.name)).toEqual(['720p', '480p', '360p']);
  });
  it('handles horizontal video', () => {
    expect(chooseLadder(1920, 1080).map((r) => [r.name, r.width, r.height])).toEqual([['1080p', 1920, 1080], ['720p', 1280, 720], ['480p', 854, 480], ['360p', 640, 360]]);
  });
  it('always returns at least one rendition, even for tiny sources', () => {
    const r = chooseLadder(240, 426);
    expect(r).toHaveLength(1);
    expect(r[0].width % 2).toBe(0); expect(r[0].height % 2).toBe(0);
  });
  it('keeps every dimension even (H.264 requires it)', () => {
    for (const [w, h] of [[1081, 1919], [721, 1283], [999, 555]]) for (const r of chooseLadder(w, h)) { expect(r.width % 2).toBe(0); expect(r.height % 2).toBe(0); }
  });
});

describe('parseProbe', () => {
  const ok = { streams: [{ codec_type: 'video', width: 1080, height: 1920, avg_frame_rate: '30/1' }, { codec_type: 'audio' }], format: { duration: '12.5', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' } };
  it('reads a normal file', () => expect(parseProbe(ok)).toMatchObject({ durationSeconds: 12.5, width: 1080, height: 1920, fps: 30, hasAudio: true }));
  it('swaps dimensions for rotated phone video', () => {
    expect(parseProbe({ ...ok, streams: [{ codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30/1', side_data_list: [{ rotation: -90 }] }] })).toMatchObject({ width: 1080, height: 1920 });
  });
  it.each([
    [{ streams: [{ codec_type: 'audio' }], format: { duration: '5' } }, /no video/],
    [{ streams: [{ codec_type: 'video', width: 32, height: 32 }], format: { duration: '5' } }, /dimensions/],
    [{ streams: [{ codec_type: 'video', width: 640, height: 360 }], format: { duration: '0' } }, /duration/],
    [{ streams: [{ codec_type: 'video', width: 640, height: 360, disposition: { attached_pic: 1 } }], format: { duration: '5' } }, /no video/],
  ])('rejects invalid media %#', (input, msg) => expect((parseProbe(input as never) as { error: string }).error).toMatch(msg));
  it('only allows real video containers: HLS playlists, concat lists and images are refused', () => {
    expect(isAllowedContainer('mov,mp4,m4a,3gp,3g2,mj2')).toBe(true);
    expect(isAllowedContainer('matroska,webm')).toBe(true);
    for (const bad of ['hls', 'concat', 'image2', 'sdp', 'rtsp', 'tee', 'lavfi', '']) expect(isAllowedContainer(bad)).toBe(false);
  });
});

describe('transcodeArgs', () => {
  const rendition = chooseLadder(1080, 1920)[1];
  const args = transcodeArgs({ input: '/tmp/in.mp4', outDir: '/tmp/out/720p', rendition, fps: 30, hasAudio: true, keyInfoFile: '/tmp/key.info' });
  it('encrypts, segments at 4s with aligned keyframes, and restricts protocols', () => {
    expect(args).toEqual(expect.arrayContaining(['-hls_key_info_file', '/tmp/key.info', '-hls_time', '4', '-hls_playlist_type', 'vod', '-protocol_whitelist', 'file', '-sc_threshold', '0']));
    expect(args[args.indexOf('-g') + 1]).toBe('120');
    expect(args.at(-1)).toBe('/tmp/out/720p/index.m3u8');
  });
  it('maps audio only when there is audio, and keeps portrait aspect without distortion', () => {
    expect(args).toContain('0:a:0');
    expect(transcodeArgs({ input: 'i', outDir: 'o', rendition, fps: 30, hasAudio: false, keyInfoFile: 'k' })).toEqual(expect.arrayContaining(['-an']));
    expect(args.find((a) => a.startsWith('scale='))).toContain('force_original_aspect_ratio=decrease');
  });
  it('is an argument array with no shell metacharacter handling needed', () => {
    expect(Array.isArray(args)).toBe(true);
    expect(thumbnailArgs('/a.mp4', '/t.jpg', 1.234)).toEqual(expect.arrayContaining(['-ss', '1.23', '-frames:v', '1']));
  });
});

describe('playlists', () => {
  it('master lists variants highest-bandwidth first, with subtitle tracks when present', () => {
    const m = buildMasterPlaylist([{ name: '360p', width: 360, height: 640, bandwidth: 800000 }, { name: '720p', width: 720, height: 1280, bandwidth: 2600000 }], [{ language: 'en', label: 'English' }]);
    expect(m.indexOf('720p/index.m3u8')).toBeLessThan(m.indexOf('360p/index.m3u8'));
    expect(m).toContain('RESOLUTION=720x1280');
    expect(m).toContain('URI="subs/en.m3u8"');
    expect(buildMasterPlaylist([{ name: '360p', width: 360, height: 640, bandwidth: 1 }])).not.toContain('SUBTITLES');
  });
  it('accepts a complete encrypted playlist and rejects incomplete, unencrypted or odd ones', () => {
    const good = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-KEY:METHOD=AES-128,URI="../enc.key"\n#EXTINF:4.0,\nseg_0000.ts\n#EXT-X-ENDLIST\n';
    expect(checkMediaPlaylist(good)).toMatchObject({ ok: true, segments: ['seg_0000.ts'] });
    expect(checkMediaPlaylist(good.replace('#EXT-X-ENDLIST\n', '')).problems.join()).toMatch(/ENDLIST/);
    expect(checkMediaPlaylist(good.replace(/#EXT-X-KEY.*\n/, '')).problems.join()).toMatch(/encrypted/);
    expect(checkMediaPlaylist('#EXTM3U\n#EXT-X-ENDLIST\n').problems.join()).toMatch(/no segments/);
    expect(checkMediaPlaylist(good.replace('seg_0000.ts', 'http://evil.example/x.ts')).problems.join()).toMatch(/unexpected segment/);
    expect(checkMediaPlaylist('nope').ok).toBe(false);
  });
});
