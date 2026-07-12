import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SheetsModule } from '../integrations/sheets/sheets.module';
import { StorageService } from './storage.service';

@Module({
    imports: [PrismaModule, SheetsModule],
    providers: [StorageService],
    exports: [StorageService],
})
export class StorageModule {}
