-- CreateEnum
CREATE TYPE "EmployeeRole" AS ENUM ('ADMIN', 'MASTER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('ACCEPTED', 'IN_PROGRESS', 'READY', 'DONE');

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('TIRE_MOUNTING', 'STRAIGHTENING', 'WELDING', 'BALANCING', 'SIDE_REPAIR', 'INSPECTION', 'PUNCTURE', 'PAINTING', 'OTHER');

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "tgId" BIGINT NOT NULL,
    "name" TEXT,
    "role" "EmployeeRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "publicId" SERIAL NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'ACCEPTED',
    "clientPhone" TEXT NOT NULL,
    "clientEmail" TEXT,
    "acceptedById" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "estimateTotal" INTEGER,
    "finalTotal" INTEGER,
    "photoFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "service" "ServiceType" NOT NULL,
    "comment" TEXT,
    "price" INTEGER NOT NULL,
    "warrantyDays" INTEGER,
    "warrantyUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTransfer" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromId" TEXT,
    "toId" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_tgId_key" ON "Employee"("tgId");

-- CreateIndex
CREATE INDEX "Employee_role_isActive_idx" ON "Employee"("role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Order_publicId_key" ON "Order"("publicId");

-- CreateIndex
CREATE INDEX "Order_clientPhone_idx" ON "Order"("clientPhone");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_assignedToId_idx" ON "Order"("assignedToId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_service_idx" ON "OrderItem"("service");

-- CreateIndex
CREATE INDEX "OrderTransfer_orderId_idx" ON "OrderTransfer"("orderId");

-- CreateIndex
CREATE INDEX "OrderTransfer_fromId_idx" ON "OrderTransfer"("fromId");

-- CreateIndex
CREATE INDEX "OrderTransfer_toId_idx" ON "OrderTransfer"("toId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTransfer" ADD CONSTRAINT "OrderTransfer_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTransfer" ADD CONSTRAINT "OrderTransfer_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTransfer" ADD CONSTRAINT "OrderTransfer_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTransfer" ADD CONSTRAINT "OrderTransfer_byId_fkey" FOREIGN KEY ("byId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
