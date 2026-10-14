import { Module } from '@nestjs/common';
import { AccountDataController } from './account-data.controller';
import { AccountDataService } from './account-data.service';

/** Viewer data rights: export everything, delete the account. Guards, sessions, passwords and audit come from the global auth/audit modules. */
@Module({ controllers: [AccountDataController], providers: [AccountDataService] })
export class AccountDataModule {}
