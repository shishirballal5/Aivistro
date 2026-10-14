import { Controller, Get, Header, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserContext } from '../../common/auth/auth.types';
import { OptionalUserAuthGuard } from '../../common/auth/guards';
import { MaybeUser } from '../../common/decorators/params';
import { EntitlementsService } from './entitlements.service';

@ApiTags('playback')
@Controller('episodes')
export class AccessController {
  constructor(private readonly entitlements: EntitlementsService) {}

  /**
   * "May I watch this?" for one episode. Informational only: it never grants anything. Playback is decided again,
   * independently, when a playback session is requested. Unknown and hidden episodes answer identically.
   */
  @Get(':id/access') @Header('Cache-Control', 'private, no-store') @UseGuards(OptionalUserAuthGuard)
  @ApiOperation({ summary: 'Access decision for an episode (allowed, or a denial code such as SUBSCRIPTION_REQUIRED)' })
  async access(@Param('id') id: string, @MaybeUser() u?: UserContext) {
    const d = await this.entitlements.checkEpisode(u?.userId ?? null, id);
    return { episodeId: id, ...d };
  }
}
