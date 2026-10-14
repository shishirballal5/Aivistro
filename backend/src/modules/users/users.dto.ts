import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsString, IsUrl, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { IsOptional } from '../../common/validation';

export class NotificationPrefsDto {
  @IsOptional() @IsBoolean() marketing?: boolean;
  @IsOptional() @IsBoolean() newEpisodes?: boolean;
  @IsOptional() @IsBoolean() billing?: boolean;
}
export class UpdateProfileDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) displayName?: string;
  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(500) avatarUrl?: string;
  @IsOptional() @IsIn(['hi', 'en', 'ta', 'te', 'bn', 'mr']) language?: string;
  @IsOptional() @ValidateNested() @Type(() => NotificationPrefsDto) notificationPreferences?: NotificationPrefsDto;
}
