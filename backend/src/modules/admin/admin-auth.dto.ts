import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { IsOptional } from '../../common/validation';

const lowerTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
export class AdminLoginDto {
  @IsEmail() @MaxLength(254) @Transform(lowerTrim) email: string;
  @IsString() @MinLength(1) @MaxLength(128) password: string;
}
export class MfaSetupDto { @IsString() @MinLength(20) @MaxLength(2000) setupToken: string; }
export class MfaConfirmDto {
  @IsString() @MinLength(20) @MaxLength(2000) setupToken: string;
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' }) code: string;
}
export class MfaVerifyDto {
  @IsString() @MinLength(20) @MaxLength(2000) challengeToken: string;
  @IsOptional() @Matches(/^\d{6}$/, { message: 'code must be 6 digits' }) code?: string;
  /** One of the single-use codes shown when MFA was set up, for a lost authenticator. */
  @IsOptional() @IsString() @MaxLength(40) recoveryCode?: string;
}
export class AdminRefreshDto { @IsString() @MinLength(20) @MaxLength(200) refreshToken: string; }
export class ChangePasswordDto {
  @IsString() @MaxLength(128) currentPassword: string;
  @IsString() @MinLength(10) @MaxLength(128) newPassword: string;
}
