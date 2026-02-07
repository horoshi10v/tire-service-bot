import {
    Update,
    Start,
    Command,
    On,
    Ctx,
    Action,
    Hears,
} from 'nestjs-telegraf';
import { UseGuards } from '@nestjs/common';
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
import { Roles, UserRole } from '../../common/guards';
import { RolesGuard } from '../../common/guards';
import { WarrantyVerificationService } from '../warranty';
import { WarrantyVerificationHandler } from './handlers';
import { SheetsService } from '../integrations/sheets/sheets.service';

type BotContext = Context & { session: BotSessionData };

const PAGE_SIZE = 10;

@Update()
@UseGuards(RolesGuard)
export class BotUpdate {
    constructor(
        private auth: AuthService,
        private orders: OrdersService,
        private warranty: WarrantyVerificationService,
        private warrantyHandler: WarrantyVerificationHandler,
        private sheets: SheetsService
    ) {}

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

        const text = String((ctx.message as any)?.text || '');

        // Check if this is a warranty verification command
        const verificationData = this.warranty.parseVerificationCommand(text);
        if (verificationData) {
            return this.warrantyHandler.handle(ctx, verificationData);
        }

        // Regular start command - check user role
        const tgId = BigInt(ctx.from!.id);
        const isEmployee = await this.auth.isActiveEmployee(tgId);

        if (isEmployee) {
            return this.startEmployee(ctx);
        } else {
            return this.startRegularUser(ctx);
        }
    }

    private async startEmployee(@Ctx() ctx: BotContext) {
        await ctx.reply('🔄 Оновлюю меню…', {
            reply_markup: { remove_keyboard: true },
        });

        await ctx.reply(
            '🚗 Бот шиномонтажу\n\n' +
                '📸 Надішліть фото — створити замовлення\n' +
                '🔎 /search — пошук за телефоном\n' +
                '📌 /active <id> — відкрити замовлення\n\n' +
                'Або скористайтеся меню нижче 👇',
            { reply_markup: mainMenuKeyboard() }
        );
    }

    private async startRegularUser(@Ctx() ctx: BotContext) {
        await ctx.reply(
            '👋 Вітаємо у боті шиномонтажу!\n\n' +
                '🔍 Для перевірки гарантії відскануйте QR-код з вашого гарантійного талона.\n\n' +
                '📋 Для перевірки статусу замовлення використовуйте меню нижче 👇',
            {
                reply_markup: {
                    resize_keyboard: true,
                    one_time_keyboard: false,
                    is_persistent: true,
                    keyboard: [['📋 Статус замовлення']],
                },
            }
        );
    }

    // ---------- commands ----------
    @Command('active')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    async openOrder(@Ctx() ctx: BotContext) {
        try {
            const parts = String((ctx.message as any)?.text || '').split(/\s+/);
            const id = Number(parts[1]);
            if (!id) {
                await ctx.reply('Формат: /active 123');
                return;
            }

            const order = await this.orders.getByPublicId(id);
            await sendOrderCard(ctx, order, order.status !== OrderStatus.DONE);
        } catch (e: any) {
            if (e?.status === 404) {
                await ctx.reply('❌ Замовлення з таким номером не знайдено');
                return;
            }
            console.error('openOrder error', e);
            await ctx.reply('🚨 Помилка. Спробуйте пізніше.');
        }
    }

    @Command('search')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    async search(@Ctx() ctx: BotContext) {
        const s = ensureSession(ctx);
        s.flow = 'search';
        s.step = 'phonePart';
        await ctx.reply('Введіть номер телефону (або частину):');
    }

    @Command('backup')
    @Roles(UserRole.ADMIN)
    async backup(@Ctx() ctx: BotContext) {
        await ctx.reply('⏳ Створюю бекап у вкладці Backup…');
        try {
            const res = await this.sheets.backupAllOrdersToSheet();
            await ctx.reply(
                `✅ Бекап готовий.\nЗамовлень: ${res.orders}\nПослуг: ${res.items}`
            );
        } catch (e) {
            console.error('backup error', e);
            await ctx.reply('🚨 Помилка бекапу. Спробуйте пізніше.');
        }
    }

    @Command('sync_staff')
    @Roles(UserRole.ADMIN)
    async syncStaff(@Ctx() ctx: BotContext) {
        await ctx.reply('⏳ Синхронізую Staff…');
        try {
            const res = await this.sheets.syncStaffToDb();
            await ctx.reply(
                `✅ Staff синхронізовано.\nОновлено: ${res.upserted}\nДеактивовано: ${res.deactivated}`
            );
        } catch (e) {
            console.error('sync_staff error', e);
            await ctx.reply('🚨 Помилка синхронізації Staff. Спробуйте пізніше.');
        }
    }

    @Command('restore')
    @Roles(UserRole.ADMIN)
    async restore(@Ctx() ctx: BotContext) {
        const text = String((ctx.message as any)?.text || '');
        const parts = text.split(/\s+/).map((p) => p.trim());
        const confirmed = parts.includes('CONFIRM');

        if (!confirmed) {
            await ctx.reply(
                '⚠️ Відновлення перезапише замовлення з вкладки Backup (upsert по publicId).\n' +
                    'Щоб підтвердити, виконайте:\n' +
                    '/restore CONFIRM'
            );
            return;
        }

        await ctx.reply('⏳ Відновлюю замовлення з вкладки Backup…');
        try {
            const res = await this.sheets.restoreOrdersFromBackup();
            await ctx.reply(
                `✅ Відновлення завершено.\nВідновлено: ${res.restored}\nПропущено: ${res.skipped}\nПослуг: ${res.items}`
            );
        } catch (e) {
            console.error('restore error', e);
            await ctx.reply('🚨 Помилка відновлення. Спробуйте пізніше.');
        }
    }

    // ===== USER MENU HANDLERS =====

    @Hears('📋 Статус замовлення')
    async checkOrderStatus(@Ctx() ctx: BotContext) {
        const s = ensureSession(ctx);
        s.flow = 'checkStatus';
        s.step = 'waitingForOrderId';
        await ctx.reply('📋 Введіть номер замовлення, наприклад: 1234');
    }

    // ---------- bottom menu hears ----------
    @Hears('🟡 Прийняті')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    async listAccepted(@Ctx() ctx: BotContext) {
        await this.showStatusList(ctx, OrderStatus.ACCEPTED, 1);
    }

    @Hears('🔵 В роботі')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    async listInProgress(@Ctx() ctx: BotContext) {
        await this.showStatusList(ctx, OrderStatus.IN_PROGRESS, 1);
    }

    @Hears('🟢 Готові')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    async listReady(@Ctx() ctx: BotContext) {
        await this.showStatusList(ctx, OrderStatus.READY, 1);
    }

    @Hears('⚫ Видані')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    async listDone(@Ctx() ctx: BotContext) {
        await this.showStatusList(ctx, OrderStatus.DONE, 1);
    }

    @Hears('🆕 Новий')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    async hintNew(@Ctx() ctx: BotContext) {
        await ctx.reply(
            'Надішліть фото колеса/замовлення 📸 — почнемо створення.'
        );
    }

    @Hears('🔍 Пошук')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    async hintSearch(@Ctx() ctx: BotContext) {
        const s = ensureSession(ctx);
        s.flow = 'search';
        s.step = 'phonePart';
        await ctx.reply('Введіть номер телефону (або частину):');
    }

    @Hears('📌 Відкрити замовлення')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    async openOrderHint(@Ctx() ctx: BotContext) {
        const s = ensureSession(ctx);
        s.flow = null;
        s.step = 'openPublicId';
        await ctx.reply('Введіть номер замовлення, наприклад: 1234');
    }

    @Hears('📊 Сводка')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    async summary(@Ctx() ctx: BotContext) {
        const stats = await this.orders.countByStatus();

        await ctx.reply(
            `📊 Зведення замовлень:\n\n` +
                `🟡 Прийняті: ${stats.ACCEPTED}\n` +
                `🔵 В роботі: ${stats.IN_PROGRESS}\n` +
                `🟢 Готові: ${stats.READY}\n` +
                `⚫ Видані: ${stats.DONE}`
        );
    }

    // ---------- photo: start create flow ----------
    @On('photo')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    async onPhoto(@Ctx() ctx: BotContext) {
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

        await ctx.reply('📞 Введіть телефон клієнта:');
    }

    // ---------- pagination ----------
    @Action(/^page:/)
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    async onPage(@Ctx() ctx: BotContext) {
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
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    async openFromList(@Ctx() ctx: BotContext) {
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
                await ctx.reply('❌ Замовлення не знайдено');
                return;
            }
            console.error('openFromList error', e);
            await ctx.reply('🚨 Помилка. Спробуйте пізніше.');
        }
    }

    // ---------- services selection ----------
    @Action(/^svc:/)
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    async onServiceToggle(@Ctx() ctx: BotContext) {
        const s = ensureSession(ctx);
        if (s.flow !== 'create') return;

        const data = String((ctx.callbackQuery as any).data);
        const arg = data.split(':')[1];

        if (arg === 'done') {
            if (!s.services?.length) {
                await ctx.answerCbQuery('Виберіть хоча б одну послугу');
                return;
            }
            s.step = 'servicePrice';
            s.pendingService = s.services[0];
            await ctx.answerCbQuery();
            await ctx.reply(
                `💰 Ціна за "${SERVICE_LABELS[s.pendingService]}":`
            );
            return;
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
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    async onStaffSelect(@Ctx() ctx: BotContext) {
        const s = ensureSession(ctx);
        if (s.flow !== 'create') return;

        const data = String((ctx.callbackQuery as any).data);
        const id = data.split(':')[1];

        if (id === 'manual') {
            s.step = 'acceptedByManual';
            await ctx.answerCbQuery();
            await ctx.reply("Введіть ім'я майстра:");
            return;
        }

        s.acceptedByTgId = BigInt(id);
        s.step = 'services';

        await ctx.answerCbQuery();
        await ctx.reply('🧾 Виберіть послуги:', {
            reply_markup: servicesKeyboard(s.services ?? []),
        });
    }

    // ---------- status change ----------
    @Action(/^st:/)
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    async onStatus(@Ctx() ctx: BotContext) {
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
                await ctx.reply(
                    `💵 Введіть підсумкову суму для замовлення #${publicId}:`
                );
                return;
            }

            const updated = await this.orders.changeStatus({
                orderPublicId: publicId,
                byTgId: BigInt(ctx.from!.id),
                status,
            });

            if (!updated) {
                await ctx.answerCbQuery();
                await ctx.reply('❌ Замовлення не знайдено');
                return;
            }

            await ctx.answerCbQuery('Ок');
            await sendOrderCard(ctx, updated, true);

            const adminIds = await this.auth.getActiveAdminTgIds();
            await notifyAllAdmins(
                ctx,
                adminIds,
                updated,
                `🔔 Статус змінено: #${updated.publicId}`
            );
        } catch (e: any) {
            await ctx.answerCbQuery();

            if (e?.status === 400) {
                await ctx.reply(
                    `⚠️ Неможливо змінити статус:\n${e.response?.message}`
                );
                return;
            }

            if (e?.status === 404) {
                await ctx.reply('❌ Замовлення не знайдено');
                return;
            }

            console.error('Status change error', e);
            await ctx.reply('🚨 Внутрішня помилка. Спробуйте пізніше.');
        }
    }

    // ---------- text handler ----------
    @On('text')
    async onText(@Ctx() ctx: BotContext) {
        const s = ensureSession(ctx);
        const text = String((ctx.message as any).text || '').trim();

        // Check if user wants to check order status (for regular users)
        if (s.flow === 'checkStatus' && s.step === 'waitingForOrderId') {
            const publicId = Number(text);

            if (!publicId) {
                await ctx.reply(
                    '❌ Введіть коректний номер замовлення (число)'
                );
                return;
            }

            try {
                const status = await this.warranty.getOrderStatus(publicId);

                const statusEmoji: Record<string, string> = {
                    ACCEPTED: '🟡',
                    IN_PROGRESS: '🔵',
                    READY: '🟢',
                    DONE: '⚫',
                };

                const statusNames: Record<string, string> = {
                    ACCEPTED: 'Прийнято',
                    IN_PROGRESS: 'В роботі',
                    READY: 'Готово',
                    DONE: 'Видано',
                };

                let message = `📋 Замовлення #${status.orderId}\n\n`;
                message += `${statusEmoji[status.status] || '❓'} Статус: ${statusNames[status.status] || status.status}\n`;
                message += `💰 Орієнтовно: ${status.estimatedTotal || '—'} грн\n`;
                message += `🔧 Послуг: ${status.servicesCount}\n`;

                if (status.finalTotal) {
                    message += `💵 Разом до сплати: ${status.finalTotal} грн\n`;
                }

                if (status.completedAt) {
                    message += `✅ Завершено: ${status.completedAt.toLocaleDateString('uk-UA')}\n`;
                }

                s.flow = null;
                s.step = undefined;

                await ctx.reply(message);
            } catch (error: any) {
                s.flow = null;
                s.step = undefined;

                if (error.status === 404) {
                    await ctx.reply('❌ Замовлення не знайдено');
                } else {
                    await ctx.reply('🚨 Помилка при перевірці статусу');
                }
            }
            return;
        }

        // Check if user is employee for other flows
        const tgId = BigInt(ctx.from!.id);
        const isEmployee = await this.auth.isActiveEmployee(tgId);

        if (!isEmployee) {
            // Regular users can only check status, nothing else
            return;
        }

        // Employee-only flows below this point

        // 1) обработка "📌 Відкрити замовлення" (ввод id)
        if (s.step === 'openPublicId') {
            s.step = undefined;

            const id = Number(text);
            if (!id) {
                await ctx.reply('Введіть число, наприклад: 1234');
                return;
            }

            try {
                const order = await this.orders.getByPublicId(id);
                await sendOrderCard(
                    ctx,
                    order,
                    order.status !== OrderStatus.DONE
                );
            } catch (e: any) {
                if (e?.status === 404) {
                    await ctx.reply(
                        '❌ Замовлення з таким номером не знайдено'
                    );
                    return;
                }
                console.error('openPublicId error', e);
                await ctx.reply('🚨 Помилка. Спробуйте пізніше.');
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

                if (!list.length) {
                    await ctx.reply('Нічого не знайдено.');
                    return;
                }

                for (const o of list) {
                    await sendOrderCard(ctx, o, o.status !== OrderStatus.DONE);
                }
            } catch (e: any) {
                console.error('Search error', e);
                await ctx.reply('🚨 Помилка пошуку');
            }
            return;
        }

        // 3) finalize flow
        if (s.flow === 'finalize') {
            // Шаг 1 — ввод суммы
            if (s.step === 'finalTotal') {
                const finalTotal = parseIntStrict(text);
                if (!finalTotal || finalTotal <= 0) {
                    await ctx.reply('Введіть коректну суму');
                    return;
                }

                s.finalTotal = finalTotal;
                s.step = 'clientEmail';
                await ctx.reply(
                    '📧 Введіть email клієнта для відправки гарантійного талона (або "-" якщо без email):'
                );
                return;
            }

            // Шаг 2 — ввод email
            if (s.step === 'clientEmail') {
                let email: string | null = null;

                if (text !== '-') {
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
                        await ctx.reply('Введіть коректний email або "-"');
                        return;
                    }
                    email = text;
                }

                try {
                    const result = await this.orders.finalizeOrder({
                        orderPublicId: s.finalizePublicId!,
                        byTgId: BigInt(ctx.from!.id),
                        finalTotal: s.finalTotal!,
                        clientEmail: email,
                    });

                    // Деструктурируем результат
                    const order = result.order as any;
                    const pdfBuffer = result.pdfBuffer;

                    // Отправляем гарантийный талон в Telegram чат
                    await ctx.replyWithDocument(
                        {
                            source: pdfBuffer,
                            filename: `warranty-${order.publicId}.pdf`,
                        },
                        {
                            caption: `📄 Гарантійний талон #${order.publicId}\n\n${order.clientEmail ? `📧 Відправлено на: ${order.clientEmail}` : '✅ Збережено в чернетках пошти'}`,
                        }
                    );

                    const adminIds = await this.auth.getActiveAdminTgIds();
                    await notifyAllAdmins(
                        ctx,
                        adminIds,
                        order,
                        `⚫ Замовлення видано: #${order.publicId}`
                    );

                    s.flow = null;
                    s.step = undefined;
                    s.clientEmail = undefined;

                    await sendOrderCard(ctx, order, false);
                } catch (e) {
                    console.error('finalize error', e);
                    await ctx.reply('🚨 Помилка при видачі замовлення');
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
