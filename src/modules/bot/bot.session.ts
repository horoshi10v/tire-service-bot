import type { ServiceType } from '@prisma/client';

export type BotFlow = 'create' | 'search' | 'finalize' | 'checkStatus' | null;

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

export interface OrderDraftItem {
    service: ServiceType;
    price: number;
    comment?: string | null;
    warrantyDays?: number | null;
}

export interface BotSessionData {
    flow: BotFlow;
    step?: CreateStep | SearchStep | FinalizeStep | OpenStep | CheckStatusStep;

    // create order flow
    photoFileId?: string;
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
}

export const DEFAULT_SESSION: BotSessionData = {
    flow: null,
    services: [],
    items: [],
};
