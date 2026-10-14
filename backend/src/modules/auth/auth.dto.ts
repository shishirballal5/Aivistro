import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { IsOptional } from '../../common/validation';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lowerTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class RequestOtpDto {
  /** Mobile number. A bare 10-digit number is treated as Indian (+91). */
  @IsString() @MinLength(8) @MaxLength(20) @Transform(trim) phone: string;
}
const DOB = /^\d{4}-\d{2}-\d{2}$/;
const dobMsg = { message: 'dateOfBirth must be YYYY-MM-DD' };
export class VerifyOtpDto {
  @IsString() @MinLength(8) @MaxLength(20) @Transform(trim) phone: string;
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' }) code: string;
  @IsOptional() @IsString() @MaxLength(120) deviceName?: string;
  /** Required for a NEW account (all three together). Ignored when the number already has an account. */
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) @Transform(trim) displayName?: string;
  @IsOptional() @IsEmail() @MaxLength(254) @Transform(lowerTrim) email?: string;
  @IsOptional() @Matches(DOB, dobMsg) dateOfBirth?: string;
}
/** Second step for a new phone number that verified its OTP without profile details. */
export class CompleteProfileDto {
  @IsString() @MinLength(20) @MaxLength(2000) profileToken: string;
  @IsString() @MinLength(2) @MaxLength(100) @Transform(trim) displayName: string;
  @IsEmail() @MaxLength(254) @Transform(lowerTrim) email: string;
  @Matches(DOB, dobMsg) dateOfBirth: string;
  @IsOptional() @IsString() @MaxLength(120) deviceName?: string;
}
export class RegisterDto {
  @IsEmail() @MaxLength(254) @Transform(lowerTrim) email: string;
  @IsString() @MinLength(10) @MaxLength(128) password: string;
  @IsString() @MinLength(2) @MaxLength(100) @Transform(trim) displayName: string;
  @Matches(DOB, dobMsg) dateOfBirth: string;
}
export class EmailDto { @IsEmail() @MaxLength(254) @Transform(lowerTrim) email: string; }
export class TokenDto { @IsString() @MinLength(20) @MaxLength(200) token: string; }
export class LoginDto {
  @IsEmail() @MaxLength(254) @Transform(lowerTrim) email: string;
  @IsString() @MinLength(1) @MaxLength(128) password: string;
  @IsOptional() @IsString() @MaxLength(120) deviceName?: string;
}
export class SocialLoginDto {
  /** The ID token (JWT) issued to your app by Google / Apple. */
  @IsString() @MinLength(20) @MaxLength(4096) idToken: string;
  @IsOptional() @IsString() @MaxLength(200) nonce?: string;
  @IsOptional() @IsString() @MaxLength(120) deviceName?: string;
  /** Apple only sends the name on the first sign-in, and only to the app. */
  @IsOptional() @IsString() @MaxLength(100) displayName?: string;
  /** Required only when this sign-in would create a new account. */
  @IsOptional() @Matches(DOB, dobMsg) dateOfBirth?: string;
}
export class RefreshDto { @IsString() @MinLength(20) @MaxLength(200) refreshToken: string; }
export class ResetPasswordDto {
  @IsString() @MinLength(20) @MaxLength(200) token: string;
  @IsString() @MinLength(10) @MaxLength(128) newPassword: string;
}
