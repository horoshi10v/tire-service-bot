import { OrderStatus, ServiceType } from '@prisma/client';
import { OrdersService } from '../orders/orders.service';
import {
    ensureSession,
    isPhoneLike,
    parseIntStrict,
    resetSession,
    sendOrderCard,
} from './bot.helpers';
import {
    SERVICE_LABELS,
    editMenuKeyboard,
    mainMenuKeyboard,
    servicesKeyboard,
} from './keyboards';
import type { BotContext } from './bot.helpers';

export type OrderCardOptions = {
    canEdit?: boolean;
    canDelete?: boolean;
    withStatus?: boolean;
};

export async function startEditMenu(
    ctx: BotContext,
    orders: OrdersService,
    publicId: number
) {
    const order = await orders.getByPublicId(publicId);
    if (order.status === OrderStatus.DONE) {
        await ctx.reply('⚠️ Виконані замовлення редагувати не можна');
        return;
    }

    const s = ensureSession(ctx);
    s.flow = 'edit';
    s.step = 'editChoice';
    s.editPublicId = publicId;

    await ctx.reply('Що змінити у замовленні?', {
        reply_markup: editMenuKeyboard(publicId),
    });
}

export async function handleEditMenuAction(
    ctx: BotContext,
    action: string,
    publicId: number
) {
    const s = ensureSession(ctx);
    s.flow = 'edit';
    s.step = 'editChoice';
    s.editPublicId = publicId;

    if (action === 'cancel') {
        resetSession(ctx);
        await ctx.reply('Скасовано', { reply_markup: mainMenuKeyboard() });
        return;
    }

    if (action === 'phone') {
        s.step = 'editPhone';
        await ctx.reply('Введіть новий номер телефону:');
        return;
    }

    if (action === 'estimate') {
        s.step = 'editEstimate';
        await ctx.reply('Введіть суму або "-" щоб очистити:');
        return;
    }

    if (action === 'email') {
        s.step = 'editEmail';
        await ctx.reply('Введіть email або "-" щоб очистити:');
        return;
    }

    if (action === 'photo') {
        s.step = 'editPhoto';
        await ctx.reply('Надішліть нове фото:');
        return;
    }

    if (action === 'items') {
        s.flow = 'editItems';
        s.step = 'services';
        s.services = [];
        s.items = [];
        s.pendingService = undefined;
        await ctx.reply('🧾 Виберіть послуги:', {
            reply_markup: servicesKeyboard(s.services),
        });
        return;
    }
}

export async function handleEditTextFlow(
    ctx: BotContext,
    orders: OrdersService,
    cardOptions?: OrderCardOptions
): Promise<boolean> {
    const s = ensureSession(ctx);
    const text = String((ctx.message as any)?.text || '').trim();

    if (s.flow === 'edit' && s.step === 'editPhone') {
        if (!isPhoneLike(text)) {
            await ctx.reply('Введіть коректний номер');
            return true;
        }

        try {
            const updated = await orders.updateOrder({
                orderPublicId: s.editPublicId!,
                byTgId: BigInt(ctx.from!.id),
                clientPhone: text,
            });
            resetSession(ctx);
            await ctx.reply('✅ Телефон оновлено', {
                reply_markup: mainMenuKeyboard(),
            });
            await sendOrderCard(
                ctx,
                updated,
                cardOptions ?? { withStatus: updated.status !== OrderStatus.DONE }
            );
        } catch (e: any) {
            if (e?.status === 404 || e?.status === 400) {
                await ctx.reply(`⚠️ ${e.response?.message || 'Помилка'}`);
                return true;
            }
            console.error('edit phone error', e);
            await ctx.reply('🚨 Помилка. Спробуйте пізніше.');
        }
        return true;
    }

    if (s.flow === 'edit' && s.step === 'editEstimate') {
        let estimate: number | null;
        if (text === '-') {
            estimate = null;
        } else {
            const n = parseIntStrict(text);
            if (n === null || n < 0) {
                await ctx.reply('Введіть число або "-"');
                return true;
            }
            estimate = n;
        }

        try {
            const updated = await orders.updateOrder({
                orderPublicId: s.editPublicId!,
                byTgId: BigInt(ctx.from!.id),
                estimateTotal: estimate,
            });
            resetSession(ctx);
            await ctx.reply('✅ Орієнтовну суму оновлено', {
                reply_markup: mainMenuKeyboard(),
            });
            await sendOrderCard(
                ctx,
                updated,
                cardOptions ?? { withStatus: updated.status !== OrderStatus.DONE }
            );
        } catch (e: any) {
            if (e?.status === 404 || e?.status === 400) {
                await ctx.reply(`⚠️ ${e.response?.message || 'Помилка'}`);
                return true;
            }
            console.error('edit estimate error', e);
            await ctx.reply('🚨 Помилка. Спробуйте пізніше.');
        }
        return true;
    }

    if (s.flow === 'edit' && s.step === 'editEmail') {
        let email: string | null;
        if (text === '-') {
            email = null;
        } else {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
                await ctx.reply('Введіть коректний email або "-"');
                return true;
            }
            email = text;
        }

        try {
            const updated = await orders.updateOrder({
                orderPublicId: s.editPublicId!,
                byTgId: BigInt(ctx.from!.id),
                clientEmail: email,
            });
            resetSession(ctx);
            await ctx.reply('✅ Email оновлено', {
                reply_markup: mainMenuKeyboard(),
            });
            await sendOrderCard(
                ctx,
                updated,
                cardOptions ?? { withStatus: updated.status !== OrderStatus.DONE }
            );
        } catch (e: any) {
            if (e?.status === 404 || e?.status === 400) {
                await ctx.reply(`⚠️ ${e.response?.message || 'Помилка'}`);
                return true;
            }
            console.error('edit email error', e);
            await ctx.reply('🚨 Помилка. Спробуйте пізніше.');
        }
        return true;
    }

    if (s.flow === 'editItems') {
        return handleEditItemsFlow(ctx, orders, cardOptions);
    }

    return false;
}

export async function handleEditPhoto(
    ctx: BotContext,
    orders: OrdersService,
    fileId: string,
    cardOptions?: OrderCardOptions
): Promise<boolean> {
    const s = ensureSession(ctx);
    if (s.flow !== 'edit' || s.step !== 'editPhoto') return false;

    try {
        const updated = await orders.updateOrder({
            orderPublicId: s.editPublicId!,
            byTgId: BigInt(ctx.from!.id),
            photoFileId: fileId,
        });

        resetSession(ctx);
        await ctx.reply('✅ Фото оновлено', {
            reply_markup: mainMenuKeyboard(),
        });
        await sendOrderCard(
            ctx,
            updated,
            cardOptions ?? { withStatus: updated.status !== OrderStatus.DONE }
        );
    } catch (e: any) {
        if (e?.status === 404 || e?.status === 400) {
            await ctx.reply(`⚠️ ${e.response?.message || 'Помилка'}`);
            return true;
        }
        console.error('edit photo error', e);
        await ctx.reply('🚨 Помилка. Спробуйте пізніше.');
    }
    return true;
}

async function handleEditItemsFlow(
    ctx: BotContext,
    orders: OrdersService,
    cardOptions?: OrderCardOptions
): Promise<boolean> {
    const s = ensureSession(ctx);
    const text = String((ctx.message as any)?.text || '').trim();

    if (s.step === 'servicePrice' && s.pendingService) {
        const price = parseIntStrict(text);
        if (price === null || price < 0) {
            await ctx.reply('Ціна має бути числом (>= 0)');
            return true;
        }

        s.items.push({ service: s.pendingService, price });
        s.step = 'serviceComment';

        await ctx.reply(
            `📝 Коментар до "${SERVICE_LABELS[s.pendingService]}"? (або "-")`
        );
        return true;
    }

    if (s.step === 'serviceComment') {
        const last = s.items.at(-1)!;
        last.comment = text === '-' ? null : text;
        s.step = 'serviceWarranty';

        await ctx.reply(
            `🛡 Гарантія (днів) для "${SERVICE_LABELS[last.service]}"? (0 або "-")`
        );
        return true;
    }

    if (s.step === 'serviceWarranty') {
        const last = s.items.at(-1)!;
        const wd = text === '-' ? 0 : parseIntStrict(text);
        if (wd === null || wd < 0) {
            await ctx.reply('Введіть кількість днів або "-"');
            return true;
        }

        last.warrantyDays = wd || null;

        const next = s.services.find(
            (x: ServiceType) =>
                !(s.items?.some((i) => i.service === x) ?? false)
        );

        if (next) {
            s.pendingService = next;
            s.step = 'servicePrice';
            await ctx.reply(`💰 Ціна за "${SERVICE_LABELS[next]}":`);
            return true;
        }

        const sum = s.items.reduce((a, i) => a + i.price, 0);
        s.step = 'estimateTotal';

        await ctx.reply(`💰 Орієнтовна сума? (число або "-" = ${sum})`);
        return true;
    }

    if (s.step === 'estimateTotal') {
        let estimate: number | null = null;
        if (text !== '-') {
            const n = parseIntStrict(text);
            if (n === null || n < 0) {
                await ctx.reply('Введіть число або "-"');
                return true;
            }
            estimate = n;
        }

        try {
            const updated = await orders.replaceItems({
                orderPublicId: s.editPublicId!,
                byTgId: BigInt(ctx.from!.id),
                items: s.items.map((i) => ({
                    service: i.service,
                    price: i.price,
                    comment: i.comment ?? null,
                    warrantyDays: i.warrantyDays ?? null,
                })),
                estimateTotal: estimate ?? undefined,
            });

            resetSession(ctx);
            await ctx.reply('✅ Послуги оновлено', {
                reply_markup: mainMenuKeyboard(),
            });
            await sendOrderCard(
                ctx,
                updated,
                cardOptions ?? { withStatus: updated.status !== OrderStatus.DONE }
            );
        } catch (e: any) {
            if (e?.status === 404 || e?.status === 400) {
                await ctx.reply(`⚠️ ${e.response?.message || 'Помилка'}`);
                return true;
            }
            console.error('edit items error', e);
            await ctx.reply('🚨 Помилка. Спробуйте пізніше.');
        }
        return true;
    }

    return false;
}
