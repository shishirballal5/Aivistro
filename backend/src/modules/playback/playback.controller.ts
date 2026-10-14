import { Body, Controller, Delete, Header, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { IsOptional } from '../../common/validation';
import { UserContext } from '../../common/auth/auth.types';
import { UserAuthGuard } from '../../common/auth/guards';
import { Client, ClientInfo, CurrentUser } from '../../common/decorators/params';
import { perMinute } from '../../common/throttler/limits';
import { PlaybackService } from './playback.service';

class HeartbeatDto { @IsOptional() @IsInt() @Min(0) @Max(86400) positionSeconds?: number; }

@ApiTags('playback')
@ApiBearerAuth()
@UseGuards(UserAuthGuard)
@Controller()
export class PlaybackController {
  constructor(private readonly playback: PlaybackService) {}

  @Post('episodes/:id/playback-session') @HttpCode(201) @Header('Cache-Control', 'no-store') @perMinute(30)
  @ApiOperation({ summary: 'Start watching. Re-verifies access on the server and returns a short-lived manifest URL. Errors carry SUBSCRIPTION_REQUIRED, SUBSCRIPTION_EXPIRED, EPISODE_NOT_AVAILABLE or VIDEO_PROCESSING.' })
  start(@CurrentUser() u: UserContext, @Param('id') id: string, @Client() c: ClientInfo) { return this.playback.createSession(u.userId, id, c); }

  @Post('playback-sessions/:id/heartbeat') @HttpCode(200) @Header('Cache-Control', 'no-store') @perMinute(30)
  @ApiOperation({ summary: 'Keep the session alive (every ~30s). Re-checks the subscription; a lapsed one ends the stream.' })
  heartbeat(@CurrentUser() u: UserContext, @Param('id') id: string, @Body() dto: HeartbeatDto) { return this.playback.heartbeat(u.userId, id, dto.positionSeconds); }

  @Delete('playback-sessions/:id') @HttpCode(204)
  @ApiOperation({ summary: 'Stop watching and invalidate the token' })
  end(@CurrentUser() u: UserContext, @Param('id') id: string) { return this.playback.end(u.userId, id); }
}
