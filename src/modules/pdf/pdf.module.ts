import { Module, forwardRef } from '@nestjs/common';
import { WarrantyPdfService } from './warranty-pdf.service';
import { PDF_GENERATOR } from '../../common/interfaces';
import { WarrantyModule } from '../warranty/warranty.module';

@Module({
    imports: [forwardRef(() => WarrantyModule)],
    providers: [
        {
            provide: PDF_GENERATOR,
            useClass: WarrantyPdfService,
        },
    ],
    exports: [PDF_GENERATOR],
})
export class PdfModule {}
