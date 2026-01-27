import { Injectable } from '@nestjs/common';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { generateQrPngBuffer } from './qr.util';

@Injectable()
export class WarrantyPdfService {
    async generate(order: any): Promise<Buffer> {
        const token = crypto
            .createHash('sha256')
            .update(`${order.publicId}:${order.clientPhone}`)
            .digest('hex')
            .slice(0, 16);

        const verifyUrl = `https://t.me/shina_dp_bot?start=verify_${order.publicId}_${token}`;
        const qrPng = await generateQrPngBuffer(verifyUrl);

        const pdf = await PDFDocument.create();
        pdf.registerFontkit(fontkit);

        const fontBytes = fs.readFileSync(
            path.join(__dirname, 'fonts/Roboto-Regular.ttf')
        );
        const font = await pdf.embedFont(fontBytes);

        const qrImage = await pdf.embedPng(qrPng);
        const page = pdf.addPage([595, 842]);
        const { width, height } = page.getSize();

        let y = height - 60;

        const drawText = (text: string, size = 12) => {
            page.drawText(text, {
                x: 50,
                y,
                size,
                font,
                color: rgb(0, 0, 0),
            });
            y -= size + 8;
        };

        drawText('ГАРАНТІЙНИЙ ТАЛОН', 18);
        drawText(`Замовлення № ${order.publicId}`, 14);
        y -= 10;

        drawText(`Дата: ${new Date().toLocaleDateString('uk-UA')}`);
        drawText(`Телефон клієнта: ${order.clientPhone}`);
        if (order.clientEmail) drawText(`Email: ${order.clientEmail}`);
        drawText(
            `Майстер: ${order.assignedTo?.name || order.acceptedBy?.name || '—'}`
        );

        y -= 15;
        drawText('Виконані роботи:', 14);

        for (const item of order.items) {
            drawText(
                `• ${item.service} — ${item.price} грн — гарантія ${
                    item.warrantyDays || 0
                } дн`
            );
        }

        y -= 10;
        drawText(`Разом: ${order.finalTotal} грн`, 14);

        page.drawImage(qrImage, {
            x: width - 180,
            y: 100,
            width: 120,
            height: 120,
        });

        page.drawText('QR для перевірки гарантії', {
            x: width - 190,
            y: 230,
            size: 10,
            font,
        });

        page.drawText(verifyUrl, {
            x: 50,
            y: 60,
            size: 9,
            font,
        });

        const bytes = await pdf.save();
        return Buffer.from(bytes);
    }
}
