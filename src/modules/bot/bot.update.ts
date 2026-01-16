import { Update, Start, Command, On, Ctx, Action } from 'nestjs-telegraf';
import type { Context } from 'telegraf';
import { AuthService } from '../auth/auth.service';
import { OrdersService } from '../orders/orders.service';
import { BotSessionData } from './bot.session';
import { servicesKeyboard, SERVICE_LABELS, statusKeyboard } from './keyboards';
import { OrderStatus, ServiceType } from '@prisma/client';
import {
    ensureSession,
    formatOrderShort,
    isPhoneLike,
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
                '📌 /active <id> — открыть заказ по номеру\n\n' +
                'Доступ: роль ADMIN/MASTER задаётся в Google Sheet (лист Staff).'
        );
    }

    @Command('search')
    async search(@Ctx() ctx: BotContext) {
        const s = ensureSession(ctx);
        s.flow = 'search';
        s.step = 'phonePart';
        await ctx.reply('Введите номер телефона (или часть):');
    }

    @Command('active')
    async openOrder(@Ctx() ctx: BotContext) {
        const tgId = BigInt(ctx.from!.id);
        const allowed =
            (await this.auth.isAdmin(tgId)) || (await this.auth.isMaster(tgId));
        if (!allowed) return;

        const parts = String((ctx.message as any)?.text || '').split(/\s+/);
        const id = Number(parts[1]);
        if (!id) {
            await ctx.reply('Формат: /active 123');
            return;
        }

        const order = await this.orders.getByPublicId(id);
        await sendOrderCard(ctx, order, order.status !== OrderStatus.DONE);
    }

    // ---------- photo: start create flow ----------
    @On('photo')
    async onPhoto(@Ctx() ctx: BotContext) {
        const tgId = BigInt(ctx.from!.id);
        const allowed =
            (await this.auth.isAdmin(tgId)) || (await this.auth.isMaster(tgId));
        if (!allowed) return;

        const fileId = (ctx.message as any).photo?.at(-1)?.file_id as
            | string
            | undefined;
        if (!fileId) return;

        // reset flow
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
            if (!s.services?.length) {
                await ctx.answerCbQuery('Выберите хотя бы одну услугу');
                return;
            }
            s.step = 'servicePrice';
            s.pendingService = s.services[0];
            await ctx.answerCbQuery();
            await ctx.reply(
                `💰 Цена за "${SERVICE_LABELS[s.pendingService]}":`
            );
            return;
        }

        const service = arg as ServiceType;
        s.services ??= [];
        if (s.services.includes(service))
            s.services = s.services.filter((x) => x !== service);
        else s.services.push(service);

        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(servicesKeyboard(s.services));
    }

    // ---------- status change ----------
    @Action(/^st:/)
    async onStatus(@Ctx() ctx: BotContext) {
        const tgId = BigInt(ctx.from!.id);
        const allowed =
            (await this.auth.isAdmin(tgId)) || (await this.auth.isMaster(tgId));
        if (!allowed) return ctx.answerCbQuery();

        const data = String((ctx.callbackQuery as any).data);
        const [, publicIdStr, statusStr] = data.split(':');
        const publicId = Number(publicIdStr);
        const status = statusStr as OrderStatus;

        if (!publicId) return ctx.answerCbQuery();

        if (status === OrderStatus.DONE) {
            const s = ensureSession(ctx);
            s.flow = 'finalize';
            s.step = 'finalTotal';
            s.finalizePublicId = publicId;
            await ctx.answerCbQuery();
            await ctx.reply(
                `💵 Введите итоговую сумму для заказа #${publicId}:`
            );
            return;
        }

        const updated = await this.orders.changeStatus({
            orderPublicId: publicId,
            byTgId: tgId,
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
        const tgId = BigInt(ctx.from!.id);

        const allowed =
            (await this.auth.isAdmin(tgId)) || (await this.auth.isMaster(tgId));
        if (!allowed) {
            // не отвечаем пользователям без прав, чтобы не спамить
            return;
        }

        // ---- search flow ----
        if (s.flow === 'search' && s.step === 'phonePart') {
            s.flow = null;
            s.step = undefined;

            const list = await this.orders.searchByPhone({
                phonePart: text,
                includeDone: false,
                limit: 20,
            });
            if (!list.length) return ctx.reply('Ничего не найдено (Active).');

            for (const o of list) {
                await ctx.reply(formatOrderShort(o), {
                    reply_markup: statusKeyboard(o.publicId),
                });
            }
            return;
        }

        // ---- finalize flow ----
        if (s.flow === 'finalize' && s.step === 'finalTotal') {
            const finalTotal = parseIntStrict(text);
            if (!finalTotal || finalTotal <= 0) {
                await ctx.reply('Введите число > 0');
                return;
            }

            const order = await this.orders.finalizeOrder({
                orderPublicId: s.finalizePublicId!,
                byTgId: tgId,
                finalTotal,
            });
            const adminTgIds = await this.auth.getActiveAdminTgIds();
            await notifyAllAdmins(
                ctx,
                adminTgIds,
                `⚫ Заказ #${order.publicId} выдан. Итог: ${order.finalTotal}`
            );

            ctx.session = { flow: null };
            await sendOrderCard(ctx, order, false);
            return;
        }

        // ---- create flow ----
        if (s.flow === 'create') {
            await handleCreateOrderFlow(ctx, this.auth, this.orders);
            return;
        }
    }
}
