/*
  Warnings:

  - You are about to drop the `BookComment` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "BookComment" DROP CONSTRAINT "BookComment_book_id_fkey";

-- DropForeignKey
ALTER TABLE "BookComment" DROP CONSTRAINT "BookComment_user_id_fkey";

-- AlterTable
ALTER TABLE "BookRating" ADD COLUMN     "comment" TEXT;

-- DropTable
DROP TABLE "BookComment";
