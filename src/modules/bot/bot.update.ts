import { Update, Start, Command, On, Ctx, Action } from 'nestjs-telegraf';
import type { Context } from 'telegraf';
import { AuthService } from '../auth/auth.service';
import { OrdersService } from '../orders/orders.service';
import { BotSessionData } from './bot.session';
import { servicesKeyboard, SERVICE_LABELS, staffKeyboard } from './keyboards';
import { OrderStatus, ServiceType } from '@prisma/client';
import {
    ensureSession,
    notifyAllAdmins,
    parseIntStrict,
    sendOrderCard,
} from './bot.helpers';
import { handleCreateOrderFlow } from './create-order.flow';

type BotContext = Context & { session: BotSessionData };

@Update()
export class BotUpdate {
    constructor(
        private auth: AuthService,
        private orders: OrdersService
    ) {}

    // ---------- commands ----------
    @Start()
    async start(@Ctx() ctx: BotContext) {
        ensureSession(ctx);

        await ctx.reply(
            '🚗 Tire Service Bot\n\n' +
                '📸 Отправь фото — начнём новый заказ\n' +
                '🔎 /search — поиск по телефону\n' +
                '👨‍🔧 /by_master — фильтр по мастеру\n' +
                '📌 /active <id> — открыть заказ по номеру\n\n' +
                'Доступ: роль ADMIN/MASTER задаётся в Google Sheet (лист Staff).'
        );
    }

    @Command('by_master')
    async byMaster(@Ctx() ctx: BotContext) {
        const staff = (await this.auth.getActiveStaff()).map((s) => ({
            tgId: s.tgId,
            name: s.name || 'Без имени',
        }));

        await ctx.reply('Выберите мастера:', {
            reply_markup: staffKeyboard(staff),
        });
    }

    @Command('active')
    async openOrder(@Ctx() ctx: BotContext) {
        const parts = String((ctx.message as any)?.text || '').split(/\s+/);
        const id = Number(parts[1]);
        if (!id) return ctx.reply('Формат: /active 123');

        const order = await this.orders.getByPublicId(id);
        await sendOrderCard(ctx, order, order.status !== OrderStatus.DONE);
    }

    // ---------- photo: start create flow ----------
    @On('photo')
    async onPhoto(@Ctx() ctx: BotContext) {
        const fileId = (ctx.message as any).photo?.at(-1)?.file_id;
        if (!fileId) return;

        ctx.session = {
            flow: 'create',
            step: 'phone',
            photoFileId: fileId,
            services: [],
            items: [],
        };

        await ctx.reply('📞 Введите телефон клиента:');
    }

    // ---------- services selection ----------
    @Action(/^svc:/)
    async onServiceToggle(@Ctx() ctx: BotContext) {
        const s = ensureSession(ctx);
        if (s.flow !== 'create') return;

        const data = String((ctx.callbackQuery as any).data);
        const arg = data.split(':')[1];

        if (arg === 'done') {
            s.step = 'servicePrice';
            s.pendingService = s.services![0];
            await ctx.answerCbQuery();
            return ctx.reply(
                `💰 Цена за "${SERVICE_LABELS[s.pendingService]}":`
            );
        }

        const service = arg as ServiceType;
        s.services ??= [];
        s.services.includes(service)
            ? (s.services = s.services.filter((x) => x !== service))
            : s.services.push(service);

        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(servicesKeyboard(s.services));
    }

    // ---------- staff selection ----------
    @Action(/^staff:/)
    async onStaffSelect(@Ctx() ctx: BotContext) {
        const s = ensureSession(ctx);
        const data = String((ctx.callbackQuery as any).data);
        const id = data.split(':')[1];

        if (id === 'manual') {
            s.step = 'acceptedByManual';
            await ctx.answerCbQuery();
            return ctx.reply('Введите имя мастера:');
        }

        s.acceptedByTgId = BigInt(id);
        s.step = 'services';

        await ctx.answerCbQuery();
        await ctx.reply('🧾 Выберите услуги:', {
            reply_markup: servicesKeyboard(s.services ?? []),
        });
    }

    // ---------- status change ----------
    @Action(/^st:/)
    async onStatus(@Ctx() ctx: BotContext) {
        const data = String((ctx.callbackQuery as any).data);
        const [, publicIdStr, statusStr] = data.split(':');
        const publicId = Number(publicIdStr);
        const status = statusStr as OrderStatus;

        if (status === OrderStatus.DONE) {
            const s = ensureSession(ctx);
            s.flow = 'finalize';
            s.step = 'finalTotal';
            s.finalizePublicId = publicId;
            return ctx.reply(
                `💵 Введите итоговую сумму для заказа #${publicId}:`
            );
        }

        const updated = await this.orders.changeStatus({
            orderPublicId: publicId,
            byTgId: BigInt(ctx.from!.id),
            status,
        });

        await ctx.answerCbQuery('Ок');
        await sendOrderCard(ctx, updated, true);
    }

    // ---------- text handler ----------
    @On('text')
    async onText(@Ctx() ctx: BotContext) {
        const s = ensureSession(ctx);
        const text = String((ctx.message as any).text || '').trim();

        // ---- finalize flow ----
        if (s.flow === 'finalize') {
            const finalTotal = parseIntStrict(text);
            if (!finalTotal) return ctx.reply('Введите корректную сумму');

            const order = await this.orders.finalizeOrder({
                orderPublicId: s.finalizePublicId!,
                byTgId: BigInt(ctx.from!.id),
                finalTotal,
            });

            const adminIds = await this.auth.getActiveAdminTgIds();
            await notifyAllAdmins(ctx, adminIds, order, true); // с фото

            s.flow = null;
            return sendOrderCard(ctx, order, false);
        }

        // ---- create flow ----
        if (s.flow === 'create') {
            await handleCreateOrderFlow(ctx, this.auth, this.orders);
            return;
        }
    }
}
