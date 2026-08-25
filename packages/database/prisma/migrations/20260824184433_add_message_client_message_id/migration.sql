-- AlterTable
ALTER TABLE "messages" ADD COLUMN "client_message_id" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "messages_author_id_client_message_id_key" ON "messages"("author_id", "client_message_id");
