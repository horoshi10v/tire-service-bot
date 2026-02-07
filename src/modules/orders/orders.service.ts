import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmployeeRole, OrderStatus } from '@prisma/client';
import {
    AddItemsInput,
    ChangeStatusInput,
    CreateOrderInput,
    FinalizeOrderInput,
    FinalizeOrderResult,
    SearchOrdersInput,
} from './orders.types';
import { OrderStateMachine } from '../../common/domain';
import {
    OrderNotFoundException,
    OrderAlreadyDoneException,
    ValidationException,
    InsufficientPermissionsException,
    UserNotActiveException,
} from '../../common/exceptions';
import type {
    IMailService,
    IPdfGenerator,
    IOrdersRepository,
} from '../../common/interfaces';
import {
    MAIL_SERVICE,
    PDF_GENERATOR,
    ORDERS_REPOSITORY,
} from '../../common/interfaces';
import { NotificationService } from '../notifications/notification-strategies';

/**
 * Normalizes phone number by removing non-digit characters
 */
function normalizePhone(p: string): string {
    return p.replace(/[^\d+]/g, '').trim();
}

/**
 * Calculates warranty expiration date
 */
function calcWarrantyUntil(base: Date, days?: number | null): Date | null {
    if (!days || days <= 0) return null;
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d;
}

/**
 * OrdersService - Application Service for order management
 *
 * SRP: Orchestrates order operations, delegates to specialized services
 * DIP: Depends on abstractions (could be improved with repository interface)
 */
@Injectable()
export class OrdersService {
    private readonly logger = new Logger(OrdersService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Inject(PDF_GENERATOR) private readonly warrantyPdf: IPdfGenerator,
        @Inject(MAIL_SERVICE) private readonly mail: IMailService,
        private readonly notificationService: NotificationService,
        @Inject(ORDERS_REPOSITORY)
        private readonly repository: IOrdersRepository
    ) {}

    /**
     * Permissions:
     * - MASTER can create/update their own work orders
     * - ADMIN can do everything
     */
    private async requireRole(tgId: bigint, roles: EmployeeRole[]) {
        const emp = await this.prisma.employee.findUnique({
            where: { tgId },
            select: { role: true, isActive: true, id: true, tgId: true },
        });

        if (!emp || !emp.isActive) throw new UserNotActiveException();
        if (!roles.includes(emp.role))
            throw new InsufficientPermissionsException();

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
            throw new ValidationException("Телефон клієнта обов'язковий");
        if (!input.items?.length)
            throw new ValidationException('Потрібна хоча б одна послуга');

        const now = new Date();

        const order = await this.prisma.order.create({
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

        await this.notificationService.notifyOrderCreated({
            orderId: order.id,
            publicId: order.publicId,
            clientPhone: order.clientPhone,
            createdByTgId: createdBy.tgId,
        });

        return order;
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
        if (!order) throw new OrderNotFoundException(input.orderPublicId);
        if (order.status === OrderStatus.DONE)
            throw new OrderAlreadyDoneException(input.orderPublicId);

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

        if (!order) throw new OrderNotFoundException(input.orderPublicId);

        if (OrderStateMachine.isFinalState(order.status)) {
            throw new OrderAlreadyDoneException(input.orderPublicId);
        }

        OrderStateMachine.validateTransition(order.status, input.status);

        if (input.status === OrderStatus.DONE) {
            throw new ValidationException(
                'Використовуйте finalizeOrder для завершення замовлення'
            );
        }

        if (order.assignedToId !== by.id) {
            await this.repository.transferAndUpdateStatus({
                orderId: order.id,
                fromMasterId: order.assignedToId,
                toMasterId: by.id,
                newStatus: input.status,
                transferredByTgId: by.tgId,
            });
        } else {
            // Same master, just update status
            await this.prisma.order.update({
                where: { id: order.id },
                data: { status: input.status },
            });
        }

        const updatedOrder = await this.prisma.order.findUnique({
            where: { id: order.id },
            include: {
                items: true,
                acceptedBy: { select: { name: true, tgId: true } },
                assignedTo: { select: { name: true, tgId: true } },
            },
        });

        if (updatedOrder) {
            await this.notificationService.notifyStatusChanged({
                orderId: updatedOrder.id,
                publicId: updatedOrder.publicId,
                fromStatus: order.status,
                toStatus: input.status,
                changedByTgId: by.tgId,
            });
        }

        return updatedOrder;
    }

    async finalizeOrder(
        input: FinalizeOrderInput
    ): Promise<FinalizeOrderResult> {
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
                createdBy: true,
                assignedTo: true,
            },
        });

        // 1. Generate PDF
        const pdfBytes = await this.warrantyPdf.generate(order);
        const pdfBuffer = Buffer.from(pdfBytes);

        // 2. Send email if provided
        if (order.clientEmail) {
            await this.mail.sendPdf(
                order.clientEmail,
                `Гарантія на замовлення #${order.publicId}`,
                `Вітаємо!\n\nУ вкладенні — гарантійний талон на виконані роботи.`,
                pdfBuffer,
                `warranty-${order.publicId}.pdf`
            );
        }

        // 3. Save to drafts for backup
        await this.mail.saveToDrafts(
            `Гарантійний талон #${order.publicId}`,
            `Замовлення #${order.publicId}\nКлієнт: ${order.clientPhone}\n${order.clientEmail ? `Email: ${order.clientEmail}` : 'Email не вказано'}\n\nГарантійний талон у вкладенні.`,
            pdfBuffer,
            `warranty-${order.publicId}.pdf`
        );

        // 4. Return order with PDF buffer for Telegram sending
        return { order, pdfBuffer };
    }

    async searchByPhone(input: SearchOrdersInput) {
        const phone = normalizePhone(input.phonePart);
        if (!phone)
            throw new ValidationException(
                "Частина номера телефону обов'язкова"
            );

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
        if (!order) throw new OrderNotFoundException(publicId);
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
