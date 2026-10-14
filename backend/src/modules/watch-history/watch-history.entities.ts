import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Dt, FkId, PkId } from '../../database/entities/columns';
import { TimestampedEntity } from '../../database/entities/timestamped.entity';
import { Episode, Series } from '../catalog/catalog.entities';
import { User } from '../users/user.entities';

/** Resume position per user per episode. Duration and completion are decided by the SERVER, never reported by the client. */
@Entity('watch_progress')
@Index('uq_progress_user_episode', ['userId', 'episodeId'], { unique: true })
@Index('idx_progress_user_recent', ['userId', 'lastWatchedAt'])
export class WatchProgress extends TimestampedEntity {
  @PkId() id: string;
  @FkId('user_id') userId: string;
  @ManyToOne(() => User, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'user_id' }) user: User;
  @FkId('episode_id') episodeId: string;
  @ManyToOne(() => Episode, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'episode_id' }) episode: Episode;
  @FkId('series_id') seriesId: string;
  @Column({ name: 'position_seconds', type: 'int', unsigned: true, default: 0 }) positionSeconds: number;
  @Column({ name: 'duration_seconds', type: 'int', unsigned: true, default: 0 }) durationSeconds: number;
  @Column({ type: 'boolean', default: false }) completed: boolean;
  @Dt('last_watched_at') lastWatchedAt: Date;
}

/** One row per user per series: powers "Continue watching". */
@Entity('watch_history')
@Index('uq_history_user_series', ['userId', 'seriesId'], { unique: true })
@Index('idx_history_user_recent', ['userId', 'lastWatchedAt'])
export class WatchHistory extends TimestampedEntity {
  @PkId() id: string;
  @FkId('user_id') userId: string;
  @ManyToOne(() => User, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'user_id' }) user: User;
  @FkId('series_id') seriesId: string;
  @ManyToOne(() => Series, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'series_id' }) series: Series;
  @FkId('last_episode_id') lastEpisodeId: string;
  @Column({ name: 'last_episode_number', type: 'int', unsigned: true }) lastEpisodeNumber: number;
  @Column({ name: 'last_position_seconds', type: 'int', unsigned: true, default: 0 }) lastPositionSeconds: number;
  @Column({ name: 'last_completed', type: 'boolean', default: false }) lastCompleted: boolean;
  @Column({ name: 'episodes_completed', type: 'int', unsigned: true, default: 0 }) episodesCompleted: number;
  @Dt('last_watched_at') lastWatchedAt: Date;
}
