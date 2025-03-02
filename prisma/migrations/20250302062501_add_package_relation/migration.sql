-- Step 1: Add the package_id column as nullable first
ALTER TABLE "CreditTransaction" 
ADD COLUMN IF NOT EXISTS "package_id" INTEGER;

-- Step 2: Create the relationship between CreditPackage and CreditTransaction
ALTER TABLE "CreditTransaction"
ADD CONSTRAINT "CreditTransaction_package_id_fkey"
FOREIGN KEY ("package_id") REFERENCES "CreditPackage"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Step 3: Create the index
CREATE INDEX IF NOT EXISTS "CreditTransaction_package_id_idx" 
ON "CreditTransaction"("package_id");

-- Step 4: Make sure we have at least one CreditPackage
INSERT INTO "CreditPackage" ("name", "credit_type", "credits", "price", "is_active", "created_at", "updated_at")
SELECT 'Default Package', 'AI_CHAT', 100, 10000, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "CreditPackage" LIMIT 1);

-- Step 5: Update existing transactions with a default package_id
UPDATE "CreditTransaction"
SET "package_id" = (SELECT id FROM "CreditPackage" ORDER BY id LIMIT 1)
WHERE "package_id" IS NULL;

-- Step 6: Now make the package_id column NOT NULL
ALTER TABLE "CreditTransaction"
ALTER COLUMN "package_id" SET NOT NULL;