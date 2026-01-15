import { OrderStatus, ServiceType } from '@prisma/client';

export type BotFlow = 'create' | 'search' | 'finalize' | null;

export interface BotSessionData {
    flow: BotFlow;
    step?: string;

    // create order flow
    photoFileId?: string;
    phone?: string;
    acceptedByName?: string;
    services?: ServiceType[];
    items?: Array<{
        service: ServiceType;
        price: number;
        comment?: string | null;
        warrantyDays?: number | null;
    }>;

    // temp fields
    pendingService?: ServiceType;

    // search flow
    phonePart?: string;

    // finalize flow
    finalizePublicId?: number;
}
