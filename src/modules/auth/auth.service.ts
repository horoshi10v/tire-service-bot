import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmployeeRole } from '@prisma/client';

@Injectable()
export class AuthService {
    constructor(private prisma: PrismaService) {}

    async isAdmin(tgId: number | bigint): Promise<boolean> {
        const user = await this.prisma.employee.findUnique({
            where: { tgId: BigInt(tgId) },
            select: { role: true, isActive: true },
        });
        return !!user && user.isActive && user.role === EmployeeRole.ADMIN;
    }

    async isMaster(tgId: number | bigint): Promise<boolean> {
        const user = await this.prisma.employee.findUnique({
            where: { tgId: BigInt(tgId) },
            select: { role: true, isActive: true },
        });
        return !!user && user.isActive && user.role === EmployeeRole.MASTER;
    }

    async getActiveAdminTgIds(): Promise<bigint[]> {
        const admins = await this.prisma.employee.findMany({
            where: { role: EmployeeRole.ADMIN, isActive: true },
            select: { tgId: true },
        });
        return admins.map((a) => a.tgId);
    }

    async getActiveStaff(): Promise<{ tgId: bigint; name: string }[]> {
        const staff = await this.prisma.employee.findMany({
            where: { isActive: true },
            select: { tgId: true, name: true },
            orderBy: { name: 'asc' },
        });

        return staff
            .filter((s) => !!s.name)
            .map((s) => ({
                tgId: s.tgId,
                name: s.name!,
            }));
    }
}
