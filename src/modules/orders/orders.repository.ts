import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStatus, Prisma, ServiceType } from '@prisma/client';
import {
    CreateOrderData,
    IOrdersRepository,
    OrderWithRelations,
} from '../../common/interfaces';

@Injectable()
export class OrdersRepository implements IOrdersRepository {
    private readonly include = {
        items: true,
        photos: true,
        acceptedBy: { select: { name: true, tgId: true } },
        createdBy: { select: { name: true, tgId: true } },
        assignedTo: { select: { name: true, tgId: true } },
    };

    constructor(private readonly prisma: PrismaService) {}

    async create(data: CreateOrderData): Promise<OrderWithRelations> {
        return this.prisma.order.create({
            data: {
                clientPhone: data.clientPhone,
                status: data.status,
                estimateTotal: data.estimateTotal,
                photoFileId: data.photoFileId,
                acceptedBy: { connect: { id: data.acceptedById } },
                createdBy: { connect: { id: data.createdById } },
                items: {
                    create: data.items.map((i) => ({
                        service: i.service as ServiceType,
                        price: i.price,
                        comment: i.comment,
                        warrantyDays: i.warrantyDays,
                        warrantyUntil: i.warrantyUntil,
                    })),
                },
            },
            include: this.include,
        });
    }

    async findByPublicId(publicId: number): Promise<OrderWithRelations | null> {
        return this.prisma.order.findUnique({
            where: { publicId },
            include: this.include,
        });
    }

    async findByStatus(
        status: OrderStatus,
        skip: number,
        take: number
    ): Promise<OrderWithRelations[]> {
        return this.prisma.order.findMany({
            where: { status },
            orderBy: { createdAt: 'desc' },
            skip,
            take,
            include: this.include,
        });
    }

    async countByStatus(status: OrderStatus): Promise<number> {
        return this.prisma.order.count({ where: { status } });
    }

    async searchByPhone(
        phonePart: string,
        includeDone: boolean,
        limit: number
    ): Promise<OrderWithRelations[]> {
        return this.prisma.order.findMany({
            where: {
                clientPhone: { contains: phonePart },
                ...(includeDone ? {} : { status: { not: OrderStatus.DONE } }),
            },
            orderBy: { createdAt: 'desc' },
            take: Math.min(limit, 50),
            include: this.include,
        });
    }

    async update(
        id: string,
        data: Prisma.OrderUpdateInput
    ): Promise<OrderWithRelations> {
        return this.prisma.order.update({
            where: { id },
            data,
            include: this.include,
        });
    }

    async groupByStatus(): Promise<Record<OrderStatus, number>> {
        const result = await this.prisma.order.groupBy({
            by: ['status'],
            _count: { _all: true },
        });

        const map: Record<OrderStatus, number> = {
            ACCEPTED: 0,
            IN_PROGRESS: 0,
            READY: 0,
            STORAGE: 0,
            DONE: 0,
        };

        for (const r of result) {
            map[r.status] = r._count._all;
        }

        return map;
    }

    async addItems(
        orderId: string,
        items: Array<{
            service: string;
            price: number;
            comment: string | null;
            warrantyDays: number | null;
            warrantyUntil: Date | null;
        }>
    ): Promise<void> {
        await this.prisma.orderItem.createMany({
            data: items.map((i) => ({
                orderId,
                service: i.service as ServiceType,
                price: i.price,
                comment: i.comment,
                warrantyDays: i.warrantyDays,
                warrantyUntil: i.warrantyUntil,
            })),
        });
    }

    async getOrderSum(orderId: string): Promise<number | null> {
        const sum = await this.prisma.orderItem.aggregate({
            where: { orderId },
            _sum: { price: true },
        });
        return sum._sum.price;
    }

    /**
     * Transfer order to another master and update status in single transaction
     */
    async transferAndUpdateStatus(params: {
        orderId: string;
        fromMasterId: string | null;
        toMasterId: string;
        newStatus: OrderStatus;
        storageStartedAt: Date | null;
        storageFeePerDay: number | null;
        statusChangedById: string;
        transferredByTgId: bigint;
    }): Promise<void> {
        // Get employee ID from tgId
        const transferredBy = await this.prisma.employee.findUnique({
            where: { tgId: params.transferredByTgId },
            select: { id: true },
        });

        if (!transferredBy) {
            throw new Error('Employee not found');
        }

        await this.prisma.$transaction([
            this.prisma.order.update({
                where: { id: params.orderId },
                data: {
                    assignedToId: params.toMasterId,
                    status: params.newStatus,
                    storageStartedAt: params.storageStartedAt,
                    storageFeePerDay: params.storageFeePerDay,
                },
            }),
            this.prisma.orderTransfer.create({
                data: {
                    orderId: params.orderId,
                    fromId: params.fromMasterId,
                    toId: params.toMasterId,
                    byId: transferredBy.id,
                },
            }),
            this.prisma.orderStatusChange.create({
                data: {
                    orderId: params.orderId,
                    status: params.newStatus,
                    changedById: params.statusChangedById,
                },
            }),
        ]);
    }
}
