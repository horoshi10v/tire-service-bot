import {
    Update,
    Start,
    Command,
    On,
    Ctx,
    Action,
    Hears,
} from 'nestjs-telegraf';
import type { Context } from 'telegraf';
import { AuthService } from '../auth/auth.service';
import { OrdersService } from '../orders/orders.service';
import { BotSessionData } from './bot.session';
import {
    servicesKeyboard,
    SERVICE_LABELS,
    mainMenuKeyboard,
} from './keyboards';
import { OrderStatus, ServiceType } from '@prisma/client';
import {
    ensureSession,
    parseIntStrict,
    sendOrderCard,
    notifyAllAdmins,
} from './bot.helpers';
import { handleCreateOrderFlow } from './create-order.flow';
import { ordersListKeyboard, statusListTitle } from './orders.gallery';

type BotContext = Context & { session: BotSessionData };

const PAGE_SIZE = 10;

@Update()
export class BotUpdate {
    constructor(
        private auth: AuthService,
        private orders: OrdersService
    ) {}

    private async requireAllowed(ctx: BotContext): Promise<boolean> {
        const tgId = BigInt(ctx.from!.id);
        return (
            (await this.auth.isAdmin(tgId)) || (await this.auth.isMaster(tgId))
        );
    }

    private async showStatusList(
        ctx: BotContext,
        status: OrderStatus,
        page: number
    ) {
        const list = await this.orders.listByStatus({
            status,
            page,
            pageSize: PAGE_SIZE,
        });

        const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));

        await ctx.reply(statusListTitle(status), {
            reply_markup: ordersListKeyboard(
                list.items,
                status,
                page,
                totalPages
            ),
        });
    }

    // ---------- start ----------
    @Start()
    async start(@Ctx() ctx: BotContext) {
        ensureSession(ctx);
        if (!(await this.requireAllowed(ctx))) return;

        // обновляем меню (убираем возможные старые кнопки)
        await ctx.reply('🔄 Обновляю меню…', {
            reply_markup: { remove_keyboard: true },
        });

        await ctx.reply(
            '🚗 Tire Service Bot\n\n' +
                '📸 Отправь фото — начнём новый заказ\n' +
                '🔎 /search — поиск по телефону\n' +
                '📌 /active <id> — открыть заказ\n\n' +
                'Или используй меню ниже 👇',
            { reply_markup: mainMenuKeyboard() }
        );
    }

    // ---------- commands ----------
    @Command('active')
    async openOrder(@Ctx() ctx: BotContext) {
        if (!(await this.requireAllowed(ctx))) return;

        try {
            const parts = String((ctx.message as any)?.text || '').split(/\s+/);
            const id = Number(parts[1]);
            if (!id) return ctx.reply('Формат: /active 123');

            const order = await this.orders.getByPublicId(id);
            await sendOrderCard(ctx, order, order.status !== OrderStatus.DONE);
        } catch (e: any) {
            if (e?.status === 404) {
                await ctx.reply('❌ Заказ с таким номером не найден');
                return;
            }
            console.error('openOrder error', e);
            await ctx.reply('🚨 Ошибка. Попробуйте позже.');
        }
    }

    @Command('search')
    async search(@Ctx() ctx: BotContext) {
        if (!(await this.requireAllowed(ctx))) return;
        const s = ensureSession(ctx);
        s.flow = 'search';
        s.step = 'phonePart';
        await ctx.reply('Введите номер телефона (или часть):');
    }

    // ---------- bottom menu hears ----------
    @Hears('🟡 Принятые')
    async listAccepted(@Ctx() ctx: BotContext) {
        if (!(await this.requireAllowed(ctx))) return;
        await this.showStatusList(ctx, OrderStatus.ACCEPTED, 1);
    }

    @Hears('🔵 В работе')
    async listInProgress(@Ctx() ctx: BotContext) {
        if (!(await this.requireAllowed(ctx))) return;
        await this.showStatusList(ctx, OrderStatus.IN_PROGRESS, 1);
    }

    @Hears('🟢 Готовые')
    async listReady(@Ctx() ctx: BotContext) {
        if (!(await this.requireAllowed(ctx))) return;
        await this.showStatusList(ctx, OrderStatus.READY, 1);
    }

    @Hears('⚫ Выданные')
    async listDone(@Ctx() ctx: BotContext) {
        if (!(await this.requireAllowed(ctx))) return;
        await this.showStatusList(ctx, OrderStatus.DONE, 1);
    }

    @Hears('🆕 Новый')
    async hintNew(@Ctx() ctx: BotContext) {
        if (!(await this.requireAllowed(ctx))) return;
        await ctx.reply('Отправь фото колеса/заказа 📸 — начнём создание.');
    }

    @Hears('🔍 Поиск')
    async hintSearch(@Ctx() ctx: BotContext) {
        if (!(await this.requireAllowed(ctx))) return;
        const s = ensureSession(ctx);
        s.flow = 'search';
        s.step = 'phonePart';
        await ctx.reply('Введите номер телефона (или часть):');
    }

    // ✅ Теперь это реально работает: ожидаем ввод id в следующем сообщении
    @Hears('📌 Открыть заказ')
    async openOrderHint(@Ctx() ctx: BotContext) {
        if (!(await this.requireAllowed(ctx))) return;
        const s = ensureSession(ctx);
        s.flow = null;
        s.step = 'openPublicId';
        await ctx.reply('Введите номер заказа, например: 1234');
    }

    @Hears('📊 Сводка')
    async summary(@Ctx() ctx: BotContext) {
        const stats = await this.orders.countByStatus();

        await ctx.reply(
            `📊 Сводка заказов:\n\n` +
                `🟡 Принятые: ${stats.ACCEPTED}\n` +
                `🔵 В работе: ${stats.IN_PROGRESS}\n` +
                `🟢 Готовые: ${stats.READY}\n` +
                `⚫ Выданные: ${stats.DONE}`
        );
    }

    // ---------- photo: start create flow ----------
    @On('photo')
    async onPhoto(@Ctx() ctx: BotContext) {
        if (!(await this.requireAllowed(ctx))) return;

        const fileId = (ctx.message as any).photo?.at(-1)?.file_id as
            | string
            | undefined;
        if (!fileId) return;

        ctx.session = ensureSession(ctx);
        ctx.session.flow = 'create';
        ctx.session.step = 'phone';
        ctx.session.photoFileId = fileId;
        ctx.session.phone = undefined;
        ctx.session.acceptedByName = undefined;
        ctx.session.acceptedByTgId = undefined;
        ctx.session.services = [];
        ctx.session.items = [];
        ctx.session.pendingService = undefined;

        await ctx.reply('📞 Введите телефон клиента:');
    }

    // ---------- pagination ----------
    @Action(/^page:/)
    async onPage(@Ctx() ctx: BotContext) {
        if (!(await this.requireAllowed(ctx))) return ctx.answerCbQuery();

        const data = String((ctx.callbackQuery as any).data);
        const [, statusStr, pageStr] = data.split(':');
        const status = statusStr as OrderStatus;
        const page = Number(pageStr) || 1;

        await ctx.answerCbQuery();
        await this.showStatusList(ctx, status, page);
    }

    @Action(/^noop:/)
    async noop(@Ctx() ctx: BotContext) {
        await ctx.answerCbQuery();
    }

    // ---------- open order from list ----------
    @Action(/^open:/)
    async openFromList(@Ctx() ctx: BotContext) {
        if (!(await this.requireAllowed(ctx))) return ctx.answerCbQuery();

        try {
            const data = String((ctx.callbackQuery as any).data);
            const id = Number(data.split(':')[1]);
            if (!id) return ctx.answerCbQuery();

            const order = await this.orders.getByPublicId(id);
            await ctx.answerCbQuery();
            await sendOrderCard(ctx, order, order.status !== OrderStatus.DONE);
        } catch (e: any) {
            await ctx.answerCbQuery();
            if (e?.status === 404) {
                await ctx.reply('❌ Заказ не найден');
                return;
            }
            console.error('openFromList error', e);
            await ctx.reply('🚨 Ошибка. Попробуйте позже.');
        }
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
            return ctx.reply(
                `💰 Цена за "${SERVICE_LABELS[s.pendingService]}":`
            );
        }

        const service = arg as ServiceType;

        if (s.services.includes(service)) {
            s.services = s.services.filter((x) => x !== service);
        } else {
            s.services.push(service);
        }

        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(servicesKeyboard(s.services));
    }

    // ---------- staff selection ----------
    @Action(/^staff:/)
    async onStaffSelect(@Ctx() ctx: BotContext) {
        const s = ensureSession(ctx);
        if (s.flow !== 'create') return;

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
        if (!(await this.requireAllowed(ctx))) return ctx.answerCbQuery();

        const data = String((ctx.callbackQuery as any).data);
        const [, publicIdStr, statusStr] = data.split(':');
        const publicId = Number(publicIdStr);
        const status = statusStr as OrderStatus;

        if (!publicId) return ctx.answerCbQuery();

        try {
            // DONE — через finalize
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
                byTgId: BigInt(ctx.from!.id),
                status,
            });

            if (!updated) {
                await ctx.answerCbQuery();
                await ctx.reply('❌ Заказ не найден');
                return;
            }

            await ctx.answerCbQuery('Ок');
            await sendOrderCard(ctx, updated, true);

            const adminIds = await this.auth.getActiveAdminTgIds();
            await notifyAllAdmins(
                ctx,
                adminIds,
                updated,
                `🔔 Статус изменён: #${updated.publicId}`
            );
        } catch (e: any) {
            await ctx.answerCbQuery();

            if (e?.status === 400) {
                await ctx.reply(
                    `⚠️ Нельзя сменить статус:\n${e.response?.message}`
                );
                return;
            }

            if (e?.status === 404) {
                await ctx.reply('❌ Заказ не найден');
                return;
            }

            console.error('Status change error', e);
            await ctx.reply('🚨 Внутренняя ошибка. Попробуйте позже.');
        }
    }

    // ---------- text handler ----------
    @On('text')
    async onText(@Ctx() ctx: BotContext) {
        const s = ensureSession(ctx);
        const text = String((ctx.message as any).text || '').trim();

        if (!(await this.requireAllowed(ctx))) return;

        // 1) обработка "📌 Открыть заказ" (ввод id)
        if (s.step === 'openPublicId') {
            s.step = undefined;

            const id = Number(text);
            if (!id) return ctx.reply('Введите число, например: 1234');

            try {
                const order = await this.orders.getByPublicId(id);
                await sendOrderCard(
                    ctx,
                    order,
                    order.status !== OrderStatus.DONE
                );
            } catch (e: any) {
                if (e?.status === 404) {
                    await ctx.reply('❌ Заказ с таким номером не найден');
                    return;
                }
                console.error('openPublicId error', e);
                await ctx.reply('🚨 Ошибка. Попробуйте позже.');
            }
            return;
        }

        // 2) search flow
        if (s.flow === 'search' && s.step === 'phonePart') {
            try {
                s.flow = null;
                s.step = undefined;

                const list = await this.orders.searchByPhone({
                    phonePart: text,
                    includeDone: true,
                    limit: 20,
                });

                if (!list.length) return ctx.reply('Ничего не найдено.');

                for (const o of list) {
                    await sendOrderCard(ctx, o, o.status !== OrderStatus.DONE);
                }
            } catch (e: any) {
                console.error('Search error', e);
                await ctx.reply('🚨 Ошибка поиска');
            }
            return;
        }

        // 3) finalize flow
        if (s.flow === 'finalize') {
            // Шаг 1 — ввод суммы
            if (s.step === 'finalTotal') {
                const finalTotal = parseIntStrict(text);
                if (!finalTotal || finalTotal <= 0) {
                    return ctx.reply('Введите корректную сумму');
                }

                s.finalTotal = finalTotal;
                s.step = 'clientEmail';
                return ctx.reply(
                    '📧 Введите email клиента для отправки гарантийного талона (или "-" если без email):'
                );
            }

            // Шаг 2 — ввод email
            if (s.step === 'clientEmail') {
                let email: string | null = null;

                if (text !== '-') {
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
                        return ctx.reply('Введите корректный email или "-"');
                    }
                    email = text;
                }

                try {
                    const order = await this.orders.finalizeOrder({
                        orderPublicId: s.finalizePublicId!,
                        byTgId: BigInt(ctx.from!.id),
                        finalTotal: s.finalTotal!,
                        clientEmail: email,
                    });

                    const adminIds = await this.auth.getActiveAdminTgIds();
                    await notifyAllAdmins(
                        ctx,
                        adminIds,
                        order,
                        `⚫ Заказ выдан: #${order.publicId}`
                    );

                    s.flow = null;
                    s.step = undefined;
                    s.clientEmail = undefined;

                    await sendOrderCard(ctx, order, false);
                } catch (e) {
                    console.error('finalize error', e);
                    await ctx.reply('🚨 Ошибка при выдаче заказа');
                }
                return;
            }
        }

        // 4) create flow
        if (s.flow === 'create') {
            await handleCreateOrderFlow(ctx, this.auth, this.orders);
            return;
        }
    }
}
