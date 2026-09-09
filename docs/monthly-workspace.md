# Monthly workspace release — 2026-09-09

The dashboard now presents the current Kyiv calendar month, its outstanding balance, and a task list for readings, provider submission and payment. Other months' unpaid balances remain separate. No record is represented by a dash instead of a misleading zero balance.

Provider completion is recorded individually using the existing address-scoped reminder completion fields and the same cycle as background push. Entering readings never marks provider submission or payment complete. Provider submission itself still takes place in the provider's account.

The reading form keeps previous/current readings in two readable columns, shows tariffs and a review of charges, payment and balance before saving. Explicitly missing services remain blank when reopening a partial record. Analytics and secondary overview tools remain available; AI is accessible under “Ще”.

## Data and deployment

This release changes the frontend only. The existing production Worker, KV namespace, account envelopes and historical records are retained. There is no migration or production data rewrite. The previously verified frozen backup remains stored privately under `backups/` and is excluded from Git and the frontend build.

Publish the frontend from the existing production branch through Vercel. Check that production assets match `dist/` and Worker health remains writable. A frontend rollback can use the previous frontend deployment without rolling back the Worker or deleting any data.

## Validation

- `npm run build` and `npm run check`: 54 tests, including retained controls, historical tariffs, partial payments, account isolation, drafts, reminders and PWA update detection.
- `npm run demo`, then `node scripts/check-layout.cjs`: isolated demo browser checks at 320, 390, 768 and 1280 px, fixed navigation after scrolling, readable reading/reminder inputs, AI panel opening, enlarged text and a short viewport.
- The layout script accepts `KOMUNALKA_PLAYWRIGHT_MODULE` and `KOMUNALKA_BROWSER_EXECUTABLE` for an externally installed Playwright and browser. Otherwise it uses the standard Playwright module/browser installation.
- Browser checks use desktop Chrome emulation. Physical iPhone keyboard behavior and real phone push delivery have not been verified by this release.

Later phases (provider cards, deeper history and archive tools) remain separate work.
