import { Module, forwardRef } from '@nestjs/common';
import { WarrantyVerificationService } from './warranty-verification.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    providers: [WarrantyVerificationService],
    exports: [WarrantyVerificationService],
})
export class WarrantyModule {}
