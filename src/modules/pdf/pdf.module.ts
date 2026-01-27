import { Module } from '@nestjs/common';
import { WarrantyPdfService } from './warranty-pdf.service';

@Module({
    providers: [WarrantyPdfService],
    exports: [WarrantyPdfService],
})
export class PdfModule {}
