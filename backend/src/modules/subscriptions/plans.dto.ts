import { IsBoolean, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { IsOptional } from '../../common/validation';

export class CreatePlanDto {
  @IsString() @Matches(/^[a-z][a-z0-9_-]{1,29}$/, { message: 'code must be lowercase letters, digits, - or _' }) code: string;
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(255) description?: string;
  @IsInt() @Min(1) @Max(36) durationMonths: number;
  /** PAISE, an integer. 14900 = ₹149. */
  @IsInt() @Min(100) @Max(10_000_000) pricePaise: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}
export class UpdatePlanDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(255) description?: string;
  @IsOptional() @IsInt() @Min(100) @Max(10_000_000) pricePaise?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}
export class CheckoutDto { @IsString() @Matches(/^[a-z][a-z0-9_-]{1,29}$/) planCode: string; }
export class VerifyPaymentDto {
  @IsString() @MaxLength(64) razorpay_order_id: string;
  @IsString() @MaxLength(64) razorpay_payment_id: string;
  @IsString() @MaxLength(128) razorpay_signature: string;
}
export class GrantDto {
  @Matches(/^[a-z][a-z0-9_-]{1,29}$/) planCode: string;
  @IsString() @MinLength(3) @MaxLength(255) reason: string;
}
export class RefundDto {
  /** Omit for a full refund of what remains. PAISE. */
  @IsOptional() @IsInt() @Min(1) @Max(10_000_000) amountPaise?: number;
  @IsString() @MinLength(3) @MaxLength(255) reason: string;
}
