-- AlterTable
ALTER TABLE "Book" ADD COLUMN     "error_message" TEXT,
ADD COLUMN     "processed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "processed_dir" TEXT;

-- CreateTable
CREATE TABLE "BookPage" (
    "id" SERIAL NOT NULL,
    "book_id" INTEGER NOT NULL,
    "page_number" INTEGER NOT NULL,
    "image_url" TEXT,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookPage_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BookPage" ADD CONSTRAINT "BookPage_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
