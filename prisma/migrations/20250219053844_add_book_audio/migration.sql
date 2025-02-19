-- CreateTable
CREATE TABLE "BookAudio" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "book_id" INTEGER NOT NULL,
    "page_number" INTEGER NOT NULL,
    "file_url" TEXT NOT NULL,
    "voice" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookAudio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookAudio_user_id_idx" ON "BookAudio"("user_id");

-- CreateIndex
CREATE INDEX "BookAudio_book_id_idx" ON "BookAudio"("book_id");

-- CreateIndex
CREATE INDEX "BookAudio_page_number_idx" ON "BookAudio"("page_number");

-- AddForeignKey
ALTER TABLE "BookAudio" ADD CONSTRAINT "BookAudio_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookAudio" ADD CONSTRAINT "BookAudio_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
