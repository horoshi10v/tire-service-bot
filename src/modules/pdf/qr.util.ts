import * as QRCode from 'qrcode';

export async function generateQrPngBuffer(text: string): Promise<Buffer> {
    return QRCode.toBuffer(text, {
        type: 'png',
        errorCorrectionLevel: 'H',
        width: 300,
        margin: 1,
    });
}
