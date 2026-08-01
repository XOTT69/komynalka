# Security hardening plan

## Already covered in the codebase

- Worker responses are non-cacheable and carry `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.
- Worker CORS uses an origin allowlist. The deployed worker accepts the production domain and approved local development origins; extra production/preview domains are supplied through `ALLOWED_ORIGINS` in Worker configuration.
- Worker request bodies are limited to 512 KiB even when `Content-Length` is absent.
- Supabase shadow writes are opt-in and use Worker secrets, never browser variables.
- Client sync keeps the newest full snapshot locally while offline; a stale response cannot erase a newer queued snapshot.
- The frontend bundles Firebase, fonts and PDF dependencies locally rather than relying on production CDNs.

## Required before calling the service fully production-hardened

1. Replace legacy `login + SHA-256 password hash` bearer authorization with Firebase Auth ID-token verification in the Worker (or a server-side session). A reusable client-side password hash behaves like a long-lived password and must not remain the final authentication protocol.
2. Keep `ALLOWED_ORIGINS` current as new production or preview domains are approved. The wildcard has been removed; do not reintroduce it.
3. Move primary account reads from KV to Supabase only after the controlled migration described in `supabase-migration.md`, with row-level security tested using the anonymous key.
4. Add a scheduled backup export, encryption at rest for exported archives, a recovery test, and a retention policy.
5. Add alerting for Worker exceptions, authentication spikes, 429 bursts, failed shadow writes and health endpoint downtime.
6. Test authorization boundaries: account A must never read, edit, share or delete account B data; test expired share links and deleted objects.

## Operating rules

- Never place `SUPABASE_SERVICE_ROLE_KEY`, admin password, AI keys or Worker tokens in the repository or frontend code.
- Do not enable a new custom domain before the TLS certificate is valid and the domain is added to Firebase Authorized domains.
- Treat local browser storage as a convenience backup, not the only recovery mechanism.
