/*
  Warnings:

  - You are about to drop the column `payment_intent_id` on the `Transaction` table. All the data in the column will be lost.
  - You are about to drop the column `stripe_subscription_id` on the `Transaction` table. All the data in the column will be lost.
  - You are about to drop the column `stripe_customer_id` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `stripe_subscription_id` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Transaction" DROP COLUMN "payment_intent_id",
DROP COLUMN "stripe_subscription_id";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "stripe_customer_id",
DROP COLUMN "stripe_subscription_id";
