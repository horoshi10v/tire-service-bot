import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../../modules/auth/auth.service';

/**
 * Guard for role-based access control in Telegram bot
 *
 * Role hierarchy:
 * - ADMIN: Full access to all orders and system management
 * - MASTER: Can create/manage orders, limited admin functions
 * - USER: Can only verify warranty and check order status by verification token
 */
export enum UserRole {
    ADMIN = 'ADMIN',
    MASTER = 'MASTER',
    USER = 'USER', // Regular users who can verify warranty
}

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) =>
    Reflect.metadata(ROLES_KEY, roles);

export const PUBLIC_KEY = 'isPublic';
export const Public = () => Reflect.metadata(PUBLIC_KEY, true);

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly authService: AuthService
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        // Check if route is public (no authentication needed)
        const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (isPublic) {
            return true;
        }

        const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
            ROLES_KEY,
            [context.getHandler(), context.getClass()]
        );

        // Get Telegram context
        const ctx = context.getArgByIndex(0);
        const tgId = ctx?.from?.id;

        if (!tgId) {
            throw new UnauthorizedException('Користувача не ідентифіковано');
        }

        const userTgId = BigInt(tgId);

        // If no specific roles required, allow access by default
        // This makes the bot accessible to all users unless explicitly restricted
        if (!requiredRoles || requiredRoles.length === 0) {
            return true;
        }

        // Check specific role requirements
        const hasAccess = await this.checkUserRoles(userTgId, requiredRoles);

        if (!hasAccess) {
            throw new ForbiddenException(
                this.getAccessDeniedMessage(requiredRoles)
            );
        }

        return true;
    }

    /**
     * Check if user has any of the required roles
     */
    private async checkUserRoles(
        tgId: bigint,
        requiredRoles: UserRole[]
    ): Promise<boolean> {
        // Check employee roles (ADMIN/MASTER)
        for (const role of requiredRoles) {
            switch (role) {
                case UserRole.ADMIN:
                    if (await this.authService.isAdmin(tgId)) return true;
                    break;
                case UserRole.MASTER:
                    if (await this.authService.isMaster(tgId)) return true;
                    break;
                case UserRole.USER:
                    // Regular users are always allowed if USER role is specified
                    return true;
            }
        }

        return false;
    }

    /**
     * Generate user-friendly access denied message
     */
    private getAccessDeniedMessage(requiredRoles: UserRole[]): string {
        if (requiredRoles.includes(UserRole.ADMIN)) {
            return '❌ Потрібен доступ адміністратора';
        }

        if (requiredRoles.includes(UserRole.MASTER)) {
            return '❌ Потрібен доступ майстра або адміністратора';
        }

        return '❌ Доступ заборонено. Зверніться до адміністратора.';
    }
}
