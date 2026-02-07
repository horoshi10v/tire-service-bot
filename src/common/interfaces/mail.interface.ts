/**
 * ISP (Interface Segregation Principle)
 * Defines contract for mail service
 */
export interface IMailService {
    sendPdf(
        to: string,
        subject: string,
        text: string,
        pdfBuffer: Buffer,
        filename?: string
    ): Promise<void>;

    saveToDrafts(
        subject: string,
        text: string,
        pdfBuffer: Buffer,
        filename?: string
    ): Promise<void>;
}

export const MAIL_SERVICE = Symbol('IMailService');
