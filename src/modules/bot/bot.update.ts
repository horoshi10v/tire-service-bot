import { Update, Start, Command, On, Ctx, Action } from 'nestjs-telegraf';
import type { Context } from 'telegraf';
import { AuthService } from '../auth/auth.service';
import { OrdersService } from '../orders/orders.service';
import { BotSessionData } from './bot.session';
import {
    servicesKeyboard,
    statusKeyboard,
    SERVICE_LABELS,
    STATUS_LABELS,
} from './keyboards';
import { OrderStatus, ServiceType } from '@prisma/client';

type BotContext = Context & { session: BotSessionData };

function ensureSession(ctx: BotContext) {
    if (!ctx.session) (ctx as any).session = { flow: null };
    if (!ctx.session.services) ctx.session.services = [];
    if (!ctx.session.items) ctx.session.items = [];
    return ctx.session;
}

function isPhoneLike(s: string) {
    const t = s.replace(/[^\d+]/g, '');
    return t.length >= 7;
}

function parseIntStrict(s: string): number | null {
    const n = Number(String(s).trim());
    if (!Number.isFinite(n)) return null;
    return Math.trunc(n);
}

@Update()
export class BotUpdate {
    constructor(
        private auth: AuthService,
        private orders: OrdersService
    ) {}

    // ---------- helpers ----------
    private async notifyAllAdmins(ctx: BotContext, text: string) {
        const adminTgIds = await this.auth.getActiveAdminTgIds();
        await Promise.all(
            adminTgIds.map((id) =>
                ctx.telegram.sendMessage(Number(id), text).catch(() => null)
            )
        );
    }

    private formatOrderShort(order: any) {
        const itemsText = (order.items || [])
            .map(
                (it: any) =>
                    `• ${SERVICE_LABELS[it.service]} — ${it.price}${it.comment ? ` (${it.comment})` : ''}${it.warrantyDays ? `, гарантия ${it.warrantyDays}д` : ''}`
            )
            .join('\n');

        return (
            `#${order.publicId} ${STATUS_LABELS[order.status]}\n` +
            `📞 ${order.clientPhone}\n` +
            `👤 Принял: ${order.acceptedBy?.name || '—'}\n` +
            `🧾 Услуги:\n${itemsText || '—'}\n` +
            `💰 Ориентир: ${order.estimateTotal ?? '—'}\n` +
            `💵 Итог: ${order.finalTotal ?? '—'}`
        );
    }

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
        if (!id) return ctx.reply('Формат: /active 123');

        const order = await this.orders.getByPublicId(id);
        if (order.status === OrderStatus.DONE) {
            await ctx.reply(this.formatOrderShort(order));
        } else {
            await ctx.reply(this.formatOrderShort(order), {
                reply_markup: statusKeyboard(order.publicId),
            });
        }
    }

    // ---------- photo: start create flow ----------
    @On('photo')
    async onPhoto(@Ctx() ctx: BotContext) {
        const s = ensureSession(ctx);
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
        if (s.flow !== 'create') return ctx.answerCbQuery();

        const tgId = BigInt(ctx.from!.id);
        const allowed =
            (await this.auth.isAdmin(tgId)) || (await this.auth.isMaster(tgId));
        if (!allowed) return ctx.answerCbQuery();

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
            return ctx.reply(
                `💰 Цена за "${SERVICE_LABELS[s.pendingService]}":`
            );
        }

        const service = arg as ServiceType;
        s.services ??= [];
        if (s.services.includes(service))
            s.services = s.services.filter((x) => x !== service);
        else s.services.push(service);

        await ctx.answerCbQuery();
        return ctx.editMessageReplyMarkup(servicesKeyboard(s.services));
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
            return ctx.reply(
                `💵 Введите итоговую сумму для заказа #${publicId}:`
            );
        }

        const updated = await this.orders.changeStatus({
            orderPublicId: publicId,
            byTgId: tgId,
            status,
        });

        await ctx.answerCbQuery('Ок');

        if (status === OrderStatus.READY) {
            await this.notifyAllAdmins(ctx, `🟢 Заказ #${publicId} готов`);
        }

        return ctx.reply(this.formatOrderShort(updated), {
            reply_markup: statusKeyboard(publicId),
        });
    }

    // ---------- text handler: steps ----------
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
                await ctx.reply(this.formatOrderShort(o), {
                    reply_markup: statusKeyboard(o.publicId),
                });
            }
            return;
        }

        // ---- finalize flow ----
        if (
            s.flow === 'finalize' &&
            s.step === 'finalTotal' &&
            s.finalizePublicId
        ) {
            const finalTotal = parseIntStrict(text);
            if (!finalTotal || finalTotal <= 0)
                return ctx.reply('Введите число > 0');

            const order = await this.orders.finalizeOrder({
                orderPublicId: s.finalizePublicId,
                byTgId: tgId,
                finalTotal,
            });

            await this.notifyAllAdmins(
                ctx,
                `⚫ Заказ #${order.publicId} выдан. Итог: ${order.finalTotal}`
            );

            // reset
            ctx.session = { flow: null };
            return ctx.reply(this.formatOrderShort(order));
        }

        // ---- create flow ----
        if (s.flow === 'create') {
            if (s.step === 'phone') {
                if (!isPhoneLike(text))
                    return ctx.reply(
                        'Введите корректный номер (минимум 7 цифр)'
                    );
                s.phone = text;
                s.step = 'acceptedByName';
                return ctx.reply('👤 Кто принял заказ? (имя):');
            }

            if (s.step === 'acceptedByName') {
                s.acceptedByName = text;
                s.step = 'services';
                return ctx.reply('🧾 Выберите услуги:', {
                    reply_markup: servicesKeyboard(s.services ?? []),
                });
            }

            // дальше идёт пошаговый ввод позиций по выбранным услугам:
            if (s.step === 'servicePrice' && s.pendingService) {
                const price = parseIntStrict(text);
                if (price === null || price < 0)
                    return ctx.reply('Цена должна быть числом (>= 0)');

                s.items ??= [];
                s.items.push({ service: s.pendingService, price });

                // следующий шаг: комментарий
                s.step = 'serviceComment';
                return ctx.reply(
                    `📝 Комментарий к "${SERVICE_LABELS[s.pendingService]}"? (или "-" чтобы пропустить)`
                );
            }

            if (s.step === 'serviceComment' && s.items?.length) {
                const last = s.items[s.items.length - 1];
                last.comment = text === '-' ? null : text;

                s.step = 'serviceWarranty';
                return ctx.reply(
                    `🛡 Гарантия (дней) для "${SERVICE_LABELS[last.service]}"? (0 или "-" если нет)`
                );
            }

            if (s.step === 'serviceWarranty' && s.items?.length) {
                const last = s.items[s.items.length - 1];
                const wd = text === '-' ? 0 : parseIntStrict(text);
                if (wd === null || wd < 0)
                    return ctx.reply('Введите число дней (>=0) или "-"');

                last.warrantyDays = wd > 0 ? wd : null;

                // берем следующую услугу
                const already = new Set(s.items.map((i) => i.service));
                const next = (s.services ?? []).find((x) => !already.has(x));

                if (next) {
                    s.pendingService = next;
                    s.step = 'servicePrice';
                    return ctx.reply(`💰 Цена за "${SERVICE_LABELS[next]}":`);
                }

                // все услуги пройдены — спрашиваем ориентир (можно авто)
                s.step = 'estimateTotal';
                const sum = s.items.reduce((a, i) => a + (i.price || 0), 0);
                return ctx.reply(
                    `💰 Ориентировочная сумма? (нажми Enter число) или "-" чтобы оставить авто = ${sum}`
                );
            }

            if (s.step === 'estimateTotal') {
                let estimateTotal: number | null = null;
                if (text !== '-') {
                    const n = parseIntStrict(text);
                    if (n === null || n < 0)
                        return ctx.reply('Введите число (>=0) или "-"');
                    estimateTotal = n;
                }

                // ensure acceptedBy exists in DB: мы храним в Order acceptedById (Employee),
                // но здесь у нас только имя. В MVP делаем acceptedBy = createdBy (tgId),
                // а имя сохраняем в Employee.name через Staff sync.
                // Поэтому acceptedByTgId = tgId.
                const created = await this.orders.createOrder({
                    clientPhone: s.phone!,
                    photoFileId: s.photoFileId ?? null,
                    acceptedByTgId: tgId,
                    createdByTgId: tgId,
                    items: (s.items ?? []).map((i) => ({
                        service: i.service,
                        price: i.price,
                        comment: i.comment ?? null,
                        warrantyDays: i.warrantyDays ?? null,
                    })),
                    estimateTotal,
                });

                await this.notifyAllAdmins(
                    ctx,
                    `🆕 Новый заказ #${created.publicId}\n📞 ${created.clientPhone}\n🧾 ${(created.items || []).map((it) => SERVICE_LABELS[it.service]).join(', ')}`
                );

                // reset
                ctx.session = { flow: null };

                return ctx.reply(this.formatOrderShort(created), {
                    reply_markup: statusKeyboard(created.publicId),
                });
            }
        }
    }
}
