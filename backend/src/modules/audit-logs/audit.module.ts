import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditLog } from '../../database/entities/index';
import { AuditInterceptor } from './audit.decorator';
import { AuditService } from './audit.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [AuditService, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
  exports: [AuditService],
})
export class AuditModule {}
