import { StorageLotType } from '@prisma/client';

export type StorageWheelDetail = {
    position: number;
    treadDepth?: string | null;
    defects?: string | null;
};

export type CreateStorageLotInput = {
    byTgId: bigint;
    clientPhone: string;
    type: StorageLotType;
    quantity: number;
    size?: string | null;
    brand?: string | null;
    wheelDetails?: StorageWheelDetail[];
    comment?: string | null;
    photoFileIds?: string[];
    feePerDay: number;
    orderPublicId?: number;
};
