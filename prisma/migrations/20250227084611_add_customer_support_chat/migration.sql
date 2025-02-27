-- CreateTable
CREATE TABLE "CustomerSupportChat" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "admin_id" TEXT,
    "message" TEXT NOT NULL,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSupportChat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerSupportChat_user_id_idx" ON "CustomerSupportChat"("user_id");

-- CreateIndex
CREATE INDEX "CustomerSupportChat_admin_id_idx" ON "CustomerSupportChat"("admin_id");

-- AddForeignKey
ALTER TABLE "CustomerSupportChat" ADD CONSTRAINT "CustomerSupportChat_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
