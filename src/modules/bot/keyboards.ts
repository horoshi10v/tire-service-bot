import { InlineKeyboardMarkup, ReplyKeyboardMarkup } from 'telegraf/types';
import { OrderStatus, ServiceType } from '@prisma/client';

export const SERVICE_LABELS: Record<ServiceType, string> = {
    TIRE_MOUNTING: 'Шиномонтаж',
    STRAIGHTENING: 'Рихтовка',
    WELDING: 'Сварка',
    BALANCING: 'Баллансировка',
    SIDE_REPAIR: 'Боковой ремонт',
    INSPECTION: 'Проверка',
    PUNCTURE: 'Прокол',
    PAINTING: 'Покраска',
    OTHER: 'Другое',
};

export const STATUS_LABELS: Record<OrderStatus, string> = {
    ACCEPTED: '🟡 Принято',
    IN_PROGRESS: '🔵 В работе',
    READY: '🟢 Готов',
    DONE: '⚫ Выдан',
};

/** Нижнее меню (кнопки снизу в чате) */
export function mainMenuKeyboard(): ReplyKeyboardMarkup {
    return {
        resize_keyboard: true,
        one_time_keyboard: false,
        is_persistent: true,
        keyboard: [
            ['🆕 Новый', '🔍 Поиск'],
            ['🟡 Принятые', '🔵 В работе'],
            ['🟢 Готовые', '⚫ Выданные'],
            ['📌 Открыть заказ', '📊 Сводка'],
        ],
    };
}

export function servicesKeyboard(
    selected: ServiceType[]
): InlineKeyboardMarkup {
    const rows = Object.keys(SERVICE_LABELS).map((k) => {
        const service = k as ServiceType;
        const mark = selected.includes(service) ? '✅ ' : '';
        return [
            {
                text: `${mark}${SERVICE_LABELS[service]}`,
                callback_data: `svc:${service}`,
            },
        ];
    });

    rows.push([{ text: '✅ Готово', callback_data: 'svc:done' }]);
    return { inline_keyboard: rows };
}

export function statusKeyboard(publicId: number): InlineKeyboardMarkup {
    return {
        inline_keyboard: [
            [
                {
                    text: STATUS_LABELS.ACCEPTED,
                    callback_data: `st:${publicId}:ACCEPTED`,
                },
                {
                    text: STATUS_LABELS.IN_PROGRESS,
                    callback_data: `st:${publicId}:IN_PROGRESS`,
                },
            ],
            [
                {
                    text: STATUS_LABELS.READY,
                    callback_data: `st:${publicId}:READY`,
                },
                {
                    text: STATUS_LABELS.DONE,
                    callback_data: `st:${publicId}:DONE`,
                },
            ],
        ],
    };
}

export function staffKeyboard(
    staff: { tgId: bigint; name: string }[]
): InlineKeyboardMarkup {
    const rows = staff.map((s) => [
        { text: s.name, callback_data: `staff:${s.tgId}` },
    ]);

    rows.push([{ text: '✍️ Ввести вручную', callback_data: 'staff:manual' }]);

    return { inline_keyboard: rows };
}
