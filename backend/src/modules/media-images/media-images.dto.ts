import { IsIn, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { IMAGE_UPLOAD_KEY } from './media-images.util';

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageType = (typeof ALLOWED_IMAGE_TYPES)[number];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class RequestImageUploadDto {
  /** Only used for the audit trail and a sanity check: the stored name is always server-chosen. No path separators. */
  @IsString() @MinLength(1) @MaxLength(150) @Matches(/^[A-Za-z0-9][A-Za-z0-9 _.()-]*\.(jpe?g|png|webp)$/i, { message: 'filename must be a plain file name ending in .jpg, .jpeg, .png or .webp' }) filename: string;
  @IsIn(ALLOWED_IMAGE_TYPES) contentType: ImageType;
  /** Exact size in bytes (1 byte to 5 MB). Verified again when the upload is completed. */
  @IsInt() @Min(1) @Max(MAX_IMAGE_BYTES) sizeBytes: number;
}
export class CompleteImageUploadDto {
  @IsString() @Matches(IMAGE_UPLOAD_KEY, { message: 'key must be an image key returned by POST /admin/images' }) key: string;
}
