import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from './typeorm.options';

// Used only by the TypeORM CLI (migration:run / generate / revert / show).
config({ path: process.env.ENV_FILE ?? '.env' });

export default new DataSource(buildTypeOrmOptions());
