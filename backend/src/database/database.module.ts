import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDatabaseSettings } from '../config/database.config';
import { buildTypeOrmOptions } from './typeorm.options';

@Module({
  imports: [TypeOrmModule.forRootAsync({ useFactory: () => {
        const { connectRetries, connectRetryDelayMs } = buildDatabaseSettings();
        return { ...buildTypeOrmOptions(), retryAttempts: connectRetries, retryDelay: connectRetryDelayMs };
      },
    })],
})
export class DatabaseModule {}
