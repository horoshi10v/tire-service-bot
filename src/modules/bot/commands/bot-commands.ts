import { Injectable } from '@nestjs/common';
import type { Context } from 'telegraf';
import { BotSessionData } from '../bot.session';
import { AuthService } from '../../auth/auth.service';
import { OrdersService } from '../../orders/orders.service';

export type BotContext = Context & { session: BotSessionData };

/**
 * Type guard to check if message has text
 */
function hasText(message: any): message is { text: string } {
    return message && typeof message.text === 'string';
}

/**
 * Command Pattern - abstract base for bot command handlers
 */
export abstract class BaseBotCommand {
    constructor(
        protected readonly auth: AuthService,
        protected readonly orders: OrdersService
    ) {}

    abstract canHandle(ctx: BotContext): boolean;
    abstract handle(ctx: BotContext): Promise<void>;
}

/**
 * Start command handler
 */
@Injectable()
export class StartCommand extends BaseBotCommand {
    canHandle(ctx: BotContext): boolean {
        if (ctx.updateType !== 'message' || !ctx.message) {
            return false;
        }
        if (!hasText(ctx.message)) {
            return false;
        }
        return ctx.message.text === '/start';
    }

    async handle(ctx: BotContext): Promise<void> {
        await ctx.reply('🔄 Оновлення меню…', {
            reply_markup: { remove_keyboard: true },
        });

        await ctx.reply(
            '🚗 Бот шиномонтажу\n\n' +
                '📸 Надішліть фото — створити нове замовлення\n' +
                '🔎 /search — пошук за телефоном\n' +
                '📌 /active <id> — відкрити замовлення\n\n' +
                'Або використовуйте меню нижче 👇',
            { reply_markup: this.getMainMenuKeyboard() }
        );
    }

    private getMainMenuKeyboard() {
        return {
            resize_keyboard: true,
            one_time_keyboard: false,
            is_persistent: true,
            keyboard: [
                ['🆕 Нове', '🔍 Пошук'],
                ['🟡 Прийняті', '🔵 В роботі'],
                ['🟢 Готові', '⚫ Виконані'],
                ['📌 Відкрити замовлення', '📊 Статистика'],
            ],
        };
    }
}

/**
 * Search command handler
 */
@Injectable()
export class SearchCommand extends BaseBotCommand {
    canHandle(ctx: BotContext): boolean {
        if (
            ctx.updateType !== 'message' ||
            !ctx.message ||
            !hasText(ctx.message)
        ) {
            return false;
        }
        const text = ctx.message.text;
        return text.startsWith('/search') || text === '🔍 Пошук';
    }

    async handle(ctx: BotContext): Promise<void> {
        ctx.session.flow = 'search';
        ctx.session.step = 'phonePart';
        await ctx.reply('Введіть номер телефону (або його частину):');
    }
}

/**
 * Open order command handler
 */
@Injectable()
export class OpenOrderCommand extends BaseBotCommand {
    canHandle(ctx: BotContext): boolean {
        if (
            ctx.updateType !== 'message' ||
            !ctx.message ||
            !hasText(ctx.message)
        ) {
            return false;
        }
        const text = ctx.message.text;
        return text.startsWith('/active') || text === '📌 Відкрити замовлення';
    }

    async handle(ctx: BotContext): Promise<void> {
        if (!ctx.message || !hasText(ctx.message)) return;

        const text = ctx.message.text;
        if (text.startsWith('/active')) {
            const parts = text.split(/\s+/);
            const id = Number(parts[1]);
            if (!id) {
                await ctx.reply('Формат: /active 123');
                return;
            }

            try {
                const order = await this.orders.getByPublicId(id);
                await this.sendOrderCard(ctx, order);
            } catch (e: any) {
                if (e?.status === 404) {
                    await ctx.reply('❌ Замовлення з таким ID не знайдено');
                    return;
                }
                await ctx.reply('🚨 Помилка. Спробуйте пізніше.');
            }
        } else {
            ctx.session.flow = null;
            ctx.session.step = 'openPublicId';
            await ctx.reply('Введіть ID замовлення, наприклад: 1234');
        }
    }

    private async sendOrderCard(ctx: BotContext, order: any) {
        // Implementation would be moved from bot.helpers
        // This is a simplified version
        const text = `#${order.publicId} - Деталі замовлення тут...`;
        await ctx.reply(text);
    }
}
