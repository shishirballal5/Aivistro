import { Body, Controller, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AdminContext } from '../../common/auth/auth.types';
import { AdminAuthGuard, RequireAnyPermission, RequirePermissions } from '../../common/auth/guards';
import { CurrentAdmin } from '../../common/decorators/params';
import { badRequest, conflict } from '../../common/errors';
import { clampLimit, decodeCursor, encodeCursor } from '../../common/pagination';
import { ActorType, AdminStatus, AdminUser, AuditLog, Permission, Profile, Role, User, UserStatus } from '../../database/entities/index';
import { Audit } from '../audit-logs/audit.decorator';
import { AuditService } from '../audit-logs/audit.service';
import { PasswordsService } from '../auth/passwords.service';
import { revokePlaybackSessions } from '../playback/playback.service';
import { SessionsService } from '../auth/sessions.service';
import { AuditQueryDto, CreateAdminDto, CreateRoleDto, SetRolePermissionsDto, SuspendUserDto, UpdateAdminDto, UserListQueryDto } from './admin-users.dto';

const adminView = (a: AdminUser) => ({ id: a.id, email: a.email, name: a.name, status: a.status, mfaEnabled: !!a.mfaEnabledAt, lastLoginAt: a.lastLoginAt, createdAt: a.createdAt, roles: (a.roles ?? []).map((r) => ({ id: r.id, name: r.name })) });
const roleView = (r: Role) => ({ id: r.id, name: r.name, description: r.description, isSystem: r.isSystem, permissions: (r.permissions ?? []).map((p) => p.code).sort() });

/** Admin accounts, roles, permissions. A holder of `admins.manage` can never hand out more power than they hold themselves. */
@ApiTags('admin-access')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin')
export class AdminAccessController {
  constructor(
    @InjectRepository(AdminUser) private readonly admins: Repository<AdminUser>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(Permission) private readonly permissions: Repository<Permission>,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly passwords: PasswordsService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
  ) {}

  /** Privilege-escalation guard: every permission in `roles` must already be held by the acting admin. */
  private assertCanGrant(actor: AdminContext, roles: Role[]): void {
    const beyond = roles.flatMap((r) => r.permissions.map((p) => p.code)).filter((c) => !actor.permissions.has(c));
    if (beyond.length) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You cannot grant permissions you do not have yourself' });
  }
  private async loadRoles(ids: string[]): Promise<Role[]> {
    const unique = [...new Set(ids)];
    const found = unique.length ? await this.roles.find({ where: { id: In(unique) }, relations: { permissions: true } }) : [];
    if (found.length !== unique.length) throw badRequest('UNKNOWN_ROLE', 'One or more roles do not exist');
    return found;
  }

  @Get('admin-users') @RequirePermissions('admins.manage')
  async listAdmins() { return (await this.admins.find({ relations: { roles: true }, order: { id: 'ASC' } })).map(adminView); }

  @Post('admin-users') @RequirePermissions('admins.manage') @Audit('admin_user.create', 'admin_user')
  async createAdmin(@CurrentAdmin() actor: AdminContext, @Body() dto: CreateAdminDto) {
    const roles = await this.loadRoles(dto.roleIds);
    this.assertCanGrant(actor, roles);
    this.passwords.assertStrong(dto.password);
    if (await this.admins.exists({ where: { email: dto.email } })) throw conflict('EMAIL_TAKEN', 'An admin with this email already exists');
    const saved = await this.admins.save({ email: dto.email, name: dto.name.trim(), passwordHash: await this.passwords.hash(dto.password), status: AdminStatus.Active, failedLoginCount: 0, lockedUntil: null, lastLoginAt: null, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnabledAt: null, mfaLastUsedStep: null, mfaRecoveryHashes: null, roles });
    return adminView(saved);
  }

  @Patch('admin-users/:id') @RequirePermissions('admins.manage') @Audit('admin_user.update', 'admin_user')
  async updateAdmin(@CurrentAdmin() actor: AdminContext, @Param('id') id: string, @Body() dto: UpdateAdminDto) {
    const admin = await this.admins.findOne({ where: { id }, relations: { roles: { permissions: true } } });
    if (!admin) throw new NotFoundException();
    if (id === actor.adminId && (dto.status === AdminStatus.Disabled || dto.roleIds)) throw badRequest('SELF_LOCKOUT', 'You cannot disable yourself or change your own roles');
    if (dto.roleIds) {
      const roles = await this.loadRoles(dto.roleIds);
      this.assertCanGrant(actor, roles);
      // Also stop a limited admin from stripping a more powerful admin's roles.
      this.assertCanGrant(actor, admin.roles);
      admin.roles = roles;
    }
    if (dto.name !== undefined) admin.name = dto.name.trim();
    if (dto.status !== undefined) admin.status = dto.status;
    await this.admins.save(admin);
    if (dto.status === AdminStatus.Disabled || dto.roleIds) await this.sessions.revokeAll({ adminUserId: id }, dto.status === AdminStatus.Disabled ? 'admin_disabled' : 'roles_changed');
    return adminView((await this.admins.findOne({ where: { id }, relations: { roles: true } }))!);
  }

  @Post('admin-users/:id/reset-mfa') @HttpCode(200) @RequirePermissions('admins.manage') @Audit('admin_user.reset_mfa', 'admin_user')
  async resetMfa(@CurrentAdmin() actor: AdminContext, @Param('id') id: string) {
    if (id === actor.adminId) throw badRequest('SELF_RESET', 'Ask another administrator to reset your MFA');
    const admin = await this.admins.findOne({ where: { id }, relations: { roles: { permissions: true } } });
    if (!admin) throw new NotFoundException();
    this.assertCanGrant(actor, admin.roles);
    await this.admins.update(id, { mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnabledAt: null, mfaLastUsedStep: null, mfaRecoveryHashes: null });
    await this.sessions.revokeAll({ adminUserId: id }, 'mfa_reset');
    return { id, mfaEnabled: false };
  }

  @Get('permissions') @RequirePermissions('roles.manage')
  async listPermissions() { return (await this.permissions.find({ order: { code: 'ASC' } })).map((p) => ({ code: p.code, description: p.description })); }

  /** Either permission suffices: the roles tab (roles.manage) and the admin-user role picker (admins.manage) both need this list. */
  @Get('roles') @RequireAnyPermission('admins.manage', 'roles.manage')
  async listRoles() { return (await this.roles.find({ relations: { permissions: true }, order: { id: 'ASC' } })).map(roleView); }

  @Post('roles') @RequirePermissions('roles.manage') @Audit('role.create', 'role')
  async createRole(@CurrentAdmin() actor: AdminContext, @Body() dto: CreateRoleDto) {
    const perms = await this.resolvePermissions(actor, dto.permissions);
    if (await this.roles.exists({ where: { name: dto.name } })) throw conflict('ROLE_EXISTS', 'A role with this name already exists');
    return roleView(await this.roles.save({ name: dto.name, description: dto.description, isSystem: false, permissions: perms }));
  }

  @Put('roles/:id/permissions') @RequirePermissions('roles.manage') @Audit('role.set_permissions', 'role')
  async setRolePermissions(@CurrentAdmin() actor: AdminContext, @Param('id') id: string, @Body() dto: SetRolePermissionsDto) {
    const role = await this.roles.findOne({ where: { id }, relations: { permissions: true } });
    if (!role) throw new NotFoundException();
    if (role.isSystem) throw badRequest('SYSTEM_ROLE', 'System roles cannot be modified');
    this.assertCanGrant(actor, [role]);
    role.permissions = await this.resolvePermissions(actor, dto.permissions);
    return roleView(await this.roles.save(role));
  }

  private async resolvePermissions(actor: AdminContext, codes: string[]): Promise<Permission[]> {
    const unique = [...new Set(codes)];
    const found = unique.length ? await this.permissions.find({ where: { code: In(unique) } }) : [];
    if (found.length !== unique.length) throw badRequest('UNKNOWN_PERMISSION', 'One or more permissions do not exist');
    const beyond = found.filter((p) => !actor.permissions.has(p.code));
    if (beyond.length) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You cannot grant permissions you do not have yourself' });
    return found;
  }

  // ── viewer accounts ──
  @Get('users') @RequirePermissions('users.read')
  async listUsers(@Query() q: UserListQueryDto) {
    const limit = clampLimit(q.limit);
    const cursor = decodeCursor<{ id: number }>(q.cursor, ['id']);
    const qb = this.ds.getRepository(User).createQueryBuilder('u').orderBy('u.id', 'DESC').take(limit + 1);
    if (cursor) qb.andWhere('u.id < :id', { id: cursor.id });
    if (q.status) qb.andWhere('u.status = :status', { status: q.status });
    if (q.q) qb.andWhere('(u.email LIKE :q OR u.phone LIKE :q)', { q: `%${q.q.replace(/[%_\\]/g, '\\$&')}%` });
    const rows = await qb.getMany();
    const page = rows.slice(0, limit);
    const profiles = page.length ? await this.ds.getRepository(Profile).find({ where: { userId: In(page.map((u) => u.id)) } }) : [];
    const name = new Map(profiles.map((p) => [p.userId, p.displayName]));
    return { items: page.map((u) => ({ id: u.id, displayName: name.get(u.id) ?? null, email: u.email, phone: u.phone, status: u.status, suspendedReason: u.suspendedReason, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt })), nextCursor: rows.length > limit ? encodeCursor({ id: Number(page[page.length - 1].id) }) : null };
  }

  @Get('users/:id') @RequirePermissions('users.read')
  async getUser(@Param('id') id: string) {
    const u = await this.ds.getRepository(User).findOne({ where: { id } });
    if (!u) throw new NotFoundException();
    const profile = await this.ds.getRepository(Profile).findOne({ where: { userId: id } });
    return { id: u.id, displayName: profile?.displayName ?? null, email: u.email, emailVerified: !!u.emailVerifiedAt, phone: u.phone, phoneVerified: !!u.phoneVerifiedAt, status: u.status, suspendedReason: u.suspendedReason, suspendedAt: u.suspendedAt, deletedAt: u.deletedAt, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt };
  }

  @Post('users/:id/suspend') @HttpCode(200) @RequirePermissions('users.manage') @Audit('user.suspend', 'user')
  async suspend(@Param('id') id: string, @Body() dto: SuspendUserDto) {
    const done = await this.ds.getRepository(User).update({ id, status: UserStatus.Active }, { status: UserStatus.Suspended, suspendedReason: dto.reason?.trim() || null, suspendedAt: new Date() });
    if (!done.affected) throw new NotFoundException();
    await this.sessions.revokeAll({ userId: id }, 'account_suspended'); // signed out everywhere immediately
    await revokePlaybackSessions(this.ds.manager, id, 'account_suspended'); // ...and any video that is playing stops
    return { id, status: UserStatus.Suspended, suspendedReason: dto.reason?.trim() || null };
  }

  @Post('users/:id/restore') @HttpCode(200) @RequirePermissions('users.manage') @Audit('user.restore', 'user')
  async restore(@Param('id') id: string) {
    const done = await this.ds.getRepository(User).update({ id, status: UserStatus.Suspended }, { status: UserStatus.Active, suspendedReason: null, suspendedAt: null });
    if (!done.affected) throw new NotFoundException();
    return { id, status: UserStatus.Active };
  }

  // ── audit log ──
  @Get('audit-logs') @RequirePermissions('audit.read')
  async auditLogs(@Query() q: AuditQueryDto) {
    const limit = clampLimit(q.limit, 50, 100);
    const cursor = decodeCursor<{ id: number }>(q.cursor, ['id']);
    const qb = this.ds.getRepository(AuditLog).createQueryBuilder('a').orderBy('a.id', 'DESC').take(limit + 1);
    if (q.action) qb.andWhere('a.action LIKE :action', { action: `${q.action.replace(/[%_\\]/g, '\\$&')}%` });
    if (q.entityType) qb.andWhere('a.entity_type = :et', { et: q.entityType });
    if (q.entityId) qb.andWhere('a.entity_id = :eid', { eid: q.entityId });
    if (q.actorType && Object.values(ActorType).includes(q.actorType as ActorType)) qb.andWhere('a.actor_type = :at', { at: q.actorType });
    if (q.actorId) qb.andWhere('a.actor_id = :aid', { aid: q.actorId });
    const from = q.from ? new Date(q.from) : null;
    let to = q.to ? new Date(q.to) : null;
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(q.to!)) to = new Date(to.getTime() + 86_400_000 - 1); // a bare date means "through the end of that day"
    if (from && Number.isNaN(from.getTime()) || to && Number.isNaN(to.getTime())) throw badRequest('INVALID_DATE', 'from/to must be valid ISO 8601 dates');
    if (from && to && from > to) throw badRequest('INVALID_DATE_RANGE', 'from must not be after to');
    if (from) qb.andWhere('a.created_at >= :from', { from });
    if (to) qb.andWhere('a.created_at <= :to', { to });
    if (cursor) qb.andWhere('a.id < :cid', { cid: cursor.id });
    const rows = await qb.getMany();
    const page = rows.slice(0, limit);
    return { items: page, nextCursor: rows.length > limit ? encodeCursor({ id: Number(page[page.length - 1].id) }) : null };
  }
}
