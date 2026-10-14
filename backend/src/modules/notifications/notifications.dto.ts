import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsObject, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { IsOptional } from '../../common/validation';
import { PageQueryDto } from '../../common/pagination.dto';
import { DevicePlatform, NotificationAudience, NotificationCategory } from '../../database/entities/index';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateCampaignDto {
  @IsString() @MinLength(1) @MaxLength(120) @Transform(trim) title: string;
  @IsString() @MinLength(1) @MaxLength(500) @Transform(trim) body: string;
  @IsEnum(NotificationAudience) audience: NotificationAudience;
  @IsOptional() @IsEnum(NotificationCategory) category?: NotificationCategory;
  /** Optional deep-link data for the app (flat string map), e.g. { seriesId: "12" }. */
  @IsOptional() @IsObject() data?: Record<string, string>;
  @IsOptional() @IsDateString() scheduledAt?: string;
  @IsOptional() @IsBoolean() sendNow?: boolean;
}
export class InboxQueryDto extends PageQueryDto { @IsOptional() @IsIn(['true', 'false']) unread?: 'true' | 'false'; }
export class RegisterDeviceDto {
  @IsString() @MinLength(20) @MaxLength(255) @Matches(/^[\w:.\-]+$/, { message: 'token has invalid characters' }) token: string;
  @IsEnum(DevicePlatform) platform: DevicePlatform;
}
export class PreferencesDto {
  @IsOptional() @IsBoolean() marketing?: boolean;
  @IsOptional() @IsBoolean() newEpisodes?: boolean;
  @IsOptional() @IsBoolean() billing?: boolean;
}
