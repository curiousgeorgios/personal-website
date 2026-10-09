-- Mark resolved (spec 20, plan 7 final review): when George cleared a needs_attention order after dealing with it outside
-- the site. Any write that moves an order into needs_attention again sets it back to NULL. Applied with wrangler d1
-- migrations apply, never execute --file
ALTER TABLE print_orders ADD COLUMN resolved_at INTEGER;
