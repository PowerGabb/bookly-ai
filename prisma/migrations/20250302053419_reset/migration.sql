/*
  Warnings:

  - A unique constraint covering the columns `[referral_code]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "CreditTransaction" ADD COLUMN     "referral_code" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "referral_code" TEXT;

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referral_code" TEXT NOT NULL,
    "giver_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credit_type" TEXT NOT NULL,
    "credits_earned" INTEGER NOT NULL,
    "transaction_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Referral_referral_code_idx" ON "Referral"("referral_code");

-- CreateIndex
CREATE INDEX "Referral_giver_id_idx" ON "Referral"("giver_id");

-- CreateIndex
CREATE INDEX "Referral_user_id_idx" ON "Referral"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "User_referral_code_key" ON "User"("referral_code");

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_giver_id_fkey" FOREIGN KEY ("giver_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "CreditTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
