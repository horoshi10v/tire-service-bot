import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { session } from 'telegraf';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { SheetsModule } from './modules/integrations/sheets/sheets.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrdersModule } from './modules/orders/orders.module';
import { BotModule } from './modules/bot/bot.module';
import { MailModule } from './modules/mail/mail.module';
import { PdfModule } from './modules/pdf/pdf.module';
import { WarrantyModule } from './modules/warranty/warranty.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            load: [configuration],
            validationSchema: envValidationSchema,
        }),
        // TelegrafModule global - доступен для всіх модулів через @InjectBot()
        TelegrafModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (cfg: ConfigService) => ({
                token: cfg.get<string>('botToken')!,
                middlewares: [session()],
            }),
        }),
        PrismaModule,
        SheetsModule,
        AuthModule,
        OrdersModule,
        BotModule,
        MailModule,
        PdfModule,
        WarrantyModule,
    ],
})
export class AppModule {}
