-- Safe Prepaid Cards Scale Migration
-- Adds non-destructive indexes to prepaid_cards table to ensure sub-millisecond querying at scale

CREATE INDEX IF NOT EXISTS "prepaid_cards_amount_idx" ON "prepaid_cards"("amount");
CREATE INDEX IF NOT EXISTS "prepaid_cards_used_idx" ON "prepaid_cards"("used");
CREATE INDEX IF NOT EXISTS "prepaid_cards_createdAt_idx" ON "prepaid_cards"("createdAt");
