-- AlterTable
ALTER TABLE "importadex_cargo_items" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "importadex_containers" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "importadex_customs_files" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "importadex_documents" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "importadex_incidents" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "importadex_operations" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "importadex_shipments" ALTER COLUMN "updated_at" DROP DEFAULT;
