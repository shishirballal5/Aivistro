import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { FkId, PkId } from '../../database/entities/columns';
import { TimestampedEntity } from '../../database/entities/timestamped.entity';
import { Series } from '../catalog/catalog.entities';
import { User } from '../users/user.entities';

@Entity('watchlists')
@Index('uq_watchlist_user', ['userId'], { unique: true })
export class Watchlist extends TimestampedEntity {
  @PkId() id: string;
  @FkId('user_id') userId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_id' }) user: User;
}

@Entity('watchlist_items')
@Index('uq_watchlist_item', ['watchlistId', 'seriesId'], { unique: true })
@Index('idx_watchlist_recent', ['watchlistId', 'id'])
export class WatchlistItem {
  @PkId() id: string;
  @FkId('watchlist_id') watchlistId: string;
  @ManyToOne(() => Watchlist, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'watchlist_id' }) watchlist: Watchlist;
  @FkId('series_id') seriesId: string;
  @ManyToOne(() => Series, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'series_id' }) series: Series;
  @CreateDateColumn({ name: 'added_at', type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) addedAt: Date;
}
