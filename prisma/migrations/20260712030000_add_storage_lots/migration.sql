CREATE TYPE "StorageLotType" AS ENUM ('TIRES', 'WHEELS', 'RIMS');
CREATE TYPE "StorageLotStatus" AS ENUM ('ACTIVE', 'RELEASED');

CREATE TABLE "StorageLot" (
    "id" TEXT NOT NULL,
    "publicId" SERIAL NOT NULL,
    "orderId" TEXT,
    "status" "StorageLotStatus" NOT NULL DEFAULT 'ACTIVE',
    "type" "StorageLotType" NOT NULL,
    "clientPhone" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "size" TEXT,
    "brand" TEXT,
    "wheelDetails" JSONB,
    "comment" TEXT,
    "photoFileId" TEXT,
    "feePerDay" INTEGER NOT NULL,
    "storedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    CONSTRAINT "StorageLot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StorageLot_publicId_key" ON "StorageLot"("publicId");
CREATE UNIQUE INDEX "StorageLot_orderId_key" ON "StorageLot"("orderId");
CREATE INDEX "StorageLot_status_storedAt_idx" ON "StorageLot"("status", "storedAt");
CREATE INDEX "StorageLot_clientPhone_idx" ON "StorageLot"("clientPhone");

ALTER TABLE "StorageLot" ADD CONSTRAINT "StorageLot_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StorageLot" ADD CONSTRAINT "StorageLot_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
