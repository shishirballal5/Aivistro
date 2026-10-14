import { CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Shared audit timestamps, stored as UTC DATETIME(3).
 * The defaults are spelled out because MySQL rejects a DATETIME(3) column whose default has a
 * different fractional precision (TypeORM would otherwise emit CURRENT_TIMESTAMP(6)).
 */
export abstract class TimestampedEntity {
  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)', onUpdate: 'CURRENT_TIMESTAMP(3)' })
  updatedAt: Date;
}
