import {
    Injectable,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SERVICE_LABELS } from '../bot/keyboards';
import * as crypto from 'crypto';

@Injectable()
export class WarrantyVerificationService {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * Verify warranty by order public ID and token
     * Anyone can verify warranty if they have the correct token
     */
    async verifyWarranty(publicId: number, token: string) {
        const order = await this.prisma.order.findUnique({
            where: { publicId },
            select: {
                id: true,
                publicId: true,
                clientPhone: true,
                status: true,
                finalTotal: true,
                doneAt: true,
                items: {
                    select: {
                        service: true,
                        price: true,
                        comment: true,
                        warrantyDays: true,
                        warrantyUntil: true,
                    },
                },
                acceptedBy: {
                    select: { name: true },
                },
                assignedTo: {
                    select: { name: true },
                },
            },
        });

        if (!order) {
            throw new NotFoundException('Order not found');
        }

        // Generate expected token
        const expectedToken = crypto
            .createHash('sha256')
            .update(`${order.publicId}:${order.clientPhone}`)
            .digest('hex')
            .slice(0, 16);

        if (token !== expectedToken) {
            throw new BadRequestException('Invalid verification token');
        }

        // Check if order is completed
        if (order.status !== 'DONE') {
            throw new BadRequestException('Order is not completed yet');
        }

        // Return warranty information
        return {
            orderId: order.publicId,
            status: 'VALID',
            completedAt: order.doneAt,
            totalAmount: order.finalTotal,
            master:
                order.assignedTo?.name || order.acceptedBy?.name || 'Unknown',
            services: order.items.map((item) => ({
                service: SERVICE_LABELS[item.service] || item.service,
                price: item.price,
                comment: item.comment,
                warrantyDays: item.warrantyDays,
                warrantyUntil: item.warrantyUntil,
                isWarrantyActive: item.warrantyUntil
                    ? new Date() <= item.warrantyUntil
                    : false,
            })),
        };
    }

    /**
     * Get order status by public ID (without sensitive data)
     * This can be used for basic order status checking
     */
    async getOrderStatus(publicId: number) {
        const order = await this.prisma.order.findUnique({
            where: { publicId },
            select: {
                publicId: true,
                status: true,
                estimateTotal: true,
                finalTotal: true,
                doneAt: true,
                items: {
                    select: {
                        service: true,
                        price: true,
                    },
                },
            },
        });

        if (!order) {
            throw new NotFoundException('Order not found');
        }

        return {
            orderId: order.publicId,
            status: order.status,
            estimatedTotal: order.estimateTotal,
            finalTotal: order.finalTotal,
            completedAt: order.doneAt,
            servicesCount: order.items.length,
        };
    }

    /**
     * Generate verification URL for QR code
     */
    generateVerificationUrl(publicId: number, clientPhone: string): string {
        const token = crypto
            .createHash('sha256')
            .update(`${publicId}:${clientPhone}`)
            .digest('hex')
            .slice(0, 16);

        return `https://t.me/shina_dp_bot?start=verify_${publicId}_${token}`;
    }

    /**
     * Parse verification command from Telegram
     * Example: "/start verify_1234_abc123def456"
     */
    parseVerificationCommand(
        text: string
    ): { publicId: number; token: string } | null {
        const match = text.match(/^\/start verify_(\d+)_([a-f0-9]+)$/);
        if (!match) return null;

        return {
            publicId: parseInt(match[1], 10),
            token: match[2],
        };
    }
}
