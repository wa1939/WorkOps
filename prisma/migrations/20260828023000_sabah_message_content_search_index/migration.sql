CREATE INDEX "AiMessage_content_search_idx" ON "AiMessage" USING GIN (to_tsvector('simple', COALESCE("content", '')));
