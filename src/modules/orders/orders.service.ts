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
import { WarrantyPdfService } from '../pdf/warranty-pdf.service';
import { MailService } from '../mail/mail.service';

const STATUS_FLOW: Record<OrderStatus, OrderStatus[]> = {
    ACCEPTED: ['IN_PROGRESS', 'READY', 'DONE'],
    IN_PROGRESS: ['READY', 'DONE'],
    READY: ['DONE'],
    DONE: [],
};

function normalizePhone(p: string) {
    return p.replace(/[^\d+]/g, '').trim();
}

function calcWarrantyUntil(base: Date, days?: number | null): Date | null {
    if (!days || days <= 0) return null;
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d;
}

@Injectable()
export class OrdersService {
    constructor(
        private prisma: PrismaService,
        private warrantyPdf: WarrantyPdfService,
        private mail: MailService
    ) {}

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
            throw new BadRequestException('At least one service is required');

        const now = new Date();

        return this.prisma.order.create({
            data: {
                clientPhone,
                status: OrderStatus.ACCEPTED,
                estimateTotal: input.estimateTotal ?? null,
                photoFileId: input.photoFileId ?? null,

                acceptedBy: { connect: { id: acceptedBy.id } },
                createdBy: { connect: { id: createdBy.id } },

                items: {
                    create: input.items.map((i) => ({
                        service: i.service,
                        price: Math.trunc(i.price),
                        comment: i.comment ?? null,
                        warrantyDays: i.warrantyDays ?? null,
                        warrantyUntil: calcWarrantyUntil(now, i.warrantyDays),
                    })),
                },
            },
            include: {
                items: true,
                acceptedBy: { select: { name: true, tgId: true } },
                createdBy: { select: { name: true, tgId: true } },
            },
        });
    }

    async addItems(input: AddItemsInput) {
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

        const now = new Date();

        await this.prisma.orderItem.createMany({
            data: input.items.map((i) => ({
                orderId: order.id,
                service: i.service,
                price: Math.trunc(i.price),
                comment: i.comment ?? null,
                warrantyDays: i.warrantyDays ?? null,
                warrantyUntil: calcWarrantyUntil(now, i.warrantyDays),
            })),
        });

        const sum = await this.prisma.orderItem.aggregate({
            where: { orderId: order.id },
            _sum: { price: true },
        });

        return this.prisma.order.update({
            where: { id: order.id },
            data: { estimateTotal: sum._sum.price ?? null },
            include: { items: true },
        });
    }

    async changeStatus(input: ChangeStatusInput) {
        const by = await this.requireRole(input.byTgId, [
            EmployeeRole.MASTER,
            EmployeeRole.ADMIN,
        ]);

        const order = await this.prisma.order.findUnique({
            where: { publicId: input.orderPublicId },
            select: {
                id: true,
                status: true,
                assignedToId: true,
            },
        });

        if (!order) throw new NotFoundException('Order not found');

        if (order.status === OrderStatus.DONE) {
            throw new BadRequestException('Order already DONE');
        }

        const allowed = STATUS_FLOW[order.status] || [];
        if (!allowed.includes(input.status)) {
            throw new BadRequestException(
                `Invalid status transition: ${order.status} -> ${input.status}`
            );
        }

        if (input.status === OrderStatus.DONE) {
            throw new BadRequestException('Use finalizeOrder to set DONE');
        }

        const ops: Prisma.PrismaPromise<any>[] = [];

        // Автоперехват заказа, если работает другой мастер
        if (order.assignedToId !== by.id) {
            ops.push(
                this.prisma.order.update({
                    where: { id: order.id },
                    data: { assignedToId: by.id },
                }),
                this.prisma.orderTransfer.create({
                    data: {
                        orderId: order.id,
                        fromId: order.assignedToId,
                        toId: by.id,
                        byId: by.id,
                    },
                })
            );
        }

        // Обновление статуса
        ops.push(
            this.prisma.order.update({
                where: { id: order.id },
                data: { status: input.status },
            })
        );

        await this.prisma.$transaction(ops);

        return this.prisma.order.findUnique({
            where: { id: order.id },
            include: {
                items: true,
                acceptedBy: { select: { name: true, tgId: true } },
                assignedTo: { select: { name: true, tgId: true } },
            },
        });
    }

    async finalizeOrder(input: FinalizeOrderInput) {
        const order = await this.prisma.order.update({
            where: { publicId: input.orderPublicId },
            data: {
                status: OrderStatus.DONE,
                finalTotal: Math.trunc(input.finalTotal),
                doneAt: input.doneAt ?? new Date(),
                clientEmail: input.clientEmail ?? null,
            },
            include: {
                items: true,
                acceptedBy: true,
                assignedTo: true,
            },
        });

        // 1. Генерируем PDF
        const pdfBytes = await this.warrantyPdf.generate(order);
        const pdfBuffer = Buffer.from(pdfBytes);

        // 2. Отправляем email
        if (order.clientEmail) {
            await this.mail.sendPdf(
                order.clientEmail,
                `Гарантія на замовлення #${order.publicId}`,
                `Вітаємо!\n\nУ вкладенні — гарантійний талон на виконані роботи.`,
                pdfBuffer,
                `warranty-${order.publicId}.pdf`
            );
        }

        return order;
    }

    async searchByPhone(input: SearchOrdersInput) {
        const phone = normalizePhone(input.phonePart);
        if (!phone) throw new BadRequestException('phonePart is required');

        return this.prisma.order.findMany({
            where: {
                clientPhone: { contains: phone },
                ...(input.includeDone
                    ? {}
                    : { status: { not: OrderStatus.DONE } }),
            },
            orderBy: { createdAt: 'desc' },
            take: Math.min(input.limit ?? 20, 50),
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
                acceptedBy: { select: { name: true, tgId: true } },
                createdBy: { select: { name: true, tgId: true } },
            },
        });
        if (!order) throw new NotFoundException('Order not found');
        return order;
    }

    async listByStatus(input: {
        status: OrderStatus;
        page: number;
        pageSize: number;
    }) {
        const { status, page, pageSize } = input;

        const [items, total] = await this.prisma.$transaction([
            this.prisma.order.findMany({
                where: { status },
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
                include: {
                    items: true,
                    acceptedBy: { select: { name: true, tgId: true } },
                },
            }),
            this.prisma.order.count({ where: { status } }),
        ]);

        return { items, total };
    }

    async countByStatus() {
        const result = await this.prisma.order.groupBy({
            by: ['status'],
            _count: { _all: true },
        });

        const map: Record<OrderStatus, number> = {
            ACCEPTED: 0,
            IN_PROGRESS: 0,
            READY: 0,
            DONE: 0,
        };

        for (const r of result) {
            map[r.status] = r._count._all;
        }

        return map;
    }
}
