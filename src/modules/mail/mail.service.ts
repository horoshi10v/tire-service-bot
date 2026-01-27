import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
    private transporter = nodemailer.createTransport({
        host: process.env.MAIL_HOST,
        port: Number(process.env.MAIL_PORT),
        secure: process.env.MAIL_SECURE === 'true',
        auth: {
            user: process.env.MAIL_USER,
            pass: process.env.MAIL_PASSWORD,
        },
        requireTLS: process.env.MAIL_REQUIRE_TLS === 'true',
    });

    async sendPdf(
        to: string,
        subject: string,
        text: string,
        pdfBuffer: Buffer,
        filename = 'warranty.pdf'
    ) {
        await this.transporter.sendMail({
            from: `"${process.env.MAIL_DEFAULT_NAME}" <${process.env.MAIL_DEFAULT_EMAIL}>`,
            to,
            subject,
            text,
            attachments: [
                {
                    filename,
                    content: pdfBuffer,
                },
            ],
        });
    }
}
