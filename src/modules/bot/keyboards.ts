import { InlineKeyboardMarkup, ReplyKeyboardMarkup } from 'telegraf/types';
import { OrderStatus, ServiceType } from '@prisma/client';

export const SERVICE_LABELS: Record<ServiceType, string> = {
    TIRE_MOUNTING: 'Шиномонтаж',
    STRAIGHTENING: 'Рихтування',
    WELDING: 'Зварювання',
    BALANCING: 'Балансування',
    SIDE_REPAIR: 'Боковий ремонт',
    INSPECTION: 'Перевірка',
    PUNCTURE: 'Прокол',
    PAINTING: 'Фарбування',
    OTHER: 'Інше',
};

export const STATUS_LABELS: Record<OrderStatus, string> = {
    ACCEPTED: '🟡 Прийнято',
    IN_PROGRESS: '🔵 В роботі',
    READY: '🟢 Готово',
    DONE: '⚫ Видано',
};

/** Нижнє меню (кнопки знизу в чаті) */
export function mainMenuKeyboard(): ReplyKeyboardMarkup {
    return {
        resize_keyboard: true,
        one_time_keyboard: false,
        is_persistent: true,
        keyboard: [
            ['🆕 Новий', '🔍 Пошук'],
            ['🟡 Прийняті', '🔵 В роботі'],
            ['🟢 Готові', '⚫ Видані'],
            ['📌 Відкрити замовлення', '📊 Зведення'],
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

export function orderInlineKeyboard(params: {
    publicId: number;
    showStatus: boolean;
    showEdit: boolean;
    showDelete: boolean;
}): InlineKeyboardMarkup {
    const rows: InlineKeyboardMarkup['inline_keyboard'] = [];

    if (params.showStatus) {
        rows.push([
            {
                text: STATUS_LABELS.ACCEPTED,
                callback_data: `st:${params.publicId}:ACCEPTED`,
            },
            {
                text: STATUS_LABELS.IN_PROGRESS,
                callback_data: `st:${params.publicId}:IN_PROGRESS`,
            },
        ]);
        rows.push([
            {
                text: STATUS_LABELS.READY,
                callback_data: `st:${params.publicId}:READY`,
            },
            {
                text: STATUS_LABELS.DONE,
                callback_data: `st:${params.publicId}:DONE`,
            },
        ]);
    }

    if (params.showEdit || params.showDelete) {
        const row: InlineKeyboardMarkup['inline_keyboard'][number] = [];
        if (params.showEdit) {
            row.push({
                text: '✏️ Редагувати',
                callback_data: `edit:${params.publicId}`,
            });
        }
        if (params.showDelete) {
            row.push({
                text: '🗑 Видалити',
                callback_data: `del:${params.publicId}`,
            });
        }
        rows.push(row);
    }

    return { inline_keyboard: rows };
}

export function editMenuKeyboard(publicId: number): InlineKeyboardMarkup {
    return {
        inline_keyboard: [
            [
                {
                    text: '📞 Телефон',
                    callback_data: `edit:${publicId}:phone`,
                },
                {
                    text: '🧾 Послуги',
                    callback_data: `edit:${publicId}:items`,
                },
            ],
            [
                {
                    text: '💰 Орієнтовна сума',
                    callback_data: `edit:${publicId}:estimate`,
                },
                {
                    text: '✉️ Email',
                    callback_data: `edit:${publicId}:email`,
                },
            ],
            [
                {
                    text: '📸 Фото',
                    callback_data: `edit:${publicId}:photo`,
                },
                {
                    text: '❌ Скасувати',
                    callback_data: `edit:${publicId}:cancel`,
                },
            ],
        ],
    };
}

export function deleteConfirmKeyboard(
    publicId: number
): InlineKeyboardMarkup {
    return {
        inline_keyboard: [
            [
                { text: '✅ Видалити', callback_data: `delc:${publicId}` },
                { text: '❌ Скасувати', callback_data: `delx:${publicId}` },
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

    rows.push([{ text: '✍️ Ввести вручну', callback_data: 'staff:manual' }]);

    return { inline_keyboard: rows };
}
