-- AlterTable
ALTER TABLE "BookAudio" ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'en';

-- CreateIndex
CREATE INDEX "BookAudio_language_idx" ON "BookAudio"("language");
