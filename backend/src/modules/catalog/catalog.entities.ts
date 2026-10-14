import { Column, Entity, Index, JoinColumn, JoinTable, ManyToMany, ManyToOne } from 'typeorm';
import { Dt, FkId, PkId } from '../../database/entities/columns';
import { TimestampedEntity } from '../../database/entities/timestamped.entity';
import { VideoAsset } from '../video-assets/video-assets.entities';

export enum ContentStatus { Draft = 'DRAFT', Scheduled = 'SCHEDULED', Published = 'PUBLISHED', Archived = 'ARCHIVED' }

@Entity('genres')
@Index('uq_genres_slug', ['slug'], { unique: true })
@Index('uq_genres_name', ['name'], { unique: true })
export class Genre extends TimestampedEntity {
  @PkId() id: string;
  @Column({ type: 'varchar', length: 60 }) name: string;
  @Column({ type: 'varchar', length: 80 }) slug: string;
}

/** Editorial groupings (e.g. "Billionaire", "Werewolf", "Dubbed in Hindi"). */
@Entity('categories')
@Index('uq_categories_slug', ['slug'], { unique: true })
@Index('uq_categories_name', ['name'], { unique: true })
export class Category extends TimestampedEntity {
  @PkId() id: string;
  @Column({ type: 'varchar', length: 60 }) name: string;
  @Column({ type: 'varchar', length: 80 }) slug: string;
  @Column({ name: 'sort_order', type: 'int', default: 0 }) sortOrder: number;
}

@Entity('cast_members')
export class CastMember extends TimestampedEntity {
  @PkId() id: string;
  @Column({ type: 'varchar', length: 120 }) name: string;
  @Column({ type: 'text', nullable: true }) bio: string | null;
  @Column({ name: 'photo_key', type: 'varchar', length: 500, nullable: true }) photoKey: string | null;
}

@Entity('series')
@Index('uq_series_slug', ['slug'], { unique: true })
@Index('idx_series_status_publish', ['status', 'publishAt'])
@Index('idx_series_published_at', ['publishedAt', 'id'])
@Index('idx_series_sort_weight', ['sortWeight', 'id'])
export class Series extends TimestampedEntity {
  @PkId() id: string;
  @Column({ type: 'varchar', length: 160 }) slug: string;
  @Column({ type: 'varchar', length: 200 }) title: string;
  @Column({ type: 'text' }) synopsis: string;
  @Column({ type: 'varchar', length: 10, default: 'hi' }) language: string;
  @Column({ name: 'maturity_rating', type: 'varchar', length: 10, default: '16+' }) maturityRating: string;
  @Column({ name: 'release_year', type: 'smallint', unsigned: true, nullable: true }) releaseYear: number | null;
  /** Object keys (never returned raw by the API). Images are public; video is not. */
  @Column({ name: 'poster_key', type: 'varchar', length: 500, nullable: true }) posterKey: string | null;
  @Column({ name: 'banner_key', type: 'varchar', length: 500, nullable: true }) bannerKey: string | null;
  @Column({ type: 'enum', enum: ContentStatus, default: ContentStatus.Draft }) status: ContentStatus;
  @Dt('publish_at', { nullable: true }) publishAt: Date | null;
  @Dt('published_at', { nullable: true }) publishedAt: Date | null;
  @Column({ name: 'sort_weight', type: 'int', default: 0 }) sortWeight: number;
  @Column({ name: 'is_featured', type: 'boolean', default: false }) isFeatured: boolean;
  @ManyToMany(() => Genre)
  @JoinTable({ name: 'series_genres', joinColumn: { name: 'series_id', referencedColumnName: 'id' }, inverseJoinColumn: { name: 'genre_id', referencedColumnName: 'id' } })
  genres: Genre[];
  @ManyToMany(() => Category)
  @JoinTable({ name: 'series_categories', joinColumn: { name: 'series_id', referencedColumnName: 'id' }, inverseJoinColumn: { name: 'category_id', referencedColumnName: 'id' } })
  categories: Category[];
}

@Entity('series_cast')
@Index('uq_series_cast', ['seriesId', 'castMemberId'], { unique: true })
export class SeriesCast extends TimestampedEntity {
  @PkId() id: string;
  @FkId('series_id') seriesId: string;
  @ManyToOne(() => Series, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'series_id' }) series: Series;
  @FkId('cast_member_id') castMemberId: string;
  @ManyToOne(() => CastMember, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'cast_member_id' }) castMember: CastMember;
  @Column({ name: 'role_name', type: 'varchar', length: 100, nullable: true }) roleName: string | null;
  @Column({ name: 'billing_order', type: 'smallint', unsigned: true, default: 0 }) billingOrder: number;
}

@Entity('episodes')
@Index('uq_episodes_series_number', ['seriesId', 'number'], { unique: true })
@Index('idx_episodes_series_status', ['seriesId', 'status', 'number'])
@Index('idx_episodes_status_publish', ['status', 'publishAt'])
export class Episode extends TimestampedEntity {
  @PkId() id: string;
  @FkId('series_id') seriesId: string;
  /** RESTRICT: a series with episodes cannot be deleted; archive it instead. */
  @ManyToOne(() => Series, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'series_id' }) series: Series;
  @Column({ type: 'int', unsigned: true }) number: number;
  @Column({ type: 'varchar', length: 200 }) title: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  /** Set from the processed video, never from client input. */
  @Column({ name: 'duration_seconds', type: 'int', unsigned: true, default: 0 }) durationSeconds: number;
  @Column({ name: 'thumbnail_key', type: 'varchar', length: 500, nullable: true }) thumbnailKey: string | null;
  @Column({ type: 'enum', enum: ContentStatus, default: ContentStatus.Draft }) status: ContentStatus;
  @Dt('publish_at', { nullable: true }) publishAt: Date | null;
  @Dt('published_at', { nullable: true }) publishedAt: Date | null;
  /** The video asset currently served for this episode (FK added with the video tables in Phase 4). */
  @FkId('current_asset_id', { nullable: true }) currentAssetId: string | null;
  /** Lazy string target: avoids a circular import with video.entities. RESTRICT: an asset in use cannot be deleted. */
  @ManyToOne('VideoAsset', { onDelete: 'RESTRICT', nullable: true }) @JoinColumn({ name: 'current_asset_id' }) currentAsset: unknown;
}

export enum SectionType { Carousel = 'CAROUSEL', Featured = 'FEATURED', Collection = 'COLLECTION' }

@Entity('homepage_sections')
@Index('uq_homepage_section_key', ['key'], { unique: true })
export class HomepageSection extends TimestampedEntity {
  @PkId() id: string;
  @Column({ type: 'varchar', length: 60 }) key: string;
  @Column({ type: 'varchar', length: 120 }) title: string;
  @Column({ type: 'enum', enum: SectionType, default: SectionType.Carousel }) type: SectionType;
  @Column({ name: 'sort_order', type: 'int', default: 0 }) sortOrder: number;
  @Column({ type: 'boolean', default: true }) active: boolean;
}

@Entity('homepage_section_items')
@Index('uq_section_item', ['sectionId', 'seriesId'], { unique: true })
export class HomepageSectionItem extends TimestampedEntity {
  @PkId() id: string;
  @FkId('section_id') sectionId: string;
  @ManyToOne(() => HomepageSection, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'section_id' }) section: HomepageSection;
  @FkId('series_id') seriesId: string;
  @ManyToOne(() => Series, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'series_id' }) series: Series;
  @Column({ name: 'sort_order', type: 'int', default: 0 }) sortOrder: number;
}

@Entity('banners')
@Index('idx_banners_active_order', ['active', 'sortOrder'])
export class Banner extends TimestampedEntity {
  @PkId() id: string;
  @Column({ type: 'varchar', length: 160 }) title: string;
  @Column({ name: 'image_key', type: 'varchar', length: 500 }) imageKey: string;
  @FkId('series_id', { nullable: true }) seriesId: string | null;
  @ManyToOne(() => Series, { onDelete: 'SET NULL', nullable: true }) @JoinColumn({ name: 'series_id' }) series: Series | null;
  @Column({ name: 'link_url', type: 'varchar', length: 500, nullable: true }) linkUrl: string | null;
  @Column({ type: 'boolean', default: true }) active: boolean;
  @Dt('start_at', { nullable: true }) startAt: Date | null;
  @Dt('end_at', { nullable: true }) endAt: Date | null;
  @Column({ name: 'sort_order', type: 'int', default: 0 }) sortOrder: number;
}
