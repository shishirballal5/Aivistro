import { Module } from '@nestjs/common';
import { AdminAccessController } from './admin-management.controller';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';

@Module({ controllers: [AdminAuthController, AdminAccessController], providers: [AdminAuthService], exports: [AdminAuthService] })
export class AdminModule {}
