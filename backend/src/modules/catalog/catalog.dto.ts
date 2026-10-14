import { Transform, Type } from 'class-transformer';
import { ValidateIf, ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { IsOptional } from '../../common/validation';
import { PageQueryDto } from '../../common/pagination.dto';
import { ContentStatus, SectionType } from '../../database/entities/index';
import { IMAGE_KEY } from './catalog.util';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Like the strict IsOptional, but an explicit null passes: it means "remove this image". Any other value must still be a valid key. */
const NullableKey = () => ValidateIf((_o, v) => v !== undefined && v !== null);
const imageKey = { message: 'must be an image key under images/' };

// ── public ──
export class SeriesListQueryDto extends PageQueryDto {
  @IsOptional() @IsString() @MaxLength(80) @Matches(/^[a-z0-9-]+$/) genre?: string;
  @IsOptional() @IsString() @MaxLength(80) @Matches(/^[a-z0-9-]+$/) category?: string;
  @IsOptional() @IsString() @MaxLength(100) @Transform(trim) q?: string;
  @IsOptional() @IsIn(['newest', 'featured', 'title']) sort?: 'newest' | 'featured' | 'title';
}

// ── admin: taxonomy ──
export class NameDto { @IsString() @MinLength(1) @MaxLength(60) @Transform(trim) name: string; @IsOptional() @IsInt() @Min(0) @Max(10000) sortOrder?: number; }
export class CastMemberDto {
  @IsString() @MinLength(1) @MaxLength(120) @Transform(trim) name: string;
  @IsOptional() @IsString() @MaxLength(5000) bio?: string;
  @NullableKey() @Matches(IMAGE_KEY, imageKey) photoKey?: string | null;
}

// ── admin: series & episodes ──
export class CastLinkDto {
  @Matches(/^\d+$/) castMemberId: string;
  @IsOptional() @IsString() @MaxLength(100) roleName?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1000) billingOrder?: number;
}
export class SeriesBaseDto {
  @IsString() @MinLength(1) @MaxLength(200) @Transform(trim) title: string;
  @IsString() @MaxLength(5000) synopsis: string;
  @IsOptional() @IsIn(['hi', 'en', 'ta', 'te', 'bn', 'mr']) language?: string;
  @IsOptional() @IsIn(['U', '7+', '13+', '16+', '18+']) maturityRating?: string;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) releaseYear?: number;
  @NullableKey() @Matches(IMAGE_KEY, imageKey) posterKey?: string | null;
  @NullableKey() @Matches(IMAGE_KEY, imageKey) bannerKey?: string | null;
  @IsOptional() @IsInt() @Min(-1000) @Max(1000) sortWeight?: number;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @Matches(/^\d+$/, { each: true }) genreIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @Matches(/^\d+$/, { each: true }) categoryIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => CastLinkDto) cast?: CastLinkDto[];
}
export class CreateSeriesDto extends SeriesBaseDto {}
export class UpdateSeriesDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) @Transform(trim) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) synopsis?: string;
  @IsOptional() @IsIn(['hi', 'en', 'ta', 'te', 'bn', 'mr']) language?: string;
  @IsOptional() @IsIn(['U', '7+', '13+', '16+', '18+']) maturityRating?: string;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) releaseYear?: number;
  @NullableKey() @Matches(IMAGE_KEY, imageKey) posterKey?: string | null;
  @NullableKey() @Matches(IMAGE_KEY, imageKey) bannerKey?: string | null;
  @IsOptional() @IsInt() @Min(-1000) @Max(1000) sortWeight?: number;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @Matches(/^\d+$/, { each: true }) genreIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @Matches(/^\d+$/, { each: true }) categoryIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => CastLinkDto) cast?: CastLinkDto[];
}
export class AdminSeriesQueryDto extends PageQueryDto {
  @IsOptional() @IsEnum(ContentStatus) status?: ContentStatus;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}
export class CreateEpisodeDto {
  /** Omit to append after the last episode. */
  @IsOptional() @IsInt() @Min(1) @Max(10000) number?: number;
  @IsString() @MinLength(1) @MaxLength(200) @Transform(trim) title: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @NullableKey() @Matches(IMAGE_KEY, imageKey) thumbnailKey?: string | null;
}
export class UpdateEpisodeDto {
  @IsOptional() @IsInt() @Min(1) @Max(10000) number?: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) @Transform(trim) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @NullableKey() @Matches(IMAGE_KEY, imageKey) thumbnailKey?: string | null;
}
export class ReorderEpisodesDto {
  /** Every episode of the series, exactly once, in the new order. */
  @IsArray() @ArrayMaxSize(5000) @Matches(/^\d+$/, { each: true }) episodeIds: string[];
}
export class ScheduleDto { @IsDateString() publishAt: string; }

// ── admin: homepage ──
export class HomepageSectionDto {
  @IsString() @Matches(/^[a-z0-9-]{2,60}$/) key: string;
  @IsString() @MinLength(1) @MaxLength(120) title: string;
  @IsEnum(SectionType) type: SectionType;
  @IsOptional() @IsInt() @Min(0) @Max(10000) sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  /** Series in display order. */
  @IsArray() @ArrayMaxSize(50) @Matches(/^\d+$/, { each: true }) seriesIds: string[];
}
export class BannerDto {
  @IsString() @MinLength(1) @MaxLength(160) title: string;
  @Matches(IMAGE_KEY, imageKey) imageKey: string;
  @IsOptional() @Matches(/^\d+$/) seriesId?: string;
  @IsOptional() @IsString() @MaxLength(500) @Matches(/^https:\/\//, { message: 'linkUrl must be https' }) linkUrl?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10000) sortOrder?: number;
}
