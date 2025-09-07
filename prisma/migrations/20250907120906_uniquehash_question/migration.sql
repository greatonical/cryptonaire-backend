/*
  Warnings:

  - A unique constraint covering the columns `[uniqueHash]` on the table `Question` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "uniqueHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Question_uniqueHash_key" ON "Question"("uniqueHash");
