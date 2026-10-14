import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEmail, IsEnum, IsISO8601, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { IsOptional } from '../../common/validation';
import { PageQueryDto } from '../../common/pagination.dto';
import { AdminStatus, UserStatus } from '../../database/entities/index';

const lowerTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class CreateAdminDto {
  @IsEmail() @MaxLength(254) @Transform(lowerTrim) email: string;
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  /** Initial password chosen by the creator. The new admin must still enrol MFA before getting access. */
  @IsString() @MinLength(10) @MaxLength(128) password: string;
  @IsArray() @ArrayMaxSize(20) @Matches(/^\d+$/, { each: true }) roleIds: string[];
}
export class UpdateAdminDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsEnum(AdminStatus) status?: AdminStatus;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @Matches(/^\d+$/, { each: true }) roleIds?: string[];
}
export class CreateRoleDto {
  @IsString() @MinLength(2) @MaxLength(60) @Matches(/^[A-Z][A-Z0-9_]*$/, { message: 'name must be UPPER_SNAKE_CASE' }) name: string;
  @IsString() @MaxLength(255) description: string;
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) permissions: string[];
}
export class SetRolePermissionsDto { @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) permissions: string[]; }

export class UserListQueryDto extends PageQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
}
export class SuspendUserDto { @IsOptional() @IsString() @MaxLength(255) reason?: string; }
export class AuditQueryDto extends PageQueryDto {
  @IsOptional() @IsString() @MaxLength(100) action?: string;
  @IsOptional() @IsString() @MaxLength(60) entityType?: string;
  @IsOptional() @IsString() @MaxLength(64) entityId?: string;
  @IsOptional() @IsString() @MaxLength(20) actorType?: string;
  /** Inclusive lower bound, ISO 8601 (date or date-time). */
  @IsOptional() @IsISO8601({ strict: true }) from?: string;
  /** Inclusive upper bound. A date-only value (2026-10-14) covers that whole day (UTC). */
  @IsOptional() @IsISO8601({ strict: true }) to?: string;
  @IsOptional() @Matches(/^\d{1,20}$/) actorId?: string;
}

