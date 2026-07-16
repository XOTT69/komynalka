# KV → Supabase migration

The migration is deliberately opt-in. Workers KV remains the source of truth until every snapshot has been verified.

## 1. Create the database

1. Create a Supabase project in the closest suitable region.
2. Apply `supabase/migrations/202607160001_initial.sql` through the Supabase CLI or SQL editor.
3. Verify that RLS is enabled on every public table.
4. Keep the service-role key only in Cloudflare Worker secrets. Never add it to HTML, JavaScript bundles, Git, or Vercel variables exposed to the browser.

## 2. Enable shadow writes

Add Worker secrets:

```sh
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

Set `SUPABASE_SHADOW_WRITES = "true"` only after the SQL migration succeeds. Each successful KV save will then upsert a password-stripped snapshot into `legacy_accounts`. KV continues to serve all reads.

## 3. Backfill existing accounts

Export the existing KV data through the admin backup flow. Backfill it through a trusted local/admin script or the Supabase dashboard using the same `legacy_accounts` shape:

- `login`
- `pass_hash` (nullable for Google-only accounts)
- `payload` without `pass` or `passHash`
- `source_updated_at`

Compare account counts and the number of addresses and utility records before switching reads.

## 4. First-login auth bridge

Existing SHA-256 hashes must not become Supabase passwords. On a user's first login:

1. Verify the submitted password against the legacy hash inside the Worker.
2. Create or link the Supabase Auth user.
3. Materialize `properties`, `property_members`, `property_settings`, and `utility_records` in one controlled migration.
4. Set `legacy_accounts.migrated_user_id`.
5. Require a Supabase password reset or complete a secure server-side password enrollment flow.

Google users can be linked by verified provider identity instead of migrating a password.

## 5. Cut over safely

1. Enable Supabase reads for internal test users.
2. Keep KV fallback reads during a full release cycle.
3. Verify cross-device edits, sharing, offline recovery, deletion, and admin export.
4. Switch all reads to Supabase.
5. Stop KV user writes only after metrics show no fallback reads.
6. Retain an encrypted KV export for a defined rollback period, then securely remove legacy password hashes.

KV can remain in use for rate limits, broadcasts, short-lived share metadata, and cached public tariff data.
