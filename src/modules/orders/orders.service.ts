import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmployeeRole, OrderStatus } from '@prisma/client';
import {
    AddItemsInput,
    ChangeStatusInput,
    CreateOrderInput,
    DeleteOrderInput,
    FinalizeOrderInput,
    FinalizeOrderResult,
    ReplaceItemsInput,
    SearchOrdersInput,
    UpdateOrderInput,
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
import { SheetsService } from '../integrations/sheets/sheets.service';

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
        private readonly repository: IOrdersRepository,
        private readonly sheets: SheetsService
    ) {}

    private async tryBackup(publicId: number) {
        try {
            await this.sheets.backupOrderByPublicId(publicId);
        } catch (e) {
            this.logger.warn(
                `Backup to Google Sheets failed for order #${publicId}`
            );
        }
    }

    async getStorageFeePerDay(): Promise<number> {
        const settings = await this.prisma.storageSettings.upsert({
            where: { id: 'default' },
            create: { id: 'default', feePerDay: 0 },
            update: {},
        });
        return settings.feePerDay;
    }

    async setStorageFeePerDay(feePerDay: number): Promise<number> {
        if (!Number.isInteger(feePerDay) || feePerDay < 0) {
            throw new ValidationException('Тариф має бути цілим числом від 0');
        }
        const settings = await this.prisma.storageSettings.upsert({
            where: { id: 'default' },
            create: { id: 'default', feePerDay },
            update: { feePerDay },
        });
        return settings.feePerDay;
    }

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

        const photoIds =
            input.photoFileIds?.length
                ? input.photoFileIds
                : input.photoFileId
                  ? [input.photoFileId]
                  : [];

        const createData = {
            data: {
                clientPhone,
                status: OrderStatus.ACCEPTED,
                estimateTotal: input.estimateTotal ?? null,
                photoFileId: photoIds[0] ?? null,

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
            include: {
                items: true,
                photos: true,
                acceptedBy: { select: { name: true, tgId: true } },
                createdBy: { select: { name: true, tgId: true } },
            },
        } as const;

        let order;
        try {
            order = await this.prisma.order.create(createData);
        } catch (e: any) {
            if (e?.code === 'P2002' && e?.meta?.modelName === 'Order') {
                await this.syncOrderPublicIdSequence();
                order = await this.prisma.order.create(createData);
            } else {
                throw e;
            }
        }

        await this.notificationService.notifyOrderCreated({
            orderId: order.id,
            publicId: order.publicId,
            clientPhone: order.clientPhone,
            createdByTgId: createdBy.tgId,
        });

        await this.tryBackup(order.publicId);

        return order;
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
            include: { items: true, photos: true },
        });
    }

    async updateOrder(input: UpdateOrderInput) {
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

        const data: any = {};
        if (input.clientPhone !== undefined) {
            const phone = normalizePhone(input.clientPhone);
            if (!phone)
                throw new ValidationException(
                    "Телефон клієнта обов'язковий"
                );
            data.clientPhone = phone;
        }
        if (input.estimateTotal !== undefined) {
            data.estimateTotal = input.estimateTotal;
        }
        if (input.clientEmail !== undefined) {
            data.clientEmail = input.clientEmail;
        }
        if (input.photoFileId !== undefined) {
            data.photoFileId = input.photoFileId;
        }

        const photoIds =
            input.photoFileIds !== undefined
                ? input.photoFileIds ?? []
                : input.photoFileId !== undefined
                  ? input.photoFileId
                      ? [input.photoFileId]
                      : []
                  : null;

        let updated;
        if (photoIds !== null) {
            const ops: any[] = [
                this.prisma.order.update({
                    where: { id: order.id },
                    data: {
                        ...data,
                        photoFileId: photoIds[0] ?? null,
                    },
                }),
                this.prisma.orderPhoto.deleteMany({
                    where: { orderId: order.id },
                }),
            ];

            if (photoIds.length) {
                ops.push(
                    this.prisma.orderPhoto.createMany({
                        data: photoIds.map((fileId) => ({
                            orderId: order.id,
                            fileId,
                        })),
                    })
                );
            }

            await this.prisma.$transaction(ops);
        } else {
            await this.prisma.order.update({
                where: { id: order.id },
                data,
            });
        }

        updated = await this.prisma.order.findUnique({
            where: { id: order.id },
            include: {
                items: true,
                photos: true,
                acceptedBy: { select: { name: true, tgId: true } },
                createdBy: { select: { name: true, tgId: true } },
                assignedTo: { select: { name: true, tgId: true } },
            },
        });

        if (updated) {
            await this.tryBackup(updated.publicId);
        }
        return updated;
    }

    async replaceItems(input: ReplaceItemsInput) {
        await this.requireRole(input.byTgId, [
            EmployeeRole.MASTER,
            EmployeeRole.ADMIN,
        ]);

        const order = await this.prisma.order.findUnique({
            where: { publicId: input.orderPublicId },
            select: { id: true, status: true, createdAt: true },
        });
        if (!order) throw new OrderNotFoundException(input.orderPublicId);
        if (order.status === OrderStatus.DONE)
            throw new OrderAlreadyDoneException(input.orderPublicId);

        if (!input.items?.length)
            throw new ValidationException('Потрібна хоча б одна послуга');

        const baseDate = order.createdAt ?? new Date();

        await this.prisma.$transaction([
            this.prisma.orderItem.deleteMany({
                where: { orderId: order.id },
            }),
            this.prisma.orderItem.createMany({
                data: input.items.map((i) => ({
                    orderId: order.id,
                    service: i.service,
                    price: Math.trunc(i.price),
                    comment: i.comment ?? null,
                    warrantyDays: i.warrantyDays ?? null,
                    warrantyUntil: calcWarrantyUntil(baseDate, i.warrantyDays),
                })),
            }),
        ]);

        const sum = await this.prisma.orderItem.aggregate({
            where: { orderId: order.id },
            _sum: { price: true },
        });

        const estimateTotal =
            input.estimateTotal !== undefined
                ? input.estimateTotal
                : sum._sum.price ?? null;

        const updated = await this.prisma.order.update({
            where: { id: order.id },
            data: { estimateTotal },
            include: {
                items: true,
                photos: true,
                acceptedBy: { select: { name: true, tgId: true } },
                createdBy: { select: { name: true, tgId: true } },
                assignedTo: { select: { name: true, tgId: true } },
            },
        });

        await this.tryBackup(updated.publicId);
        return updated;
    }

    async deleteOrder(input: DeleteOrderInput) {
        await this.requireRole(input.byTgId, [EmployeeRole.ADMIN]);

        const order = await this.prisma.order.findUnique({
            where: { publicId: input.orderPublicId },
            select: { id: true, publicId: true },
        });
        if (!order) throw new OrderNotFoundException(input.orderPublicId);

        await this.prisma.order.delete({ where: { id: order.id } });

        try {
            await this.sheets.removeOrderFromBackup(order.publicId);
        } catch {
            // ignore backup cleanup errors
        }

        return { publicId: order.publicId };
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

        const storageFeePerDay =
            input.status === OrderStatus.STORAGE
                ? (input.storageFeePerDay ??
                  (await this.getStorageFeePerDay()))
                : null;
        if (
            storageFeePerDay !== null &&
            (!Number.isInteger(storageFeePerDay) || storageFeePerDay < 0)
        ) {
            throw new ValidationException('Тариф має бути цілим числом від 0');
        }

        if (order.assignedToId !== by.id) {
            await this.repository.transferAndUpdateStatus({
                orderId: order.id,
                fromMasterId: order.assignedToId,
                toMasterId: by.id,
                newStatus: input.status,
                storageStartedAt:
                    input.status === OrderStatus.STORAGE ? new Date() : null,
                storageFeePerDay,
                statusChangedById: by.id,
                transferredByTgId: by.tgId,
            });
        } else {
            // Same master, just update status
            await this.prisma.$transaction([
                this.prisma.order.update({
                    where: { id: order.id },
                    data: {
                        status: input.status,
                        storageStartedAt:
                            input.status === OrderStatus.STORAGE
                                ? new Date()
                                : null,
                        storageFeePerDay,
                    },
                }),
                this.prisma.orderStatusChange.create({
                    data: {
                        orderId: order.id,
                        status: input.status,
                        changedById: by.id,
                    },
                }),
            ]);
        }

        const updatedOrder = await this.prisma.order.findUnique({
            where: { id: order.id },
            include: {
                items: true,
                photos: true,
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

            await this.tryBackup(updatedOrder.publicId);
        }

        return updatedOrder;
    }

    async finalizeOrder(
        input: FinalizeOrderInput
    ): Promise<FinalizeOrderResult> {
        const by = await this.requireRole(input.byTgId, [
            EmployeeRole.MASTER,
            EmployeeRole.ADMIN,
        ]);

        const existing = await this.prisma.order.findUnique({
            where: { publicId: input.orderPublicId },
            select: { id: true, status: true },
        });
        if (!existing) throw new OrderNotFoundException(input.orderPublicId);
        if (OrderStateMachine.isFinalState(existing.status)) {
            throw new OrderAlreadyDoneException(input.orderPublicId);
        }
        OrderStateMachine.validateTransition(existing.status, OrderStatus.DONE);

        const order = await this.prisma.$transaction(async (tx) => {
            const updated = await tx.order.update({
            where: { publicId: input.orderPublicId },
            data: {
                status: OrderStatus.DONE,
                finalTotal: Math.trunc(input.finalTotal),
                doneAt: input.doneAt ?? new Date(),
                clientEmail: input.clientEmail ?? null,
            },
            include: {
                items: true,
                photos: true,
                acceptedBy: true,
                createdBy: true,
                assignedTo: true,
            },
            });
            await tx.orderStatusChange.create({
                data: {
                    orderId: updated.id,
                    status: OrderStatus.DONE,
                    changedById: by.id,
                },
            });
            return updated;
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

        await this.tryBackup(order.publicId);

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
                photos: true,
                acceptedBy: { select: { name: true, tgId: true } },
            },
        });
    }

    async getByPublicId(publicId: number) {
        const order = await this.prisma.order.findUnique({
            where: { publicId },
            include: {
                items: true,
                photos: true,
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
                    photos: true,
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
            STORAGE: 0,
            DONE: 0,
        };

        for (const r of result) {
            map[r.status] = r._count._all;
        }

        return map;
    }

    async listStorageOverdue(days = 7) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        return this.prisma.order.findMany({
            where: {
                status: OrderStatus.STORAGE,
                storageStartedAt: { lte: cutoff },
            },
            orderBy: { storageStartedAt: 'asc' },
            take: 50,
            include: {
                items: true,
                photos: true,
                acceptedBy: { select: { name: true, tgId: true } },
            },
        });
    }

    async getPeriodStatistics(from: Date, to?: Date) {
        const orders = await this.prisma.order.findMany({
            where: {
                status: OrderStatus.DONE,
                doneAt: { gte: from, ...(to ? { lte: to } : {}) },
            },
            select: {
                finalTotal: true,
                statusChanges: {
                    where: { status: OrderStatus.DONE },
                    select: { changedById: true },
                },
            },
        });
        const revenueByEmployee = new Map<string, { count: number; total: number }>();
        for (const order of orders) {
            const issuerId = order.statusChanges[0]?.changedById;
            if (!issuerId) continue;
            const current = revenueByEmployee.get(issuerId) ?? { count: 0, total: 0 };
            current.count++;
            current.total += order.finalTotal ?? 0;
            revenueByEmployee.set(issuerId, current);
        }
        const employees = revenueByEmployee.size
            ? await this.prisma.employee.findMany({
                  where: { id: { in: [...revenueByEmployee.keys()] } },
                  select: { id: true, name: true },
              })
            : [];
        const names = new Map(employees.map((e) => [e.id, e.name || 'Без імені']));
        const total = orders.reduce((sum, order) => sum + (order.finalTotal ?? 0), 0);
        return {
            count: orders.length,
            total,
            average: orders.length ? Math.round(total / orders.length) : 0,
            issuedBy: [...revenueByEmployee.entries()].map(([id, value]) => ({
                name: names.get(id) ?? 'Без імені',
                count: value.count,
                total: value.total,
            })),
        };
    }

    async getEmployeeStatistics() {
        const [accepted, statusChanges, completedOrders] = await Promise.all([
            this.prisma.order.groupBy({
                by: ['acceptedById'],
                _count: { _all: true },
            }),
            this.prisma.orderStatusChange.groupBy({
                by: ['changedById', 'status'],
                _count: { _all: true },
            }),
            this.prisma.order.findMany({
                where: { status: OrderStatus.DONE },
                select: {
                    finalTotal: true,
                    statusChanges: {
                        where: { status: OrderStatus.DONE },
                        select: { changedById: true },
                    },
                },
            }),
        ]);

        const employeeIds = new Set<string>([
            ...accepted.map((row) => row.acceptedById),
            ...statusChanges.map((row) => row.changedById),
        ]);
        const employees = await this.prisma.employee.findMany({
            where: employeeIds.size
                ? {
                      OR: [
                          { isActive: true },
                          { id: { in: [...employeeIds] } },
                      ],
                  }
                : { isActive: true },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        });

        const acceptedById = new Map(
            accepted.map((row) => [row.acceptedById, row._count._all])
        );
        const changesByEmployee = new Map<string, Record<OrderStatus, number>>();
        const revenueByEmployee = new Map<string, number>();
        for (const order of completedOrders) {
            const issuerId = order.statusChanges[0]?.changedById;
            if (issuerId) {
                revenueByEmployee.set(
                    issuerId,
                    (revenueByEmployee.get(issuerId) ?? 0) + (order.finalTotal ?? 0)
                );
            }
        }
        for (const row of statusChanges) {
            const stats = changesByEmployee.get(row.changedById) ?? {
                ACCEPTED: 0,
                IN_PROGRESS: 0,
                READY: 0,
                STORAGE: 0,
                DONE: 0,
            };
            stats[row.status] = row._count._all;
            changesByEmployee.set(row.changedById, stats);
        }

        return employees.map((employee) => {
            const changes = changesByEmployee.get(employee.id) ?? {
                ACCEPTED: 0,
                IN_PROGRESS: 0,
                READY: 0,
                STORAGE: 0,
                DONE: 0,
            };
            return {
                name: employee.name || 'Без імені',
                accepted: acceptedById.get(employee.id) ?? 0,
                inProgress: changes.IN_PROGRESS,
                ready: changes.READY,
                storage: changes.STORAGE,
                done: changes.DONE,
                revenue: revenueByEmployee.get(employee.id) ?? 0,
            };
        });
    }
}
