import { Equals, IsBoolean, IsString, MaxLength } from 'class-validator';
import { IsOptional } from '../../common/validation';

export class DeleteAccountDto {
  /** Typed confirmation: must be exactly "DELETE". */
  @Equals('DELETE', { message: 'confirm must be the word DELETE' }) confirm: 'DELETE';
  /** Required for accounts that have a password. */
  @IsOptional() @IsString() @MaxLength(128) password?: string;
  /** Required when a paid subscription is still running: its remaining time is NOT refunded automatically. */
  @IsOptional() @IsBoolean() acknowledgeLostAccess?: boolean;
}
