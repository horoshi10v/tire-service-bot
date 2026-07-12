import { Module } from '@nestjs/common';
import { BotUpdate } from './bot.update';
import { WarrantyVerificationHandler } from './handlers';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { WarrantyModule } from '../warranty/warranty.module';
import { SheetsModule } from '../integrations/sheets/sheets.module';
import { RolesGuard } from '../../common/guards';
import { StorageModule } from '../storage';

@Module({
    imports: [AuthModule, OrdersModule, WarrantyModule, SheetsModule, StorageModule],
    providers: [BotUpdate, WarrantyVerificationHandler, RolesGuard],
})
export class BotModule {}
