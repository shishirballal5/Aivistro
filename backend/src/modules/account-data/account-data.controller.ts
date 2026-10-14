import { Body, Controller, Delete, Get, Header, HttpCode, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserContext } from '../../common/auth/auth.types';
import { UserAuthGuard } from '../../common/auth/guards';
import { Client, ClientInfo, CurrentUser } from '../../common/decorators/params';
import { perMinute } from '../../common/throttler/limits';
import { AccountDataService } from './account-data.service';
import { DeleteAccountDto } from './account-data.dto';

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(UserAuthGuard)
@Controller('me')
export class AccountDataController {
  constructor(private readonly svc: AccountDataService) {}

  @Get('export') @Header('Cache-Control', 'private, no-store') @perMinute(5)
  @ApiOperation({ summary: 'Download everything we hold about you as one JSON document (never includes passwords, tokens or gateway secrets)' })
  export(@CurrentUser() u: UserContext) { return this.svc.exportFor(u.userId); }

  @Delete() @HttpCode(204) @perMinute(5)
  @ApiOperation({ summary: 'Delete your account: personal data is erased, payment records are kept without any personal details' })
  remove(@CurrentUser() u: UserContext, @Body() dto: DeleteAccountDto, @Client() c: ClientInfo) { return this.svc.deleteAccount(u, dto, c); }
}
