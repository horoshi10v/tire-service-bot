import { Order, OrderItem, Employee } from '@prisma/client';

/**
 * Typed order structure for PDF generation
 */
export type OrderWithDetails = Order & {
    items: OrderItem[];
    acceptedBy: Pick<Employee, 'name'> | null;
    assignedTo: Pick<Employee, 'name'> | null;
};

/**
 * Contract for PDF generation
 */
export interface IPdfGenerator {
    generate(order: OrderWithDetails): Promise<Buffer>;
}

export const PDF_GENERATOR = Symbol('IPdfGenerator');
