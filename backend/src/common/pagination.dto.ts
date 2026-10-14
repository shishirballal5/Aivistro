import { Type } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { IsOptional } from './validation';

export class PageQueryDto {
  @IsOptional() @IsString() @MaxLength(500) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}
