import { IsIn, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm'] as const;
export class RequestUploadDto {
  @IsString() @MinLength(1) @MaxLength(200) @Matches(/\.(mp4|m4v|mov|mkv|webm)$/i, { message: 'filename must end in .mp4, .m4v, .mov, .mkv or .webm' }) filename: string;
  @IsIn(ALLOWED_VIDEO_TYPES) contentType: (typeof ALLOWED_VIDEO_TYPES)[number];
  /** Exact size in bytes. Verified again when the upload is completed. */
  @IsInt() @Min(1024) @Max(10_737_418_240) sizeBytes: number;
}
export class SubtitleDto {
  @IsString() @Matches(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/, { message: 'language must be a code such as hi, en or pt-BR' }) language: string;
  @IsString() @MinLength(1) @MaxLength(60) label: string;
  /** The WebVTT file contents. */
  @IsString() @MinLength(10) @MaxLength(1_000_000) vtt: string;
}
