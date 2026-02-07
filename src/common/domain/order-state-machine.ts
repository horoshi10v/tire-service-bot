import { OrderStatus } from '@prisma/client';
import { InvalidStatusTransitionException } from '../exceptions';

/**
 * State Machine Pattern for managing order status transitions
 */
export class OrderStateMachine {
    private static readonly transitions: Map<OrderStatus, OrderStatus[]> =
        new Map([
            [
                OrderStatus.ACCEPTED,
                [OrderStatus.IN_PROGRESS, OrderStatus.READY],
            ],
            [OrderStatus.IN_PROGRESS, [OrderStatus.READY, OrderStatus.DONE]],
            [OrderStatus.READY, [OrderStatus.DONE]],
            [OrderStatus.DONE, []], // Final state
        ]);

    /**
     * Checks if transition from current status to target is allowed
     */
    static canTransition(from: OrderStatus, to: OrderStatus): boolean {
        const allowed = this.transitions.get(from);
        return allowed?.includes(to) ?? false;
    }

    /**
     * Gets list of available transitions from current status
     */
    static getAvailableTransitions(from: OrderStatus): OrderStatus[] {
        return this.transitions.get(from) ?? [];
    }

    /**
     * Checks if status is a final state
     */
    static isFinalState(status: OrderStatus): boolean {
        return status === OrderStatus.DONE;
    }

    /**
     * Validates transition and throws error if not allowed
     */
    static validateTransition(from: OrderStatus, to: OrderStatus): void {
        if (this.isFinalState(from)) {
            throw new InvalidStatusTransitionException(from, to);
        }

        if (!this.canTransition(from, to)) {
            throw new InvalidStatusTransitionException(from, to);
        }
    }
}
