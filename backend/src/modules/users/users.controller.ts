import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserContext } from '../../common/auth/auth.types';
import { UserAuthGuard } from '../../common/auth/guards';
import { CurrentUser } from '../../common/decorators/params';
import { Profile, User } from '../../database/entities/index';
import { AuthService } from '../auth/auth.service';
import { SessionsService } from '../auth/sessions.service';
import { UpdateProfileDto } from './users.dto';

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(UserAuthGuard)
@Controller('me')
export class UsersController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
  ) {}

  @Get() async me(@CurrentUser() u: UserContext) { return this.auth.toView(await this.users.findOneByOrFail({ id: u.userId })); }

  @Patch('profile')
  async updateProfile(@CurrentUser() u: UserContext, @Body() dto: UpdateProfileDto) {
    const profile = await this.profiles.findOneByOrFail({ userId: u.userId });
    if (dto.displayName !== undefined) profile.displayName = dto.displayName.trim();
    if (dto.avatarUrl !== undefined) profile.avatarUrl = dto.avatarUrl;
    if (dto.language !== undefined) profile.language = dto.language;
    if (dto.notificationPreferences) profile.notificationPreferences = { ...profile.notificationPreferences, ...Object.fromEntries(Object.entries(dto.notificationPreferences).filter(([, v]) => v !== undefined)) };
    await this.profiles.save(profile);
    return this.auth.toView(await this.users.findOneByOrFail({ id: u.userId }));
  }

  /** Signed-in devices. `current` marks the one making this request. */
  @Get('sessions')
  async listSessions(@CurrentUser() u: UserContext) {
    const rows = await this.sessions.listActive({ userId: u.userId });
    return rows.map((s) => ({ id: s.id, deviceName: s.deviceName, userAgent: s.userAgent, ipAddress: s.ipAddress, lastSeenAt: s.lastSeenAt, createdAt: s.createdAt, current: s.id === u.sessionId }));
  }

  @Delete('sessions/:id') @HttpCode(204)
  async revokeSession(@CurrentUser() u: UserContext, @Param('id') id: string) {
    if (!/^\d+$/.test(id)) throw new NotFoundException();
    const done = await this.sessions.revoke(id, 'revoked_by_user', { userId: u.userId }); // owner-scoped: you cannot revoke someone else's session
    if (!done) throw new NotFoundException();
  }
}
