/*
  Warnings:

  - A unique constraint covering the columns `[hash]` on the table `Question` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."Question" ADD COLUMN     "hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Question_hash_key" ON "public"."Question"("hash");

-- CreateIndex
CREATE INDEX "Question_category_idx" ON "public"."Question"("category");
