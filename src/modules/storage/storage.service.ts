import { Injectable } from '@nestjs/common';
import { EmployeeRole, StorageLotStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SheetsService } from '../integrations/sheets/sheets.service';
import { CreateStorageLotInput } from './storage.types';

@Injectable()
export class StorageService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly sheets: SheetsService
    ) {}

    private async getEmployeeId(tgId: bigint) {
        const employee = await this.prisma.employee.findUnique({
            where: { tgId },
            select: { id: true, role: true, isActive: true },
        });
        if (
            !employee?.isActive ||
            ![EmployeeRole.ADMIN, EmployeeRole.MASTER].includes(employee.role)
        ) {
            throw new Error('Недостатньо прав');
        }
        return employee.id;
    }

    async create(input: CreateStorageLotInput) {
        const createdById = await this.getEmployeeId(input.byTgId);
        if (!input.clientPhone.trim()) throw new Error('Телефон обов’язковий');
        if (!Number.isInteger(input.quantity) || input.quantity < 1) {
            throw new Error('Кількість має бути не менше 1');
        }
        if (!Number.isInteger(input.feePerDay) || input.feePerDay < 0) {
            throw new Error('Некоректний тариф');
        }

        let orderId: string | undefined;
        if (input.orderPublicId) {
            const order = await this.prisma.order.findUnique({
                where: { publicId: input.orderPublicId },
                select: { id: true },
            });
            if (!order) throw new Error('Замовлення не знайдено');
            orderId = order.id;
        }

        const lot = await this.prisma.storageLot.create({
            data: {
                clientPhone: input.clientPhone.trim(),
                type: input.type,
                quantity: input.quantity,
                size: input.size?.trim() || null,
                brand: input.brand?.trim() || null,
                wheelDetails: input.wheelDetails?.length
                    ? (input.wheelDetails as any)
                    : undefined,
                comment: input.comment?.trim() || null,
                photoFileId: input.photoFileId ?? null,
                feePerDay: input.feePerDay,
                createdById,
                ...(orderId ? { orderId } : {}),
            },
            include: { createdBy: { select: { name: true } } },
        });
        await this.sheets.backupStorageLotByPublicId(lot.publicId);
        return lot;
    }

    async listActive(page: number, pageSize: number) {
        const [items, total] = await Promise.all([
            this.prisma.storageLot.findMany({
                where: { status: StorageLotStatus.ACTIVE },
                orderBy: { storedAt: 'asc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            this.prisma.storageLot.count({
                where: { status: StorageLotStatus.ACTIVE },
            }),
        ]);
        return { items, total };
    }

    async getByPublicId(publicId: number) {
        return this.prisma.storageLot.findUnique({ where: { publicId } });
    }
}
