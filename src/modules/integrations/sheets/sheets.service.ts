import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { PrismaService } from '../../../prisma/prisma.service';
import { StaffRow, StaffRole } from './sheets.types';

const STAFF_SHEET_TITLE = 'Staff';

function parseBool(v: string | undefined): boolean {
    const s = String(v ?? '')
        .trim()
        .toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}

function normalizeRole(v: any): StaffRole | null {
    const s = String(v ?? '')
        .trim()
        .toUpperCase();
    if (s === 'ADMIN' || s === 'MASTER') return s as StaffRole;
    return null;
}

@Injectable()
export class SheetsService {
    private readonly log = new Logger(SheetsService.name);

    constructor(
        private cfg: ConfigService,
        private prisma: PrismaService
    ) {}

    private async getDoc() {
        const sheetId = this.cfg.get<string>('google.sheetId')!;
        const email = this.cfg.get<string>('google.serviceEmail')!;
        const privateKeyRaw = this.cfg.get<string>('google.privateKey')!;
        const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

        const auth = new JWT({
            email,
            key: privateKey,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(sheetId, auth);
        await doc.loadInfo();
        return doc;
    }

    async fetchStaffRows(): Promise<StaffRow[]> {
        const doc = await this.getDoc();
        const sheet = doc.sheetsByTitle[STAFF_SHEET_TITLE];
        if (!sheet)
            throw new Error(
                `Google Sheet tab "${STAFF_SHEET_TITLE}" not found`
            );

        const rows = await sheet.getRows();
        return rows.map((r: any) => ({
            tgId: String(r.get('tgId') ?? '').trim(),
            name: String(r.get('name') ?? '').trim() || undefined,
            role: String(r.get('role') ?? '')
                .trim()
                .toUpperCase() as any,
            active: String(r.get('active') ?? '').trim(),
        }));
    }

    /**
     * Sync Staff(tab) → Employee table:
     * - upsert by tgId
     * - set role/isActive/name
     * - deactivate employees that are not present in sheet (optional, but recommended)
     */
    async syncStaffToDb(): Promise<{ upserted: number; deactivated: number }> {
        const rows = await this.fetchStaffRows();

        // parse and validate
        const staff = rows
            .map((r) => {
                const tgIdNum = Number(String(r.tgId).replace(/\s+/g, ''));
                const role = normalizeRole(r.role);
                if (!tgIdNum || !role) return null;

                return {
                    tgId: BigInt(tgIdNum),
                    name: r.name?.trim() || null,
                    role,
                    isActive: parseBool(r.active),
                };
            })
            .filter(Boolean) as Array<{
            tgId: bigint;
            name: string | null;
            role: StaffRole;
            isActive: boolean;
        }>;

        const sheetTgIds = staff.map((s) => s.tgId);

        // upsert all from sheet
        let upserted = 0;
        for (const s of staff) {
            await this.prisma.employee.upsert({
                where: { tgId: s.tgId },
                create: {
                    tgId: s.tgId,
                    name: s.name,
                    role: s.role,
                    isActive: s.isActive,
                },
                update: {
                    name: s.name,
                    role: s.role,
                    isActive: s.isActive,
                },
            });
            upserted++;
        }

        // deactivate who are not in sheet
        const res = await this.prisma.employee.updateMany({
            where: {
                isActive: true,
                tgId: { notIn: sheetTgIds.length ? sheetTgIds : [BigInt(-1)] },
            },
            data: { isActive: false },
        });

        this.log.log(
            `Staff sync done: upserted=${upserted}, deactivated=${res.count}`
        );
        return { upserted, deactivated: res.count };
    }
}
