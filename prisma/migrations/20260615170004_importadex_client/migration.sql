/*
  Warnings:

  - A unique constraint covering the columns `[email]` on the table `importadex_clients` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `adress` to the `importadex_clients` table without a default value. This is not possible if the table is not empty.
  - Added the required column `email` to the `importadex_clients` table without a default value. This is not possible if the table is not empty.
  - Added the required column `identification` to the `importadex_clients` table without a default value. This is not possible if the table is not empty.
  - Added the required column `phone_home_office` to the `importadex_clients` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ImportadexTypeClient" AS ENUM ('PERSONAL', 'CORPORATIVE');

-- CreateEnum
CREATE TYPE "ImportadexTypeIdentification" AS ENUM ('DNI', 'RNC');

-- AlterTable
ALTER TABLE "importadex_clients" ADD COLUMN     "adress" TEXT NOT NULL,
ADD COLUMN     "birth_date" TEXT,
ADD COLUMN     "email" TEXT NOT NULL,
ADD COLUMN     "feedBack" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "identification" TEXT NOT NULL,
ADD COLUMN     "last_name" TEXT,
ADD COLUMN     "phone_home_office" TEXT NOT NULL,
ADD COLUMN     "phone_personal" TEXT,
ADD COLUMN     "type" "ImportadexTypeClient" NOT NULL DEFAULT 'PERSONAL',
ADD COLUMN     "type_identification" "ImportadexTypeIdentification" NOT NULL DEFAULT 'DNI';

-- CreateTable
CREATE TABLE "importadex_token_DGA" (
    "id" TEXT NOT NULL,
    "clientImportadex" TEXT NOT NULL,
    "current_commercial_registry" TEXT NOT NULL,
    "certification_current_rnc_registration" TEXT NOT NULL,
    "copy_manager_id" TEXT NOT NULL,
    "authorization_video" TEXT NOT NULL,

    CONSTRAINT "importadex_token_DGA_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "importadex_token_DGA_clientImportadex_key" ON "importadex_token_DGA"("clientImportadex");

-- CreateIndex
CREATE UNIQUE INDEX "importadex_clients_email_key" ON "importadex_clients"("email");

-- AddForeignKey
ALTER TABLE "importadex_token_DGA" ADD CONSTRAINT "importadex_token_DGA_clientImportadex_fkey" FOREIGN KEY ("clientImportadex") REFERENCES "importadex_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
