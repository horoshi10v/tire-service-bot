import { Context } from 'telegraf';
import { OrderStatus } from '@prisma/client';
import { SERVICE_LABELS, STATUS_LABELS, statusKeyboard } from './keyboards';

export type BotContext = Context & { session: any };

export function ensureSession(ctx: BotContext) {
    if (!ctx.session) (ctx as any).session = { flow: null };
    if (!ctx.session.services) ctx.session.services = [];
    if (!ctx.session.items) ctx.session.items = [];
    return ctx.session;
}

export function isPhoneLike(s: string) {
    const t = s.replace(/[^\d+]/g, '');
    return t.length >= 7;
}

export function parseIntStrict(s: string): number | null {
    const n = Number(String(s).trim());
    if (!Number.isFinite(n)) return null;
    return Math.trunc(n);
}

export async function notifyAllAdmins(
    ctx: BotContext,
    adminTgIds: bigint[],
    text: string
) {
    await Promise.all(
        adminTgIds.map((id) =>
            ctx.telegram.sendMessage(Number(id), text).catch(() => null)
        )
    );
}

export function formatOrderShort(order: any) {
    const itemsText = (order.items || [])
        .map(
            (it: any) =>
                `• ${SERVICE_LABELS[it.service]} — ${it.price}` +
                (it.comment ? ` (${it.comment})` : '') +
                (it.warrantyDays ? `, гарантия ${it.warrantyDays}д` : '')
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

export async function sendOrderCard(
    ctx: BotContext,
    order: any,
    withKeyboard = true
) {
    const text = formatOrderShort(order);
    const keyboard =
        withKeyboard && order.status !== OrderStatus.DONE
            ? statusKeyboard(order.publicId)
            : undefined;

    if (order.photoFileId) {
        await ctx.replyWithPhoto(order.photoFileId, {
            caption: text,
            reply_markup: keyboard,
        });
    } else {
        await ctx.reply(text, { reply_markup: keyboard });
    }
}
