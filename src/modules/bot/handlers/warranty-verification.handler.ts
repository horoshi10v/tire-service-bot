import { Injectable } from '@nestjs/common';
import { BotContext } from '../bot.helpers';
import { WarrantyVerificationService } from '../../warranty';

/**
 * Handler for verifying warranty from QR code data
 */
@Injectable()
export class WarrantyVerificationHandler {
    constructor(
        private readonly warrantyService: WarrantyVerificationService
    ) {}

    /**
     * Handle warranty verification from QR code
     */
    async handle(
        ctx: BotContext,
        data: { publicId: number; token: string }
    ): Promise<void> {
        try {
            const warranty = await this.warrantyService.verifyWarranty(
                data.publicId,
                data.token
            );

            const message = this.formatWarrantyMessage(warranty);
            await ctx.reply(message);
        } catch (error: any) {
            await this.handleError(ctx, error);
        }
    }

    /**
     * Format warranty verification result as user-friendly message
     */
    private formatWarrantyMessage(warranty: any): string {
        let message = `✅ ГАРАНТІЮ ПІДТВЕРДЖЕНО\n\n`;
        message += `📋 Замовлення #${warranty.orderId}\n`;
        message += `👨‍🔧 Майстер: ${warranty.master}\n`;
        message += `💵 Сума: ${warranty.totalAmount} грн\n`;
        message += `✅ Виконано: ${warranty.completedAt?.toLocaleDateString('uk-UA')}\n\n`;
        message += `🔧 Послуги:\n`;

        for (const service of warranty.services) {
            const warrantyStatus = service.isWarrantyActive
                ? '✅ Активна'
                : '❌ Закінчилася';
            message += `• ${service.service} — ${service.price} грн\n`;
            if (service.warrantyDays) {
                message += `  📅 Гарантія: ${service.warrantyDays} днів — ${warrantyStatus}\n`;
            }
            if (service.comment) {
                message += `  💬 ${service.comment}\n`;
            }
        }

        return message;
    }

    /**
     * Handle errors during warranty verification
     */
    private async handleError(ctx: BotContext, error: any): Promise<void> {
        if (error.status === 404) {
            await ctx.reply('❌ Замовлення не знайдено');
        } else if (error.status === 400) {
            await ctx.reply('❌ Невірний токен верифікації');
        } else {
            console.error('Warranty verification error', error);
            await ctx.reply('🚨 Помилка перевірки гарантії');
        }
    }
}
