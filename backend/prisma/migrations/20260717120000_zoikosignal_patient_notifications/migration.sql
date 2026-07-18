-- ZoikoSignal™ patient notifications: per-user availability alerts + channel prefs,
-- plus saved-medicine priority and last-notified status for transition detection.

-- CreateEnum
CREATE TYPE "MedicinePriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "SignalNotificationType" AS ENUM ('RUNNING_LOW', 'BACK_IN_STOCK', 'LIMITED', 'NEARBY_RESTOCK', 'RECALL', 'SAFETY');

-- AlterTable
ALTER TABLE "SavedMedicine"
    ADD COLUMN "priority" "MedicinePriority" NOT NULL DEFAULT 'MEDIUM',
    ADD COLUMN "notifiedStatus" TEXT;

-- CreateTable
CREATE TABLE "SignalNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "type" "SignalNotificationType" NOT NULL,
    "medicineId" TEXT,
    "medicineName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "actionLabel" TEXT,
    "actionKind" TEXT,
    "actionQuery" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignalNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignalNotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runningLow" BOOLEAN NOT NULL DEFAULT true,
    "backInStock" BOOLEAN NOT NULL DEFAULT true,
    "nearbyRestock" BOOLEAN NOT NULL DEFAULT true,
    "recall" BOOLEAN NOT NULL DEFAULT true,
    "safety" BOOLEAN NOT NULL DEFAULT true,
    "push" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "sms" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignalNotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignalNotification_userId_dedupeKey_key" ON "SignalNotification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "SignalNotification_userId_dismissed_archived_idx" ON "SignalNotification"("userId", "dismissed", "archived");

-- CreateIndex
CREATE UNIQUE INDEX "SignalNotificationPreference_userId_key" ON "SignalNotificationPreference"("userId");

-- AddForeignKey
ALTER TABLE "SignalNotification" ADD CONSTRAINT "SignalNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalNotification" ADD CONSTRAINT "SignalNotification_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "MedicineEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalNotificationPreference" ADD CONSTRAINT "SignalNotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
