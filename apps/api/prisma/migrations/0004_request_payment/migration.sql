-- Request payment tracking (manual/offline methods; no gateway).
-- Payment must be confirmed before a refill request is completed.

ALTER TABLE "ServiceRequest"
  ADD COLUMN "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
  ADD COLUMN "paymentMethod" TEXT,
  ADD COLUMN "paymentAmountKobo" INTEGER,
  ADD COLUMN "paymentReference" TEXT,
  ADD COLUMN "paymentNote" TEXT,
  ADD COLUMN "paymentConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "paymentConfirmedById" TEXT;

CREATE INDEX "ServiceRequest_paymentStatus_idx" ON "ServiceRequest"("paymentStatus");
