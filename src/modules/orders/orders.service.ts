import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmployeeRole, OrderStatus, Prisma } from '@prisma/client';
import {
    AddItemsInput,
    ChangeStatusInput,
    CreateOrderInput,
    FinalizeOrderInput,
    SearchOrdersInput,
} from './orders.types';

const STATUS_FLOW: Record<OrderStatus, OrderStatus[]> = {
    ACCEPTED: ['IN_PROGRESS', 'READY', 'DONE'],
    IN_PROGRESS: ['READY', 'DONE'],
    READY: ['DONE'],
    DONE: [],
};

function normalizePhone(p: string) {
    return p.replace(/[^\d+]/g, '').trim();
}

function calcWarrantyUntil(
    base: Date,
    warrantyDays?: number | null
): Date | null {
    if (!warrantyDays || warrantyDays <= 0) return null;
    const d = new Date(base);
    d.setDate(d.getDate() + warrantyDays);
    return d;
}

@Injectable()
export class OrdersService {
    constructor(private prisma: PrismaService) {}

    /**
     * Permissions:
     * - MASTER can create/update their own work orders
     * - ADMIN can do everything
     */
    private async requireRole(tgId: bigint, roles: EmployeeRole[]) {
        const emp = await this.prisma.employee.findUnique({
            where: { tgId },
            select: { role: true, isActive: true, id: true },
        });

        if (!emp || !emp.isActive)
            throw new ForbiddenException('User is not active');
        if (!roles.includes(emp.role))
            throw new ForbiddenException('Not enough permissions');
        return emp;
    }

    async createOrder(input: CreateOrderInput) {
        const createdBy = await this.requireRole(input.createdByTgId, [
            EmployeeRole.MASTER,
            EmployeeRole.ADMIN,
        ]);
        const acceptedBy = await this.requireRole(input.acceptedByTgId, [
            EmployeeRole.MASTER,
            EmployeeRole.ADMIN,
        ]);

        const clientPhone = normalizePhone(input.clientPhone);
        if (!clientPhone)
            throw new BadRequestException('clientPhone is required');
        if (!input.items?.length)
            throw new BadRequestException(
                'At least one service item is required'
            );

        const sumItems = input.items.reduce(
            (s, it) => s + Number(it.price || 0),
            0
        );
        const estimateTotal = input.estimateTotal ?? (sumItems || null);

        const now = new Date();

        const data: Prisma.OrderCreateInput = {
            clientPhone,
            status: OrderStatus.ACCEPTED,
            estimateTotal: estimateTotal ?? null,
            finalTotal: null,
            photoFileId: input.photoFileId ?? null,

            acceptedBy: { connect: { id: acceptedBy.id } },
            createdBy: { connect: { id: createdBy.id } },

            items: {
                create: input.items.map((it) => ({
                    service: it.service,
                    price: Math.trunc(it.price),
                    comment: it.comment ?? null,
                    warrantyDays: it.warrantyDays ?? null,
                    warrantyUntil: calcWarrantyUntil(
                        now,
                        it.warrantyDays ?? null
                    ),
                })),
            },
        };

        return this.prisma.order.create({
            data,
            include: {
                acceptedBy: { select: { tgId: true, name: true, role: true } },
                createdBy: { select: { tgId: true, name: true, role: true } },
                items: true,
            },
        });
    }

    async addItems(input: AddItemsInput) {
        const by = await this.requireRole(input.byTgId, [
            EmployeeRole.MASTER,
            EmployeeRole.ADMIN,
        ]);

        const order = await this.prisma.order.findUnique({
            where: { publicId: input.orderPublicId },
            select: { id: true, status: true },
        });
        if (!order) throw new NotFoundException('Order not found');

        // после READY можно запретить добавление позиций (настроим правило)
        if (order.status === OrderStatus.DONE)
            throw new BadRequestException('Order already DONE');

        if (!input.items?.length)
            throw new BadRequestException('No items provided');

        const now = new Date();

        await this.prisma.orderItem.createMany({
            data: input.items.map((it) => ({
                orderId: order.id,
                service: it.service,
                price: Math.trunc(it.price),
                comment: it.comment ?? null,
                warrantyDays: it.warrantyDays ?? null,
                warrantyUntil: calcWarrantyUntil(now, it.warrantyDays ?? null),
            })),
            skipDuplicates: true, // если вдруг одинаковые позиции создадутся повторно (при ретраях)
        });

        // обновим estimateTotal = sum(items)
        const agg = await this.prisma.orderItem.aggregate({
            where: { orderId: order.id },
            _sum: { price: true },
        });

        return this.prisma.order.update({
            where: { id: order.id },
            data: { estimateTotal: agg._sum.price ?? null },
            include: { items: true },
        });
    }

    async changeStatus(input: ChangeStatusInput) {
        await this.requireRole(input.byTgId, [
            EmployeeRole.MASTER,
            EmployeeRole.ADMIN,
        ]);

        const order = await this.prisma.order.findUnique({
            where: { publicId: input.orderPublicId },
            select: { id: true, status: true, publicId: true },
        });
        if (!order) throw new NotFoundException('Order not found');

        if (order.status === OrderStatus.DONE)
            throw new BadRequestException('Order already DONE');

        const allowed = STATUS_FLOW[order.status] || [];
        if (!allowed.includes(input.status)) {
            throw new BadRequestException(
                `Invalid status transition: ${order.status} -> ${input.status}`
            );
        }

        // DONE делаем только через finalizeOrder (чтобы всегда была сумма)
        if (input.status === OrderStatus.DONE) {
            throw new BadRequestException(
                'Use finalizeOrder to set DONE with finalTotal'
            );
        }

        return this.prisma.order.update({
            where: { id: order.id },
            data: { status: input.status },
            include: { items: true },
        });
    }

    async finalizeOrder(input: FinalizeOrderInput) {
        await this.requireRole(input.byTgId, [
            EmployeeRole.MASTER,
            EmployeeRole.ADMIN,
        ]);

        const order = await this.prisma.order.findUnique({
            where: { publicId: input.orderPublicId },
            select: { id: true, status: true },
        });
        if (!order) throw new NotFoundException('Order not found');

        if (order.status === OrderStatus.DONE)
            throw new BadRequestException('Order already DONE');
        if (!input.finalTotal || input.finalTotal <= 0)
            throw new BadRequestException('finalTotal must be > 0');

        const doneAt = input.doneAt ?? new Date();

        return this.prisma.order.update({
            where: { id: order.id },
            data: {
                status: OrderStatus.DONE,
                finalTotal: Math.trunc(input.finalTotal),
                doneAt,
            },
            include: { items: true },
        });
    }

    async searchByPhone(input: SearchOrdersInput) {
        const phonePart = normalizePhone(input.phonePart);
        if (!phonePart) throw new BadRequestException('phonePart is required');

        const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);

        return this.prisma.order.findMany({
            where: {
                clientPhone: { contains: phonePart },
                ...(input.includeDone
                    ? {}
                    : { status: { not: OrderStatus.DONE } }),
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: {
                items: true,
                acceptedBy: { select: { name: true, tgId: true } },
            },
        });
    }

    async getByPublicId(publicId: number) {
        const order = await this.prisma.order.findUnique({
            where: { publicId },
            include: {
                items: true,
                acceptedBy: { select: { name: true, tgId: true, role: true } },
                createdBy: { select: { name: true, tgId: true, role: true } },
            },
        });
        if (!order) throw new NotFoundException('Order not found');
        return order;
    }

    async getByMaster(tgId: bigint) {
        return this.prisma.order.findMany({
            where: {
                acceptedBy: { tgId },
                status: { not: OrderStatus.DONE },
            },
            include: {
                items: true,
                acceptedBy: true,
                createdBy: true,
            },
            orderBy: { createdAt: 'desc' },
        });
    }
}
