import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { IMailService } from '../../common/interfaces';

@Injectable()
export class MailService implements IMailService {
    private readonly logger = new Logger(MailService.name);
    private readonly transporter: Transporter;
    private readonly defaultFrom: string;

    constructor(private readonly config: ConfigService) {
        this.transporter = nodemailer.createTransport({
            host: this.config.get<string>('mail.host'),
            port: this.config.get<number>('mail.port'),
            secure: this.config.get<boolean>('mail.secure'),
            auth: {
                user: this.config.get<string>('mail.user'),
                pass: this.config.get<string>('mail.password'),
            },
            requireTLS: this.config.get<boolean>('mail.requireTls'),
        });

        const name = this.config.get<string>('mail.defaultName');
        const email = this.config.get<string>('mail.defaultEmail');
        this.defaultFrom = `"${name}" <${email}>`;
    }

    async sendPdf(
        to: string,
        subject: string,
        text: string,
        pdfBuffer: Buffer,
        filename = 'warranty.pdf'
    ): Promise<void> {
        try {
            await this.transporter.sendMail({
                from: this.defaultFrom,
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
            this.logger.log(`Email sent to ${to}`);
        } catch (error) {
            this.logger.error(`Failed to send email to ${to}`, error);
            throw error;
        }
    }

    /**
     * Save email to drafts folder (for backup purposes)
     */
    async saveToDrafts(
        subject: string,
        text: string,
        pdfBuffer: Buffer,
        filename = 'warranty.pdf'
    ): Promise<void> {
        try {
            await this.transporter.sendMail({
                from: this.defaultFrom,
                to: this.config.get<string>('mail.defaultEmail'),
                subject: `[DRAFT] ${subject}`,
                text,
                attachments: [
                    {
                        filename,
                        content: pdfBuffer,
                    },
                ],
            });
            this.logger.log(`Draft saved: ${subject}`);
        } catch (error) {
            this.logger.warn(`Failed to save draft: ${subject}`, error);
        }
    }
}
