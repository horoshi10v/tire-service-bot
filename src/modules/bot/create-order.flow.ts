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

    // ensure arrays
    s.items ??= [];
    s.services ??= [];

    if (s.step === 'phone') {
        if (!isPhoneLike(text)) {
            await ctx.reply('Введіть коректний номер (мінімум 7 цифр)');
            return;
        }
        s.phone = text;
        s.step = 'acceptedBySelect';

        const staff = (await auth.getActiveStaff()).map((s) => ({
            tgId: s.tgId,
            name: s.name || 'Без імені',
        }));

        await ctx.reply('👤 Хто прийняв замовлення?', {
            reply_markup: staffKeyboard(staff),
        });
        return;
    }

    if (s.step === 'acceptedByManual') {
        s.acceptedByName = text;
        s.acceptedByTgId = tgId;
        s.step = 'services';

        await ctx.reply('🧾 Виберіть послуги:', {
            reply_markup: servicesKeyboard(s.services),
        });
        return;
    }

    if (s.step === 'servicePrice' && s.pendingService) {
        const price = parseIntStrict(text);
        if (price === null || price < 0) {
            await ctx.reply('Ціна має бути числом (>= 0)');
            return;
        }

        s.items.push({ service: s.pendingService, price });
        s.step = 'serviceComment';

        await ctx.reply(
            `📝 Коментар до "${SERVICE_LABELS[s.pendingService]}"? (або "-")`
        );
        return;
    }

    if (s.step === 'serviceComment') {
        const last = s.items.at(-1)!;
        last.comment = text === '-' ? null : text;
        s.step = 'serviceWarranty';

        await ctx.reply(
            `🛡 Гарантія (днів) для "${SERVICE_LABELS[last.service]}"? (0 або "-")`
        );
        return;
    }

    if (s.step === 'serviceWarranty') {
        const last = s.items.at(-1)!;
        const wd = text === '-' ? 0 : parseIntStrict(text);
        if (wd === null || wd < 0) {
            await ctx.reply('Введіть кількість днів або "-"');
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
            await ctx.reply(`💰 Ціна за "${SERVICE_LABELS[next]}":`);
            return;
        }

        const sum = s.items.reduce((a, i) => a + i.price, 0);
        s.step = 'estimateTotal';

        await ctx.reply(`💰 Орієнтовна сума? (число або "-" = ${sum})`);
        return;
    }

    if (s.step === 'estimateTotal') {
        let estimate: number | null = null;
        if (text !== '-') {
            const n = parseIntStrict(text);
            if (n === null || n < 0) {
                await ctx.reply('Введіть число або "-"');
                return;
            }
            estimate = n;
        }

        const created = await orders.createOrder({
            clientPhone: s.phone!,
            photoFileId: s.photoFileId!,
            acceptedByTgId: s.acceptedByTgId!, // selected master
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
        await notifyAllAdmins(ctx, adminIds, created, '🆕 Нове замовлення');

        ctx.session = { ...DEFAULT_SESSION };
        await sendOrderCard(ctx, created, true);
    }
}
