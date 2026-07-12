CREATE TABLE "OrderStatusChange" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderStatusChange_orderId_createdAt_idx"
ON "OrderStatusChange"("orderId", "createdAt");

CREATE INDEX "OrderStatusChange_changedById_status_idx"
ON "OrderStatusChange"("changedById", "status");

ALTER TABLE "OrderStatusChange"
ADD CONSTRAINT "OrderStatusChange_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderStatusChange"
ADD CONSTRAINT "OrderStatusChange_changedById_fkey"
FOREIGN KEY ("changedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
