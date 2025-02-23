-- CreateTable
CREATE TABLE "Voice" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "speaker_id" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "gender" TEXT,
    "classification" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Voice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Voice_speaker_id_key" ON "Voice"("speaker_id");

-- CreateIndex
CREATE INDEX "Voice_language_idx" ON "Voice"("language");

-- CreateIndex
CREATE INDEX "Voice_classification_idx" ON "Voice"("classification");
