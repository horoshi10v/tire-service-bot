export type StaffRole = 'ADMIN' | 'MASTER';

export interface StaffRow {
    tgId: string;
    name?: string;
    role: StaffRole;
    active: string; // "TRUE"/"FALSE" or "true"/"false"
}
