import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { PDFDocument, rgb, PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as fs from 'fs';
import * as path from 'path';
import { generateQrPngBuffer } from './qr.util';
import { IPdfGenerator, OrderWithDetails } from '../../common/interfaces';
import { SERVICE_LABELS } from '../bot/keyboards';
import { WarrantyVerificationService } from '../warranty';

// --- Константи дизайну ---
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 40;

const COLORS = {
    PRIMARY: rgb(0, 0.33, 0.56), // Темно-синій (брендовий)
    TEXT: rgb(0, 0, 0),
    GRAY_TEXT: rgb(0.4, 0.4, 0.4),
    LIGHT_BG: rgb(0.96, 0.96, 0.96), // Фон для рядків таблиці
    HEADER_BG: rgb(0.9, 0.9, 0.95), // Фон для заголовків блоків
};

@Injectable()
export class WarrantyPdfService implements IPdfGenerator {
    private readonly logger = new Logger(WarrantyPdfService.name);

    constructor(
        @Inject(forwardRef(() => WarrantyVerificationService))
        private readonly warrantyService: WarrantyVerificationService
    ) {}

    async generate(order: OrderWithDetails): Promise<Buffer> {
        // 1. Генерація посилання та QR
        const verifyUrl = this.warrantyService.generateVerificationUrl(
            order.publicId,
            order.clientPhone
        );
        const qrPng = await generateQrPngBuffer(verifyUrl);

        // 2. Створення PDF
        const pdf = await PDFDocument.create();
        pdf.registerFontkit(fontkit);

        // 3. Завантаження ресурсів (Шрифти та Іконка)
        // Використовуємо __dirname, як ви просили
        const fontPathRegular = path.join(
            __dirname,
            'fonts/Roboto-Regular.ttf'
        );
        // Для красивого документу бажано мати і Bold. Якщо його немає, використовуємо Regular
        const fontPathBold = path.join(__dirname, 'fonts/Roboto-Bold.ttf');
        const iconPath = path.join(__dirname, 'icon/main-icon.png');

        let fontRegular: PDFFont;
        let fontBold: PDFFont;
        let iconImage: any = null;

        try {
            const fontBytesRegular = fs.readFileSync(fontPathRegular);
            fontRegular = await pdf.embedFont(fontBytesRegular);

            // Спробуємо завантажити Bold, якщо немає - фоллбек на Regular
            if (fs.existsSync(fontPathBold)) {
                const fontBytesBold = fs.readFileSync(fontPathBold);
                fontBold = await pdf.embedFont(fontBytesBold);
            } else {
                fontBold = fontRegular;
            }

            if (fs.existsSync(iconPath)) {
                const iconBytes = fs.readFileSync(iconPath);
                // Визначаємо тип зображення (png або jpg)
                if (iconPath.endsWith('.png')) {
                    iconImage = await pdf.embedPng(iconBytes);
                } else {
                    iconImage = await pdf.embedJpg(iconBytes);
                }
            } else {
                this.logger.warn(`Icon not found at ${iconPath}`);
            }
        } catch (error) {
            this.logger.error('Error loading fonts or icon', error);
            throw new Error('Failed to load PDF assets');
        }

        const qrImage = await pdf.embedPng(qrPng);
        const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);

        let currentY = A4_HEIGHT - MARGIN;

        // --- Хелпер для малювання тексту ---
        const drawText = (
            text: string,
            x: number,
            y: number,
            options: {
                size?: number;
                font?: PDFFont;
                color?: any;
                align?: 'left' | 'right' | 'center';
            } = {}
        ) => {
            const size = options.size || 10;
            const font = options.font || fontRegular;
            const color = options.color || COLORS.TEXT;
            const align = options.align || 'left';

            let finalX = x;
            if (align === 'right') {
                const width = font.widthOfTextAtSize(text, size);
                finalX = x - width;
            } else if (align === 'center') {
                const width = font.widthOfTextAtSize(text, size);
                finalX = x - width / 2;
            }

            page.drawText(text, { x: finalX, y, size, font, color });
        };

        // ================= HEADER =================
        // Логотип (зліва)
        if (iconImage) {
            const iconSize = 50;
            page.drawImage(iconImage, {
                x: MARGIN,
                y: currentY - iconSize + 10,
                width: iconSize,
                height: iconSize,
            });

            drawText('SHINA DP', MARGIN + iconSize + 15, currentY, {
                size: 20,
                font: fontBold,
                color: COLORS.PRIMARY,
            });
            drawText(
                'Професійний шиномонтаж',
                MARGIN + iconSize + 15,
                currentY - 15,
                { size: 10, color: COLORS.GRAY_TEXT }
            );
        } else {
            // Фоллбек, якщо іконки немає
            drawText('SHINA DP', MARGIN, currentY, {
                size: 24,
                font: fontBold,
                color: COLORS.PRIMARY,
            });
        }

        // Заголовок документу (справа)
        drawText('ГАРАНТІЙНИЙ ТАЛОН', A4_WIDTH - MARGIN, currentY, {
            size: 16,
            font: fontBold,
            align: 'right',
        });
        drawText(
            `Замовлення № ${order.publicId}`,
            A4_WIDTH - MARGIN,
            currentY - 20,
            { size: 12, color: COLORS.GRAY_TEXT, align: 'right' }
        );

        currentY -= 60;

        // Лінія розділювач
        page.drawLine({
            start: { x: MARGIN, y: currentY },
            end: { x: A4_WIDTH - MARGIN, y: currentY },
            thickness: 2,
            color: COLORS.PRIMARY,
        });
        currentY -= 20;

        // ================= INFO BLOCKS =================
        const colWidth = (A4_WIDTH - MARGIN * 2) / 2 - 20;

        // --- Ліва колонка: Клієнт ---
        drawText('ДАНІ КЛІЄНТА', MARGIN, currentY, {
            size: 10,
            font: fontBold,
            color: COLORS.PRIMARY,
        });
        currentY -= 15;
        drawText(`Телефон: ${order.clientPhone}`, MARGIN, currentY);
        if (order.clientEmail) {
            currentY -= 12;
            drawText(`Email: ${order.clientEmail}`, MARGIN, currentY);
        }

        // --- Права колонка: Деталі ---
        const rightColX = A4_WIDTH / 2 + 10;
        const rightColYStart = currentY + (order.clientEmail ? 27 : 15); // Повертаємо Y назад для правої колонки

        drawText('ДЕТАЛІ ВИКОНАННЯ', rightColX, rightColYStart, {
            size: 10,
            font: fontBold,
            color: COLORS.PRIMARY,
        });

        const dateStr = order.createdAt
            ? new Date(order.createdAt).toLocaleDateString('uk-UA')
            : new Date().toLocaleDateString('uk-UA');

        const masterName =
            order.assignedTo?.name ||
            order.acceptedBy?.name ||
            'Черговий майстер';

        drawText(`Дата видачі: ${dateStr}`, rightColX, rightColYStart - 15);
        drawText(`Майстер: ${masterName}`, rightColX, rightColYStart - 27);

        currentY -= 40;

        // ================= SERVICES TABLE =================
        drawText('ВИКОНАНІ ПОСЛУГИ', MARGIN, currentY, {
            size: 12,
            font: fontBold,
        });
        currentY -= 10;

        // Шапка таблиці
        const tableHeaderHeight = 20;
        page.drawRectangle({
            x: MARGIN,
            y: currentY - tableHeaderHeight + 5,
            width: A4_WIDTH - MARGIN * 2,
            height: tableHeaderHeight,
            color: COLORS.PRIMARY,
        });

        const col1 = MARGIN + 10; // Назва
        const col2 = A4_WIDTH - 200; // Гарантія
        const col3 = A4_WIDTH - MARGIN - 10; // Ціна (right align)

        const headerY = currentY - 7;
        drawText('Найменування послуги', col1, headerY, {
            size: 10,
            font: fontBold,
            color: rgb(1, 1, 1),
        });
        drawText('Гарантія', col2, headerY, {
            size: 10,
            font: fontBold,
            color: rgb(1, 1, 1),
        });
        drawText('Ціна', col3, headerY, {
            size: 10,
            font: fontBold,
            color: rgb(1, 1, 1),
            align: 'right',
        });

        currentY -= 25;

        // Рядки таблиці
        for (let i = 0; i < order.items.length; i++) {
            const item = order.items[i];

            // Зебра (фон через один)
            if (i % 2 === 0) {
                page.drawRectangle({
                    x: MARGIN,
                    y: currentY - 2,
                    width: A4_WIDTH - MARGIN * 2,
                    height: 16,
                    color: COLORS.LIGHT_BG,
                });
            }

            const serviceName = SERVICE_LABELS[item.service] || item.service;
            const comment = item.comment ? ` (${item.comment})` : '';
            // Обрізаємо дуже довгі назви
            let fullName = `${i + 1}. ${serviceName}${comment}`;
            if (fullName.length > 55)
                fullName = fullName.substring(0, 52) + '...';

            const warrantyText = item.warrantyDays
                ? `${item.warrantyDays} дн.`
                : '—';

            drawText(fullName, col1, currentY, { size: 10 });
            drawText(warrantyText, col2, currentY, { size: 10 });
            drawText(`${item.price.toFixed(2)} грн`, col3, currentY, {
                size: 10,
                align: 'right',
            });

            currentY -= 18;
        }

        // ================= TOTAL =================
        currentY -= 10;
        page.drawLine({
            start: { x: MARGIN, y: currentY },
            end: { x: A4_WIDTH - MARGIN, y: currentY },
            thickness: 1,
            color: COLORS.GRAY_TEXT,
        });
        currentY -= 20;

        drawText('ВСЬОГО ДО СПЛАТИ:', A4_WIDTH - 180, currentY, {
            size: 12,
            font: fontBold,
            align: 'right',
        });
        drawText(`${order.finalTotal} грн`, A4_WIDTH - MARGIN, currentY, {
            size: 14,
            font: fontBold,
            color: COLORS.PRIMARY,
            align: 'right',
        });

        // ================= WARRANTY TERMS =================
        currentY -= 50;
        const termsY = currentY;

        drawText('УМОВИ ГАРАНТІЇ:', MARGIN, termsY, {
            size: 9,
            font: fontBold,
        });
        const terms = [
            '1. Гарантія поширюється лише на послуги, зазначені в цьому талоні, за умови наявності чека/талона.',
            '2. Гарантія не діє у випадках механічних пошкоджень шин, дисків або ремонту третіми особами.',
            "3. Претензії приймаються протягом гарантійного терміну при пред'явленні автомобіля для огляду.",
            '4. Електронний примірник гарантії доступний за QR-кодом нижче.',
        ];

        let lineY = termsY - 12;
        terms.forEach((term) => {
            drawText(term, MARGIN, lineY, { size: 8, color: COLORS.GRAY_TEXT });
            lineY -= 10;
        });

        // ================= FOOTER & QR =================
        // Фіксуємо футер внизу сторінки
        const footerY = 120;

        // QR Code (справа внизу)
        const qrSize = 90;
        page.drawImage(qrImage, {
            x: A4_WIDTH - MARGIN - qrSize,
            y: footerY - 10,
            width: qrSize,
            height: qrSize,
        });

        drawText(
            'Електронна гарантія',
            A4_WIDTH - MARGIN - qrSize / 2,
            footerY - 20,
            { size: 8, align: 'center', color: COLORS.PRIMARY }
        );

        // Підписи
        const signY = footerY + 20;

        // Виконавець
        drawText('Виконавець:', MARGIN, signY, { size: 9, font: fontBold });
        page.drawLine({
            start: { x: MARGIN, y: signY - 25 },
            end: { x: MARGIN + 120, y: signY - 25 },
            thickness: 1,
            color: COLORS.TEXT,
        });
        drawText('(підпис / м.п.)', MARGIN + 60, signY - 35, {
            size: 8,
            align: 'center',
            color: COLORS.GRAY_TEXT,
        });

        // Замовник
        const clientSignX = MARGIN + 180;
        drawText('Замовник:', clientSignX, signY, { size: 9, font: fontBold });
        drawText(
            'Претензій до виконаних робіт не маю.',
            clientSignX,
            signY - 10,
            { size: 8, color: COLORS.GRAY_TEXT }
        );
        page.drawLine({
            start: { x: clientSignX, y: signY - 25 },
            end: { x: clientSignX + 120, y: signY - 25 },
            thickness: 1,
            color: COLORS.TEXT,
        });
        drawText('(підпис)', clientSignX + 60, signY - 35, {
            size: 8,
            align: 'center',
            color: COLORS.GRAY_TEXT,
        });

        // ID знизу сторінки
        drawText(verifyUrl, MARGIN, 30, { size: 8, color: COLORS.GRAY_TEXT });

        const bytes = await pdf.save();
        return Buffer.from(bytes);
    }
}
