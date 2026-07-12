import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const app = await readFile(path.join(root, 'app.js'), 'utf8');

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
]) {
  if (!html.includes(`id="${id}"`)) fail(`critical UI id is missing: ${id}`);
}

for (const token of [
  '--surface-base',
  '--radius-control',
  'Inter Tight',
  '.tracking-tight{letter-spacing:0!important}',
]) {
  if (!html.includes(token)) fail(`design-system token is missing: ${token}`);
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
