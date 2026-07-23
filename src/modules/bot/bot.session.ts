import type { ServiceType } from '@prisma/client';
import type { StorageLotType } from '@prisma/client';

export type BotFlow =
    | 'create'
    | 'search'
    | 'finalize'
    | 'checkStatus'
    | 'edit'
    | 'editItems'
    | 'storageRate'
    | 'storageOrderRate'
    | 'customPeriod'
    | 'storageLot'
    | 'storageLotPhoto'
    | null;

export type CreateStep =
    | 'phone'
    | 'acceptedBySelect'
    | 'acceptedByManual'
    | 'services'
    | 'servicePrice'
    | 'serviceComment'
    | 'serviceWarranty'
    | 'estimateTotal';

export type SearchStep = 'phonePart';

export type FinalizeStep = 'finalTotal' | 'clientEmail';

export type OpenStep = 'openPublicId';

export type CheckStatusStep = 'waitingForOrderId';

export type EditStep =
    | 'editChoice'
    | 'editPhone'
    | 'editEstimate'
    | 'editEmail'
    | 'editPhoto';

export type StorageRateStep = 'storageFee';
export type StorageOrderRateStep = 'storageOrderFee';
export type CustomPeriodStep = 'periodFrom' | 'periodTo';
export type StorageLotStep =
    | 'storageLotPhone'
    | 'storageLotQuantity'
    | 'storageLotSize'
    | 'storageLotBrand'
    | 'storageLotTread'
    | 'storageLotDefects'
    | 'storageLotComment'
    | 'storageLotFee';
export type StorageLotPhotoStep = 'storageLotPhoto';

export interface OrderDraftItem {
    service: ServiceType;
    price: number;
    comment?: string | null;
    warrantyDays?: number | null;
}

export interface BotSessionData {
    flow: BotFlow;
    step?:
        | CreateStep
        | SearchStep
        | FinalizeStep
        | OpenStep
        | CheckStatusStep
        | EditStep
        | StorageRateStep
        | StorageOrderRateStep
        | CustomPeriodStep
        | StorageLotStep
        | StorageLotPhotoStep;

    // create order flow
    photoFileId?: string;
    photoFileIds?: string[];
    phone?: string;

    acceptedByName?: string;
    acceptedByTgId?: bigint;

    services: ServiceType[];
    items: OrderDraftItem[];
    pendingService?: ServiceType;

    // search flow
    phonePart?: string;

    // open order flow (from bottom menu)
    openPublicId?: number;

    // finalize flow
    finalizePublicId?: number;
    finalTotal?: number;
    clientEmail?: string; // client email
    storageOrderPublicId?: number;
    customPeriodFrom?: Date;

    storageLotType?: StorageLotType;
    storageLotQuantity?: number;
    storageLotSize?: string;
    storageLotBrand?: string;
    storageLotWheelIndex?: number;
    storageLotWheels?: Array<{ position: number; treadDepth?: string; defects?: string }>;
    storageLotComment?: string;
    storageLotPublicId?: number;

    // edit flow
    editPublicId?: number;
}

export const DEFAULT_SESSION: BotSessionData = {
    flow: null,
    services: [],
    items: [],
};
