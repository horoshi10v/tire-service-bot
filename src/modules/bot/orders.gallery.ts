import { InlineKeyboardMarkup } from 'telegraf/types';
import { OrderStatus } from '@prisma/client';
import { SERVICE_LABELS, STATUS_LABELS } from './keyboards';

type EmployeeLite = {
    name?: string | null;
    username?: string | null;
    tgId?: bigint | null;
};
type OrderLite = {
    publicId: number;
    status: OrderStatus;
    clientPhone: string;
    estimateTotal: number | null;
    finalTotal: number | null;
    acceptedBy?: EmployeeLite | null;
    items?: { service: any; price: number }[];
};

export function shortLine(order: OrderLite): string {
    const firstService = order.items?.[0]?.service
        ? SERVICE_LABELS[order.items[0].service]
        : '—';
    const sum =
        order.finalTotal ??
        order.estimateTotal ??
        order.items?.reduce((a, i) => a + (i.price || 0), 0) ??
        null;

    const master = order.acceptedBy?.name || '—';

    return `#${order.publicId} | ${firstService} | ${sum ?? '—'} | ${order.clientPhone} | ${master}`;
}

export function ordersListKeyboard(
    orders: OrderLite[],
    status: OrderStatus,
    page: number,
    totalPages: number
): InlineKeyboardMarkup {
    const rows: InlineKeyboardMarkup['inline_keyboard'] = [];

    for (const o of orders) {
        rows.push([
            { text: shortLine(o), callback_data: `open:${o.publicId}` },
        ]);
    }

    // pagination row
    const navRow: InlineKeyboardMarkup['inline_keyboard'][number] = [];

    if (page > 1) {
        navRow.push({
            text: '⬅ Поперед',
            callback_data: `page:${status}:${page - 1}`,
        });
    }

    navRow.push({ text: `${page}/${totalPages}`, callback_data: `noop:page` });

    if (page < totalPages) {
        navRow.push({
            text: 'Наст ➡',
            callback_data: `page:${status}:${page + 1}`,
        });
    }

    rows.push(
        navRow.length ? navRow : [{ text: '1/1', callback_data: 'noop:page' }]
    );

    return { inline_keyboard: rows };
}

export function statusListTitle(status: OrderStatus) {
    return `📋 Список: ${STATUS_LABELS[status]}`;
}
