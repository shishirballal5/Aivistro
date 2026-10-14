import { Column, PrimaryGeneratedColumn } from 'typeorm';

/** BIGINT UNSIGNED auto-increment primary key. The driver returns it as a string (safe for any size). */
export const PkId = () => PrimaryGeneratedColumn('increment', { type: 'bigint', unsigned: true });
/** BIGINT UNSIGNED foreign-key column. */
export const FkId = (name: string, opts: { nullable?: boolean } = {}) => Column({ name, type: 'bigint', unsigned: true, nullable: opts.nullable ?? false });
/** UTC DATETIME(3) column with an explicit name. */
export const Dt = (name: string, opts: { nullable?: boolean } = {}) => Column({ name, type: 'datetime', precision: 3, nullable: opts.nullable ?? false });
