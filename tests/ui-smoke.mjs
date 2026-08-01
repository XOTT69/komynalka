import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const app = await readFile(path.join(root, 'app.js'), 'utf8');
const tokens = await readFile(path.join(root, 'styles/design-tokens.css'), 'utf8');
const theme = await readFile(path.join(root, 'styles/theme.css'), 'utf8');

const fail = message => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

for (const id of [
  'authForm',
  'authLogin',
  'authPass',
  'appScreen',
  'bottomNav',
  'tabDashboard',
  'tabCalc',
  'tabHistory',
  'tabAnalytics',
  'tabSettings',
  'utilityForm',
  'saveSettingsBtn',
  'communityTariffName',
  'communityTariffCity',
  'cloudTariffSearch',
  'appDialog',
  'appDialogConfirmBtn',
  'appDialogCancelBtn',
]) {
  if (!html.includes(`id="${id}"`)) fail(`critical UI id is missing: ${id}`);
}

for (const token of [
  '--color-primary: #6d5df6',
  '--radius-lg: 20px',
  '--font-display',
]) {
  if (!tokens.includes(token)) fail(`design-system token is missing: ${token}`);
}
if (!theme.includes('.dashboard-summary') || !theme.includes('#bottomNav')) fail('unified theme does not cover core product surfaces');

for (const accessibilityToken of [
  'aria-label="Показати пароль"',
  'role="status" aria-live="polite"',
  'role="dialog" aria-modal="true"',
  'aria-label="Швидкі дії"',
]) {
  if (!html.includes(accessibilityToken)) fail(`accessibility contract is missing: ${accessibilityToken}`);
}

for (const fn of [
  'performLogin',
  'syncToCloud',
  'renderDashboard',
  'renderCloudCommunityTariffs',
  'getSaveAnomalyWarning',
]) {
  if (!app.includes(fn)) fail(`critical app workflow is missing: ${fn}`);
}

if (!process.exitCode) console.log('UI smoke checks passed');
