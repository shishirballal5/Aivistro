import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Dt, FkId, PkId } from '../../database/entities/columns';
import { TimestampedEntity } from '../../database/entities/timestamped.entity';
import { Episode } from '../catalog/catalog.entities';

export enum VideoStatus { Uploading = 'UPLOADING', Uploaded = 'UPLOADED', Processing = 'PROCESSING', Ready = 'READY', Failed = 'FAILED' }

export interface VideoVariant { name: string; width: number; height: number; bandwidth: number }

/**
 * A video file for one episode. Only METADATA lives here: the bytes are in object storage.
 * Everything under `source_key` and `hls_prefix` is PRIVATE and is never returned by any API.
 */
@Entity('video_assets')
@Index('idx_assets_episode', ['episodeId', 'createdAt'])
@Index('idx_assets_status', ['status', 'updatedAt'])
export class VideoAsset extends TimestampedEntity {
  @PkId() id: string;
  @FkId('episode_id') episodeId: string;
  @ManyToOne(() => Episode, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'episode_id' }) episode: Episode;
  @Column({ type: 'enum', enum: VideoStatus, default: VideoStatus.Uploading }) status: VideoStatus;
  /** The uploaded original (private/ prefix). */
  @Column({ name: 'source_key', type: 'varchar', length: 500 }) sourceKey: string;
  @Column({ name: 'source_filename', type: 'varchar', length: 255 }) sourceFilename: string;
  @Column({ name: 'content_type', type: 'varchar', length: 100 }) contentType: string;
  @Column({ name: 'declared_size_bytes', type: 'bigint', unsigned: true }) declaredSizeBytes: string;
  @Column({ name: 'size_bytes', type: 'bigint', unsigned: true, nullable: true }) sizeBytes: string | null;
  @Column({ name: 'checksum_sha256', type: 'char', length: 64, nullable: true }) checksumSha256: string | null;
  /** Output location of the current processed rendition set (private/ prefix). Changes on every (re)processing. */
  @Column({ name: 'hls_prefix', type: 'varchar', length: 500, nullable: true }) hlsPrefix: string | null;
  @Column({ type: 'json', nullable: true }) variants: VideoVariant[] | null;
  @Column({ name: 'duration_seconds', type: 'int', unsigned: true, nullable: true }) durationSeconds: number | null;
  @Column({ type: 'int', unsigned: true, nullable: true }) width: number | null;
  @Column({ type: 'int', unsigned: true, nullable: true }) height: number | null;
  @Column({ name: 'thumbnail_key', type: 'varchar', length: 500, nullable: true }) thumbnailKey: string | null;
  /** AES-128 HLS segment key, AES-256-GCM encrypted at rest. Served only through an authorised playback session. */
  @Column({ name: 'encryption_key_enc', type: 'varchar', length: 255, nullable: true }) encryptionKeyEnc: string | null;
  @Column({ name: 'processing_attempts', type: 'int', unsigned: true, default: 0 }) processingAttempts: number;
  @Column({ name: 'generation', type: 'int', unsigned: true, default: 0 }) generation: number;
  @Column({ name: 'failure_reason', type: 'varchar', length: 500, nullable: true }) failureReason: string | null;
  @Dt('processing_started_at', { nullable: true }) processingStartedAt: Date | null;
  @Dt('processed_at', { nullable: true }) processedAt: Date | null;
  @FkId('created_by_admin_id', { nullable: true }) createdByAdminId: string | null;
}

@Entity('video_subtitles')
@Index('uq_subtitle_asset_lang', ['assetId', 'language'], { unique: true })
export class VideoSubtitle extends TimestampedEntity {
  @PkId() id: string;
  @FkId('asset_id') assetId: string;
  @ManyToOne(() => VideoAsset, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'asset_id' }) asset: VideoAsset;
  @Column({ type: 'varchar', length: 10 }) language: string;
  @Column({ type: 'varchar', length: 60 }) label: string;
  @Column({ name: 'storage_key', type: 'varchar', length: 500 }) storageKey: string;
}
