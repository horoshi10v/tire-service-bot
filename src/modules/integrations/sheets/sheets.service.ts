import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { PrismaService } from '../../../prisma/prisma.service';
import { StaffRow, StaffRole } from './sheets.types';
import { OrderStatus, ServiceType } from '@prisma/client';

const STAFF_SHEET_TITLE = 'Staff';
const BACKUP_SHEET_TITLE = 'Backup';
const STORAGE_BACKUP_SHEET_TITLE = 'StorageBackup';
const BACKUP_VERSION = 'v1';
const BACKUP_HEADERS = [
    'backupVersion',
    'backupAt',
    'publicId',
    'status',
    'clientPhone',
    'clientEmail',
    'acceptedByRole',
    'acceptedByTgId',
    'acceptedByName',
    'createdByRole',
    'createdByTgId',
    'createdByName',
    'assignedToRole',
    'assignedToTgId',
    'assignedToName',
    'estimateTotal',
    'finalTotal',
    'photoFileId',
    'photoFileIdsJson',
    'createdAt',
    'updatedAt',
    'storageStartedAt',
    'doneAt',
    'itemsJson',
    'storageFeePerDay',
];
const BACKUP_BATCH_SIZE = 500;
const STORAGE_BACKUP_HEADERS = [
    'backupAt', 'publicId', 'orderPublicId', 'status', 'clientPhone', 'type',
    'quantity', 'size', 'brand', 'wheelDetailsJson', 'comment', 'photoFileId',
    'feePerDay', 'storedAt', 'releasedAt', 'createdByName', 'photoFileIdsJson',
];

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

function parseNumber(v: any): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : null;
}

function parseDate(v: any): Date | null {
    if (!v) return null;
    const d = new Date(String(v).trim());
    return Number.isNaN(d.getTime()) ? null : d;
}

function parseOrderStatus(v: any): OrderStatus | null {
    const s = String(v ?? '')
        .trim()
        .toUpperCase();
    return (Object.values(OrderStatus) as string[]).includes(s)
        ? (s as OrderStatus)
        : null;
}

function parseServiceType(v: any): ServiceType | null {
    const s = String(v ?? '')
        .trim()
        .toUpperCase();
    return (Object.values(ServiceType) as string[]).includes(s)
        ? (s as ServiceType)
        : null;
}

function calcWarrantyUntil(base: Date, days?: number | null): Date | null {
    if (!days || days <= 0) return null;
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d;
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

    private async ensureBackupSheet() {
        const doc = await this.getDoc();
        let sheet = doc.sheetsByTitle[BACKUP_SHEET_TITLE];

        if (!sheet) {
            sheet = await doc.addSheet({
                title: BACKUP_SHEET_TITLE,
                headerValues: BACKUP_HEADERS,
            });
            return sheet;
        }

        let hasHeader = false;
        try {
            await sheet.loadHeaderRow();
            hasHeader = true;
        } catch {
            // no header row yet
        }

        if (!hasHeader) {
            await sheet.setHeaderRow(BACKUP_HEADERS);
            return sheet;
        }

        const headers = sheet.headerValues ?? [];
        if (
            !headers.length ||
            BACKUP_HEADERS.some((h) => !headers.includes(h))
        ) {
            await sheet.setHeaderRow(BACKUP_HEADERS);
        }

        return sheet;
    }

    private async ensureStorageBackupSheet() {
        const doc = await this.getDoc();
        let sheet = doc.sheetsByTitle[STORAGE_BACKUP_SHEET_TITLE];
        if (!sheet) {
            sheet = await doc.addSheet({
                title: STORAGE_BACKUP_SHEET_TITLE,
                headerValues: STORAGE_BACKUP_HEADERS,
            });
        } else {
            await sheet.setHeaderRow(STORAGE_BACKUP_HEADERS);
        }
        return sheet;
    }

    private toStorageBackupRow(lot: any, backupAt: string) {
        return {
            backupAt,
            publicId: String(lot.publicId),
            orderPublicId: lot.order?.publicId ? String(lot.order.publicId) : '',
            status: lot.status,
            clientPhone: lot.clientPhone,
            type: lot.type,
            quantity: String(lot.quantity),
            size: lot.size ?? '',
            brand: lot.brand ?? '',
            wheelDetailsJson: lot.wheelDetails
                ? JSON.stringify(lot.wheelDetails)
                : '',
            comment: lot.comment ?? '',
            photoFileId: lot.photoFileId ?? '',
            photoFileIdsJson: JSON.stringify(
                (lot.photos ?? []).map((photo: any) => photo.fileId)
            ),
            feePerDay: String(lot.feePerDay),
            storedAt: new Date(lot.storedAt).toISOString(),
            releasedAt: lot.releasedAt
                ? new Date(lot.releasedAt).toISOString()
                : '',
            createdByName: lot.createdBy?.name ?? '',
        };
    }

    async backupStorageLotByPublicId(publicId: number): Promise<boolean> {
        const lot = await this.prisma.storageLot.findUnique({
            where: { publicId },
            include: {
                createdBy: { select: { name: true } },
                order: { select: { publicId: true } },
                photos: true,
            },
        });
        if (!lot) return false;
        const sheet = await this.ensureStorageBackupSheet();
        const data = this.toStorageBackupRow(lot, new Date().toISOString());
        const rows = await sheet.getRows();
        const existing = rows.find(
            (row: any) => String(row.get('publicId') ?? '') === String(publicId)
        );
        if (existing) {
            for (const [key, value] of Object.entries(data)) existing.set(key, value as any);
            await existing.save();
        } else {
            await sheet.addRow(data as any);
        }
        return true;
    }

    private async clearSheetRows(sheet: any) {
        if (typeof sheet.clear === 'function') {
            await sheet.clear();
            return;
        }

        const rows = await sheet.getRows();
        if (!rows.length) return;

        for (const r of rows) {
            try {
                await r.delete();
            } catch {
                // ignore delete errors
            }
        }
    }

    private toBackupRow(order: any, backupAt: string) {
        const itemsJson = JSON.stringify(
            (order.items ?? []).map((i: any) => ({
                service: i.service,
                price: i.price,
                comment: i.comment ?? null,
                warrantyDays: i.warrantyDays ?? null,
                warrantyUntil: i.warrantyUntil
                    ? new Date(i.warrantyUntil).toISOString()
                    : null,
                createdAt: i.createdAt
                    ? new Date(i.createdAt).toISOString()
                    : null,
            }))
        );
        const photoFileIdsJson = JSON.stringify(
            (order.photos ?? []).map((p: any) => p.fileId)
        );

        return {
            backupVersion: BACKUP_VERSION,
            backupAt,
            publicId: String(order.publicId),
            status: order.status,
            clientPhone: order.clientPhone,
            clientEmail: order.clientEmail ?? '',
            acceptedByRole: order.acceptedBy?.role ?? '',
            acceptedByTgId: order.acceptedBy?.tgId
                ? String(order.acceptedBy.tgId)
                : '',
            acceptedByName: order.acceptedBy?.name ?? '',
            createdByRole: order.createdBy?.role ?? '',
            createdByTgId: order.createdBy?.tgId
                ? String(order.createdBy.tgId)
                : '',
            createdByName: order.createdBy?.name ?? '',
            assignedToRole: order.assignedTo?.role ?? '',
            assignedToTgId: order.assignedTo?.tgId
                ? String(order.assignedTo.tgId)
                : '',
            assignedToName: order.assignedTo?.name ?? '',
            estimateTotal:
                order.estimateTotal === null || order.estimateTotal === undefined
                    ? ''
                    : String(order.estimateTotal),
            finalTotal:
                order.finalTotal === null || order.finalTotal === undefined
                    ? ''
                    : String(order.finalTotal),
            photoFileId: order.photoFileId ?? '',
            photoFileIdsJson,
            createdAt: order.createdAt
                ? new Date(order.createdAt).toISOString()
                : '',
            updatedAt: order.updatedAt
                ? new Date(order.updatedAt).toISOString()
                : '',
            storageStartedAt: order.storageStartedAt
                ? new Date(order.storageStartedAt).toISOString()
                : '',
            doneAt: order.doneAt ? new Date(order.doneAt).toISOString() : '',
            itemsJson,
            storageFeePerDay:
                order.storageFeePerDay === null ||
                order.storageFeePerDay === undefined
                    ? ''
                    : String(order.storageFeePerDay),
        };
    }

    private async getOrderForBackup(publicId: number) {
        return this.prisma.order.findUnique({
            where: { publicId },
            include: {
                items: true,
                acceptedBy: { select: { name: true, tgId: true, role: true } },
                createdBy: { select: { name: true, tgId: true, role: true } },
                assignedTo: { select: { name: true, tgId: true, role: true } },
                photos: true,
            },
        });
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

    async backupAllOrdersToSheet(): Promise<{
        orders: number;
        items: number;
    }> {
        const sheet = await this.ensureBackupSheet();

        await this.clearSheetRows(sheet);
        await sheet.setHeaderRow(BACKUP_HEADERS);

        const orders = await this.prisma.order.findMany({
            include: {
                items: true,
                acceptedBy: { select: { name: true, tgId: true, role: true } },
                createdBy: { select: { name: true, tgId: true, role: true } },
                assignedTo: { select: { name: true, tgId: true, role: true } },
                photos: true,
            },
            orderBy: { createdAt: 'asc' },
        });

        const backupAt = new Date().toISOString();
        const rows = orders.map((o) => this.toBackupRow(o, backupAt));

        for (let i = 0; i < rows.length; i += BACKUP_BATCH_SIZE) {
            const chunk = rows.slice(i, i + BACKUP_BATCH_SIZE);
            if (chunk.length) {
                await sheet.addRows(chunk);
            }
        }

        const totalItems = orders.reduce(
            (sum, o) => sum + (o.items?.length ?? 0),
            0
        );

        this.log.log(
            `Backup saved: orders=${orders.length}, items=${totalItems}`
        );

        return { orders: orders.length, items: totalItems };
    }

    async backupOrderByPublicId(publicId: number): Promise<boolean> {
        const order = await this.getOrderForBackup(publicId);
        if (!order) return false;

        const sheet = await this.ensureBackupSheet();
        const backupAt = new Date().toISOString();
        const rowData = this.toBackupRow(order, backupAt);

        const rows = await sheet.getRows();
        const existing = rows.find(
            (r: any) =>
                String(r.get('publicId') ?? '').trim() ===
                String(publicId)
        );

        if (existing) {
            for (const [key, value] of Object.entries(rowData)) {
                existing.set(key, value as any);
            }
            await existing.save();
        } else {
            await sheet.addRow(rowData as any);
        }

        return true;
    }

    async removeOrderFromBackup(publicId: number): Promise<boolean> {
        const sheet = await this.ensureBackupSheet();
        const rows = await sheet.getRows();
        const existing = rows.find(
            (r: any) =>
                String(r.get('publicId') ?? '').trim() ===
                String(publicId)
        );

        if (!existing) return false;

        await existing.delete();
        return true;
    }

    private async ensureEmployee(
        tgId: bigint | null,
        name: string | null,
        role: StaffRole | null
    ): Promise<string | null> {
        if (!tgId) return null;

        const existing = await this.prisma.employee.findUnique({
            where: { tgId },
            select: { id: true },
        });
        if (existing) return existing.id;

        const safeRole: StaffRole = role ?? 'MASTER';
        const created = await this.prisma.employee.create({
            data: {
                tgId,
                name: name ?? null,
                role: safeRole,
                isActive: false,
            },
        });
        return created.id;
    }

    async restoreOrdersFromBackup(): Promise<{
        restored: number;
        skipped: number;
        items: number;
    }> {
        const sheet = await this.ensureBackupSheet();
        const rows = await sheet.getRows();

        let restored = 0;
        let skipped = 0;
        let itemsTotal = 0;

        for (const row of rows) {
            const publicId = parseNumber(row.get('publicId'));
            if (!publicId || publicId <= 0) {
                skipped++;
                continue;
            }

            const status =
                parseOrderStatus(row.get('status')) ?? OrderStatus.ACCEPTED;

            const clientPhone = String(row.get('clientPhone') ?? '').trim();
            if (!clientPhone) {
                skipped++;
                continue;
            }

            const acceptedByTgId = parseNumber(row.get('acceptedByTgId'));
            const createdByTgId = parseNumber(row.get('createdByTgId'));
            if (!acceptedByTgId || !createdByTgId) {
                skipped++;
                continue;
            }

            const acceptedByRole = normalizeRole(row.get('acceptedByRole'));
            const createdByRole = normalizeRole(row.get('createdByRole'));
            const assignedToRole = normalizeRole(row.get('assignedToRole'));

            const acceptedById = await this.ensureEmployee(
                BigInt(acceptedByTgId),
                String(row.get('acceptedByName') ?? '') || null,
                acceptedByRole
            );
            const createdById = await this.ensureEmployee(
                BigInt(createdByTgId),
                String(row.get('createdByName') ?? '') || null,
                createdByRole
            );

            if (!acceptedById || !createdById) {
                skipped++;
                continue;
            }

            const assignedToTgId = parseNumber(row.get('assignedToTgId'));
            const assignedToId = assignedToTgId
                ? await this.ensureEmployee(
                      BigInt(assignedToTgId),
                      String(row.get('assignedToName') ?? '') || null,
                      assignedToRole
                  )
                : null;

        let items: Array<{
                service: ServiceType;
                price: number;
                comment: string | null;
                warrantyDays: number | null;
                warrantyUntil: Date | null;
                createdAt?: Date | null;
            }> = [];
        let photoIds: string[] = [];

            try {
                const raw = row.get('itemsJson');
                const parsed = JSON.parse(String(raw || '[]'));
                if (Array.isArray(parsed)) {
                    items = parsed
                        .map((i: any) => {
                            const service = parseServiceType(i?.service);
                            if (!service) return null;
                            const price = parseNumber(i?.price) ?? 0;
                            const warrantyDays = parseNumber(i?.warrantyDays);
                            const warrantyUntil = parseDate(i?.warrantyUntil);
                            const createdAt = parseDate(i?.createdAt);
                            return {
                                service,
                                price: Math.trunc(price),
                                comment:
                                    i?.comment === undefined ||
                                    i?.comment === null
                                        ? null
                                        : String(i.comment),
                                warrantyDays:
                                    warrantyDays === null
                                        ? null
                                        : Math.trunc(warrantyDays),
                                warrantyUntil,
                                createdAt,
                            };
                        })
                        .filter(Boolean) as any;
                }
            } catch {
                // ignore malformed itemsJson
            }
            try {
                const raw = row.get('photoFileIdsJson');
                const parsed = JSON.parse(String(raw || '[]'));
                if (Array.isArray(parsed)) {
                    photoIds = parsed
                        .map((v: any) => String(v ?? '').trim())
                        .filter((v: string) => v);
                }
            } catch {
                // ignore malformed photoFileIdsJson
            }

            itemsTotal += items.length;

            const createdAt =
                parseDate(row.get('createdAt')) ?? new Date();
            const doneAt = parseDate(row.get('doneAt'));
            const storageStartedAt = parseDate(row.get('storageStartedAt'));
            const storageFeePerDay = parseNumber(row.get('storageFeePerDay'));

            await this.prisma.order.upsert({
                where: { publicId: Math.trunc(publicId) },
                create: {
                    publicId: Math.trunc(publicId),
                    status,
                    clientPhone,
                    clientEmail:
                        String(row.get('clientEmail') ?? '').trim() || null,
                    estimateTotal: parseNumber(row.get('estimateTotal')),
                    finalTotal: parseNumber(row.get('finalTotal')),
                    photoFileId: photoIds[0]
                        ? photoIds[0]
                        : String(row.get('photoFileId') ?? '').trim() || null,
                    createdAt,
                    storageStartedAt,
                    storageFeePerDay:
                        storageFeePerDay === null
                            ? null
                            : Math.trunc(storageFeePerDay),
                    doneAt,
                    acceptedBy: { connect: { id: acceptedById } },
                    createdBy: { connect: { id: createdById } },
                    ...(assignedToId
                        ? { assignedTo: { connect: { id: assignedToId } } }
                        : {}),
                    items: {
                        create: items.map((i) => ({
                            service: i.service,
                            price: i.price,
                            comment: i.comment,
                            warrantyDays: i.warrantyDays,
                            warrantyUntil:
                                i.warrantyUntil ??
                                (i.warrantyDays
                                    ? calcWarrantyUntil(
                                          createdAt,
                                          i.warrantyDays
                                      )
                                    : null),
                            createdAt: i.createdAt ?? createdAt,
                        })),
                    },
                    ...(photoIds.length
                        ? {
                              photos: {
                                  create: photoIds.map((fileId) => ({
                                      fileId,
                                  })),
                              },
                          }
                        : {}),
                },
                update: {
                    status,
                    clientPhone,
                    clientEmail:
                        String(row.get('clientEmail') ?? '').trim() || null,
                    estimateTotal: parseNumber(row.get('estimateTotal')),
                    finalTotal: parseNumber(row.get('finalTotal')),
                    photoFileId: photoIds[0]
                        ? photoIds[0]
                        : String(row.get('photoFileId') ?? '').trim() || null,
                    doneAt,
                    storageStartedAt,
                    storageFeePerDay:
                        storageFeePerDay === null
                            ? null
                            : Math.trunc(storageFeePerDay),
                    acceptedBy: { connect: { id: acceptedById } },
                    createdBy: { connect: { id: createdById } },
                    ...(assignedToId
                        ? { assignedTo: { connect: { id: assignedToId } } }
                        : { assignedTo: { disconnect: true } }),
                    items: {
                        deleteMany: {},
                        create: items.map((i) => ({
                            service: i.service,
                            price: i.price,
                            comment: i.comment,
                            warrantyDays: i.warrantyDays,
                            warrantyUntil:
                                i.warrantyUntil ??
                                (i.warrantyDays
                                    ? calcWarrantyUntil(
                                          createdAt,
                                          i.warrantyDays
                                      )
                                    : null),
                            createdAt: i.createdAt ?? createdAt,
                        })),
                    },
                    ...(photoIds.length
                        ? {
                              photos: {
                                  deleteMany: {},
                                  create: photoIds.map((fileId) => ({
                                      fileId,
                                  })),
                              },
                          }
                        : { photos: { deleteMany: {} } }),
                },
            });

            restored++;
        }

        this.log.log(
            `Restore done: restored=${restored}, skipped=${skipped}, items=${itemsTotal}`
        );

        try {
            await this.syncOrderPublicIdSequence();
        } catch (e) {
            this.log.warn('Failed to sync Order publicId sequence');
        }

        return { restored, skipped, items: itemsTotal };
    }

    private async syncOrderPublicIdSequence() {
        const res = (await this.prisma.$queryRawUnsafe(
            `SELECT pg_get_serial_sequence('"Order"', 'publicId') as seq`
        )) as Array<{ seq: string | null }>;

        const seq = res?.[0]?.seq;
        if (!seq) return;

        await this.prisma.$executeRawUnsafe(
            `SELECT setval('${seq}', (SELECT COALESCE(MAX("publicId"), 0) FROM "Order"))`
        );
    }
}
