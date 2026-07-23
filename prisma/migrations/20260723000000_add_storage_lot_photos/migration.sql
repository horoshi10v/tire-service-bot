CREATE TABLE "StorageLotPhoto" (
    "id" TEXT NOT NULL,
    "storageLotId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StorageLotPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StorageLotPhoto_storageLotId_idx" ON "StorageLotPhoto"("storageLotId");

ALTER TABLE "StorageLotPhoto" ADD CONSTRAINT "StorageLotPhoto_storageLotId_fkey"
FOREIGN KEY ("storageLotId") REFERENCES "StorageLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "StorageLotPhoto" ("id", "storageLotId", "fileId", "createdAt")
SELECT 'legacy_' || "id", "id", "photoFileId", "createdAt"
FROM "StorageLot"
WHERE "photoFileId" IS NOT NULL;
