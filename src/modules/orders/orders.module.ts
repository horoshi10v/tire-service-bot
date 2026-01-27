import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { PdfModule } from '../pdf/pdf.module';

@Module({
    imports: [PrismaModule, PdfModule, MailModule],
    providers: [OrdersService],
    exports: [OrdersService],
})
export class OrdersModule {}
