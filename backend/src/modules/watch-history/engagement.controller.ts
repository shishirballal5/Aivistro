import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { UserContext } from '../../common/auth/auth.types';
import { UserAuthGuard } from '../../common/auth/guards';
import { CurrentUser } from '../../common/decorators/params';
import { PageQueryDto } from '../../common/pagination.dto';
import { perMinute } from '../../common/throttler/limits';
import { WatchlistService } from '../watchlist/watchlist.service';
import { HistoryService } from './history.service';
import { ProgressService } from './progress.service';

class ProgressDto { @IsInt() @Min(0) @Max(86400) positionSeconds: number; }

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(UserAuthGuard)
@Controller()
export class EngagementController {
  constructor(private readonly progress: ProgressService, private readonly history: HistoryService, private readonly watchlist: WatchlistService) {}

  @Put('episodes/:id/progress') @HttpCode(202) @perMinute(60)
  @ApiOperation({ summary: 'Report the playback position. Accepted only while a playback session is live; throttled and batched server-side.' })
  save(@CurrentUser() u: UserContext, @Param('id') id: string, @Body() dto: ProgressDto) { return this.progress.record(u.userId, id, dto.positionSeconds); }

  @Get('episodes/:id/progress') resume(@CurrentUser() u: UserContext, @Param('id') id: string) { return this.history.positionFor(u.userId, id); }

  @Get('me/continue-watching') continueWatching(@CurrentUser() u: UserContext, @Query() q: PageQueryDto) { return this.history.continueWatching(u.userId, q.cursor, q.limit); }
  @Get('me/history') episodes(@CurrentUser() u: UserContext, @Query() q: PageQueryDto) { return this.history.episodeHistory(u.userId, q.cursor, q.limit); }
  @Delete('me/history/:seriesId') @HttpCode(204) removeSeries(@CurrentUser() u: UserContext, @Param('seriesId') id: string) { return this.history.removeSeries(u.userId, id); }
  @Delete('me/history') @HttpCode(204) clear(@CurrentUser() u: UserContext) { return this.history.clearAll(u.userId); }

  @Get('me/watchlist') list(@CurrentUser() u: UserContext, @Query() q: PageQueryDto) { return this.watchlist.list(u.userId, q.cursor, q.limit); }
  @Get('me/watchlist/:seriesId') has(@CurrentUser() u: UserContext, @Param('seriesId') id: string) { return this.watchlist.has(u.userId, id); }
  @Put('me/watchlist/:seriesId') @HttpCode(200) @perMinute(60) add(@CurrentUser() u: UserContext, @Param('seriesId') id: string) { return this.watchlist.add(u.userId, id); }
  @Delete('me/watchlist/:seriesId') @HttpCode(204) remove(@CurrentUser() u: UserContext, @Param('seriesId') id: string) { return this.watchlist.remove(u.userId, id); }
}
