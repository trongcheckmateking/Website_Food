ALTER TABLE orders ADD COLUMN proposed_total bigint, ADD COLUMN adjustment text NOT NULL DEFAULT '';
