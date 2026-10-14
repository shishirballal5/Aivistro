import { Controller, Get, Header, Headers, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { decryptToBuffer } from '../../common/crypto/crypto.util';
import { KeyService } from '../../common/crypto/key.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VideoSubtitle } from '../../database/entities/index';
import { StorageService } from '../storage/storage.service';
import { buildMasterPlaylist } from '../../util/thirdparty/ffmpeg/ffmpeg.util';
import { PlaybackService } from './playback.service';

const HLS = 'application/vnd.apple.mpegurl';
const LANG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
const SEGMENT_PRESIGN_SECONDS = 60;

/**
 * Protected HLS delivery. The playback token in the path is validated against the database on EVERY request:
 * master playlist, variant playlists, encryption key, subtitles and each segment. Nothing here is reachable by guessing a URL,
 * and the segments themselves are AES-128 encrypted, so a leaked segment URL is useless without the (token-gated) key.
 */
@ApiExcludeController()
@SkipThrottle()
@Controller('media/hls/:token')
export class MediaController {
  constructor(
    private readonly playback: PlaybackService,
    private readonly storage: StorageService,
    private readonly keys: KeyService,
    @InjectRepository(VideoSubtitle) private readonly subtitles: Repository<VideoSubtitle>,
  ) {}

  @Get('master.m3u8') @Header('Cache-Control', 'no-store') @Header('Content-Type', HLS)
  async master(@Param('token') token: string) {
    const { asset } = await this.playback.authorizeToken(token);
    const subs = await this.subtitles.find({ where: { assetId: asset.id }, order: { language: 'ASC' } });
    return buildMasterPlaylist(asset.variants!, subs.map((s) => ({ language: s.language, label: s.label })));
  }

  /** The AES-128 segment key. Only a live, authorised session can fetch it. */
  @Get('enc.key') @Header('Cache-Control', 'no-store') @Header('Content-Type', 'application/octet-stream')
  async key(@Param('token') token: string, @Res() res: Response) {
    const { asset } = await this.playback.authorizeToken(token);
    if (!asset.encryptionKeyEnc) throw new NotFoundException();
    res.send(decryptToBuffer(this.keys.mediaEncryption, asset.encryptionKeyEnc));
  }

  @Get('subs/:file') @Header('Cache-Control', 'no-store')
  async subtitle(@Param('token') token: string, @Param('file') file: string, @Res() res: Response) {
    const { asset } = await this.playback.authorizeToken(token);
    const m = /^([a-z]{2,3}(?:-[A-Za-z]{2,4})?)\.(m3u8|vtt)$/.exec(file);
    if (!m || !LANG.test(m[1])) throw new NotFoundException();
    const sub = await this.subtitles.findOne({ where: { assetId: asset.id, language: m[1] } });
    if (!sub) throw new NotFoundException();
    if (m[2] === 'vtt') {
      const obj = await this.storage.get(sub.storageKey);
      if (!obj) throw new NotFoundException();
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      await pipeline(obj.stream, res);
      return;
    }
    const dur = Math.max(1, asset.durationSeconds ?? 1);
    res.setHeader('Content-Type', HLS);
    res.send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:${dur}\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:${dur}.0,\n${m[1]}.vtt\n#EXT-X-ENDLIST\n`);
  }

  @Get(':variant/index.m3u8') @Header('Cache-Control', 'no-store') @Header('Content-Type', HLS)
  async variant(@Param('token') token: string, @Param('variant') variant: string, @Res() res: Response) {
    const { asset } = await this.playback.authorizeToken(token);
    if (!asset.variants!.some((v) => v.name === variant)) throw new NotFoundException();
    const obj = await this.storage.get(`${asset.hlsPrefix}${variant}/index.m3u8`);
    if (!obj) throw new NotFoundException();
    await pipeline(obj.stream, res);
  }

  @Get(':variant/:segment') @Header('Cache-Control', 'no-store')
  async segment(@Param('token') token: string, @Param('variant') variant: string, @Param('segment') segment: string, @Headers('range') range: string | undefined, @Res() res: Response) {
    const { asset } = await this.playback.authorizeToken(token);
    if (!/^seg_\d{4}\.ts$/.test(segment) || !asset.variants!.some((v) => v.name === variant)) throw new NotFoundException();
    const key = `${asset.hlsPrefix}${variant}/${segment}`;
    const signed = await this.storage.presignGet(key, SEGMENT_PRESIGN_SECONDS); // S3/R2: a 60-second single-object URL, issued only after the token check
    if (signed) { res.redirect(302, signed); return; }
    const m = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
    const obj = await this.storage.get(key, m ? { start: Number(m[1]), end: m[2] ? Number(m[2]) : undefined } : undefined);
    if (!obj) throw new NotFoundException();
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Accept-Ranges', 'bytes');
    if (obj.range) { res.status(206); res.setHeader('Content-Range', `bytes ${obj.range.start}-${obj.range.end}/${obj.range.total}`); }
    res.setHeader('Content-Length', String(obj.size));
    await pipeline(obj.stream, res);
  }
}
