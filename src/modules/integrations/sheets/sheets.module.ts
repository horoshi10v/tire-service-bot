import { Module } from '@nestjs/common';
import { SheetsService } from './sheets.service';
import { SheetsBootstrap } from './sheets.bootstrap';

@Module({
    providers: [SheetsService, SheetsBootstrap],
    exports: [SheetsService],
})
export class SheetsModule {}
