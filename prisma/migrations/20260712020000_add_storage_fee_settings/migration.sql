ALTER TABLE "Order" ADD COLUMN "storageFeePerDay" INTEGER;

CREATE TABLE "StorageSettings" (
    "id" TEXT NOT NULL,
    "feePerDay" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StorageSettings_pkey" PRIMARY KEY ("id")
);
