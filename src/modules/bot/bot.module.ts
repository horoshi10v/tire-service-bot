import { Module } from '@nestjs/common';
import { TelegrafModule } from 'nestjs-telegraf';
import { ConfigService } from '@nestjs/config';
import { session } from 'telegraf';

import { BotUpdate } from './bot.update';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
    imports: [
        TelegrafModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (cfg: ConfigService) => ({
                token: cfg.get<string>('botToken')!,
                middlewares: [session()],
            }),
        }),
        AuthModule,
        OrdersModule,
    ],
    providers: [BotUpdate],
})
export class BotModule {}
