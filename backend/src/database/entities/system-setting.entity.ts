import { Column, Entity, PrimaryColumn } from 'typeorm';
import { TimestampedEntity } from './timestamped.entity';

/**
 * Platform-wide key/value settings (maintenance mode, default free-trial days, ...).
 * Included in Phase 1 so the migration pipeline has a real, useful table to create.
 */
@Entity({ name: 'system_settings' })
export class SystemSetting extends TimestampedEntity {
  @PrimaryColumn({ name: 'setting_key', type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'json' })
  value: unknown;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;
}
