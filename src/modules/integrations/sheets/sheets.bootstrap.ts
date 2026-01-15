import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SheetsService } from './sheets.service';

@Injectable()
export class SheetsBootstrap implements OnModuleInit {
    private readonly log = new Logger(SheetsBootstrap.name);

    constructor(private sheets: SheetsService) {}

    async onModuleInit() {
        try {
            await this.sheets.syncStaffToDb();
            this.log.log('Initial staff sync OK');
        } catch (e: any) {
            this.log.error(`Initial staff sync failed: ${e?.message || e}`);
        }
    }
}
