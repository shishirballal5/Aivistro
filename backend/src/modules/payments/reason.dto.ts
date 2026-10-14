import { IsString, MaxLength, MinLength } from 'class-validator';
export class SuspendReason { @IsString() @MinLength(3) @MaxLength(60) reason: string; }
