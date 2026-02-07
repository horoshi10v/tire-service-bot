import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersRepository } from './orders.repository';
import { PrismaModule } from '../../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { PdfModule } from '../pdf/pdf.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ORDERS_REPOSITORY } from '../../common/interfaces';
import { SheetsModule } from '../integrations/sheets/sheets.module';

@Module({
    imports: [
        PrismaModule,
        PdfModule,
        MailModule,
        NotificationsModule,
        SheetsModule,
    ],
    providers: [
        OrdersService,
        {
            provide: ORDERS_REPOSITORY,
            useClass: OrdersRepository,
        },
    ],
    exports: [OrdersService],
})
export class OrdersModule {}
