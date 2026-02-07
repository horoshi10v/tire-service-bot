import { Injectable } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import {
    OrderCreatedEvent,
    OrderStatusChangedEvent,
} from '../../common/events';
import { AuthService } from '../auth/auth.service';

export interface INotificationStrategy {
    sendOrderCreated(event: OrderCreatedEvent): Promise<void>;
    sendStatusChanged(event: OrderStatusChangedEvent): Promise<void>;
}

/**
 * Telegram notification strategy
 */
@Injectable()
export class TelegramNotificationStrategy implements INotificationStrategy {
    constructor(
        @InjectBot() private readonly bot: Telegraf,
        private readonly authService: AuthService
    ) {}

    async sendOrderCreated(event: OrderCreatedEvent): Promise<void> {
        const text =
            `🆕 Нове замовлення #${event.publicId}\n` +
            `📞 ${event.clientPhone}`;

        const adminIds = await this.getAdminIds();
        await this.broadcastMessage(adminIds, text);
    }

    async sendStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
        const statusNames: Record<string, string> = {
            ACCEPTED: 'Прийнято',
            IN_PROGRESS: 'В роботі',
            READY: 'Готово',
            DONE: 'Видано',
        };

        const text =
            `🔔 Статус змінено: #${event.publicId}\n` +
            `${statusNames[event.fromStatus] || event.fromStatus} → ${statusNames[event.toStatus] || event.toStatus}`;

        const adminIds = await this.getAdminIds();
        await this.broadcastMessage(adminIds, text);
    }

    private async getAdminIds(): Promise<bigint[]> {
        return this.authService.getActiveAdminTgIds();
    }

    private async broadcastMessage(
        chatIds: bigint[],
        text: string
    ): Promise<void> {
        await Promise.all(
            chatIds.map(async (chatId) => {
                try {
                    await this.bot.telegram.sendMessage(Number(chatId), text);
                } catch (error) {
                    // Log error but don't throw
                    console.error(
                        `Failed to send message to ${chatId}:`,
                        error
                    );
                }
            })
        );
    }
}

/**
 * Notification service using Strategy Pattern
 */
@Injectable()
export class NotificationService {
    constructor(
        private readonly telegramStrategy: TelegramNotificationStrategy
    ) {}

    async notifyOrderCreated(event: OrderCreatedEvent): Promise<void> {
        await this.telegramStrategy.sendOrderCreated(event);
    }

    async notifyStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
        await this.telegramStrategy.sendStatusChanged(event);
    }
}
