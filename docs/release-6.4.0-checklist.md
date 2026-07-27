# Release checklist — PWA 6.4.0

## Before deployment

- [ ] Run `pnpm run build` locally with no failures.
- [ ] In Vercel, keep `komynalka.vercel.app` as the production domain. Do not switch to `mykomunalka.pp.ua` until its DNS, SSL and Firebase authorization are verified (see `domain-migration.md`).
- [ ] Confirm the production Worker URL in `app.js` is the intended Worker and its KV namespace binding is production, not a test namespace.
- [ ] Confirm `SUPABASE_SHADOW_WRITES` is either intentionally `false` or the Supabase migration and secrets have been verified.
- [ ] Deploy the frontend and Worker from the same reviewed release.

## Mandatory production checks

- [ ] Open `/` in a private browser window on iPhone Safari and Android Chrome.
- [ ] Register or sign in with a dedicated test account; verify email/password and Google sign-in.
- [ ] Add a second address, create a tariff template there, refresh, then sign in on a second device and verify the template remains attached to that address.
- [ ] Disable a service and verify it disappears from the calculator, tariff inputs, active reminders and tariff summaries; historical records must remain untouched.
- [ ] Turn on airplane mode, change a tariff or reminder, close/reopen the app, restore the connection and verify the last change reaches the second device.
- [ ] Check the Worker liveness endpoint: `https://<worker-host>/?health=1` must return JSON with `success: true`.
- [ ] Verify an update banner/service worker reload does not lose current unsaved form input.

## After deployment

- [ ] Check Vercel deployment logs for failed asset requests or runtime exceptions.
- [ ] Check Cloudflare Worker error/rate-limit events for 24 hours.
- [ ] Export an encrypted administrator backup before any database or authentication migration.
- [ ] Record the release date, frontend deployment URL and Worker version in the team changelog.

## Rollback

1. Revert the Vercel deployment to the prior healthy build.
2. Revert the Worker only if its API contract changed; otherwise keep the compatible Worker in place.
3. Never delete KV or Supabase data as a rollback action.
4. Preserve the failed release logs and a sanitized client backup for diagnosis.
