import { OrdersService } from '../orders/orders.service';
import { AuthService } from '../auth/auth.service';
import { ServiceType } from '@prisma/client';
import { servicesKeyboard, SERVICE_LABELS, staffKeyboard } from './keyboards';
import {
    BotContext,
    isPhoneLike,
    notifyAllAdmins,
    parseIntStrict,
    sendOrderCard,
} from './bot.helpers';
import { DEFAULT_SESSION } from './bot.session';

export async function handleCreateOrderFlow(
    ctx: BotContext,
    auth: AuthService,
    orders: OrdersService
) {
    const s = ctx.session;
    const text = String((ctx.message as any)?.text || '').trim();
    const tgId = BigInt(ctx.from!.id);

    // гарантируем массивы
    s.items ??= [];
    s.services ??= [];

    if (s.step === 'phone') {
        if (!isPhoneLike(text)) {
            await ctx.reply('Введите корректный номер (минимум 7 цифр)');
            return;
        }
        s.phone = text;
        s.step = 'acceptedBySelect';

        const staff = (await auth.getActiveStaff()).map((s) => ({
            tgId: s.tgId,
            name: s.name || 'Без имени',
        }));

        await ctx.reply('👤 Кто принял заказ?', {
            reply_markup: staffKeyboard(staff),
        });
        return;
    }

    if (s.step === 'acceptedByManual') {
        s.acceptedByName = text;
        s.acceptedByTgId = tgId;
        s.step = 'services';

        await ctx.reply('🧾 Выберите услуги:', {
            reply_markup: servicesKeyboard(s.services),
        });
        return;
    }

    if (s.step === 'servicePrice' && s.pendingService) {
        const price = parseIntStrict(text);
        if (price === null || price < 0) {
            await ctx.reply('Цена должна быть числом (>= 0)');
            return;
        }

        s.items.push({ service: s.pendingService, price });
        s.step = 'serviceComment';

        await ctx.reply(
            `📝 Комментарий к "${SERVICE_LABELS[s.pendingService]}"? (или "-")`
        );
        return;
    }

    if (s.step === 'serviceComment') {
        const last = s.items.at(-1)!;
        last.comment = text === '-' ? null : text;
        s.step = 'serviceWarranty';

        await ctx.reply(
            `🛡 Гарантия (дней) для "${SERVICE_LABELS[last.service]}"? (0 или "-")`
        );
        return;
    }

    if (s.step === 'serviceWarranty') {
        const last = s.items.at(-1)!;
        const wd = text === '-' ? 0 : parseIntStrict(text);
        if (wd === null || wd < 0) {
            await ctx.reply('Введите число дней или "-"');
            return;
        }

        last.warrantyDays = wd || null;

        const next = s.services.find(
            (x: ServiceType) =>
                !(s.items?.some((i) => i.service === x) ?? false)
        );

        if (next) {
            s.pendingService = next;
            s.step = 'servicePrice';
            await ctx.reply(`💰 Цена за "${SERVICE_LABELS[next]}":`);
            return;
        }

        const sum = s.items.reduce((a, i) => a + i.price, 0);
        s.step = 'estimateTotal';

        await ctx.reply(`💰 Ориентировочная сумма? (число или "-" = ${sum})`);
        return;
    }

    if (s.step === 'estimateTotal') {
        let estimate: number | null = null;
        if (text !== '-') {
            const n = parseIntStrict(text);
            if (n === null || n < 0) {
                await ctx.reply('Введите число или "-"');
                return;
            }
            estimate = n;
        }

        const created = await orders.createOrder({
            clientPhone: s.phone!,
            photoFileId: s.photoFileId!,
            acceptedByTgId: s.acceptedByTgId!, // выбранный мастер
            createdByTgId: tgId,
            items: s.items.map((i) => ({
                service: i.service,
                price: i.price,
                comment: i.comment ?? null,
                warrantyDays: i.warrantyDays ?? null,
            })),
            estimateTotal: estimate,
        });

        const adminIds = await auth.getActiveAdminTgIds();
        await notifyAllAdmins(ctx, adminIds, created, '🆕 Новый заказ');

        ctx.session = { ...DEFAULT_SESSION };
        await sendOrderCard(ctx, created, true);
    }
}
