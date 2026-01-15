import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { SheetsModule } from './modules/integrations/sheets/sheets.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrdersModule } from './modules/orders/orders.module';
import { BotModule } from './modules/bot/bot.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            load: [configuration],
            validationSchema: envValidationSchema,
        }),
        PrismaModule,
        SheetsModule,
        AuthModule,
        OrdersModule,
        BotModule,
    ],
})
export class AppModule {}
