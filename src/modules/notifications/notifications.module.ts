import { Module } from '@nestjs/common';
import {
    NotificationService,
    TelegramNotificationStrategy,
} from './notification-strategies';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [AuthModule],
    providers: [NotificationService, TelegramNotificationStrategy],
    exports: [NotificationService],
})
export class NotificationsModule {}
