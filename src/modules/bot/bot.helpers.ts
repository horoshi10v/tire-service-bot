import type { Context } from 'telegraf';
import { BotSessionData, DEFAULT_SESSION } from './bot.session';
import { OrderStatus } from '@prisma/client';
import { SERVICE_LABELS, STATUS_LABELS, statusKeyboard } from './keyboards';

export type BotContext = Context & { session: BotSessionData };

export function ensureSession(ctx: BotContext) {
    if (!ctx.session) (ctx as any).session = { ...DEFAULT_SESSION };
    if (!ctx.session.services) ctx.session.services = [];
    if (!ctx.session.items) ctx.session.items = [];
    if (typeof ctx.session.flow === 'undefined') ctx.session.flow = null;
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

/** Уведомление админам: обязательно с фото, если оно есть */
export async function notifyAllAdmins(
    ctx: BotContext,
    adminTgIds: Array<string | number | bigint>,
    order: any,
    prefixText?: string
) {
    const text =
        (prefixText ? `${prefixText}\n\n` : '') + formatOrderShort(order);

    await Promise.all(
        adminTgIds.map(async (id) => {
            const chatId = Number(id);

            try {
                if (order.photoFileId) {
                    await ctx.telegram.sendPhoto(chatId, order.photoFileId, {
                        caption: text,
                    });
                } else {
                    await ctx.telegram.sendMessage(chatId, text);
                }
            } catch {
                // ignore
            }
        })
    );
}

function formatMaster(order: any): string {
    const name = order.acceptedBy?.name || '—';
    const username = order.acceptedBy?.username; // может отсутствовать в модели
    return username ? `${name} (@${String(username).replace(/^@/, '')})` : name;
}

export function formatOrderShort(order: any) {
    const itemsText = (order.items || [])
        .map((it: any) => {
            const label = SERVICE_LABELS[it.service] ?? String(it.service);
            const w = it.warrantyDays ? `, гарантия ${it.warrantyDays}д` : '';
            const c = it.comment ? ` (${it.comment})` : '';
            return `• ${label} — ${it.price}${c}${w}`;
        })
        .join('\n');

    return (
        `#${order.publicId} ${STATUS_LABELS[order.status]}\n` +
        `📞 ${order.clientPhone}\n` +
        `👤 Принял: ${formatMaster(order)}\n` +
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
