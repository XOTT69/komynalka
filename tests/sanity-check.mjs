import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const fail = message => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

async function fileExists(relativePath) {
  try {
    await access(path.join(root, relativePath), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

for (const file of ['app.js', 'sw.js', 'year-report-image.js']) {
  try {
    execFileSync('node', ['--check', path.join(root, file)], { stdio: 'pipe' });
  } catch (error) {
    fail(`${file} has a syntax error\n${error.stderr?.toString() || error.message}`);
  }
}

const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
for (const icon of manifest.icons || []) {
  if (!(await fileExists(icon.src))) fail(`manifest icon is missing: ${icon.src}`);
}

const sw = await readFile(path.join(root, 'sw.js'), 'utf8');
for (const icon of ['icon-192.png', 'icon-512.png']) {
  if (!sw.includes(icon)) fail(`service worker does not precache ${icon}`);
}
if (!sw.includes('SKIP_WAITING')) fail('service worker cannot apply a waiting update on demand');
if (!sw.includes("event.request.mode === 'navigate'")) fail('service worker navigation fallback is missing');

const app = await readFile(path.join(root, 'app.js'), 'utf8');
if (!app.includes('updatefound')) fail('app does not listen for real service worker updates');
if (!app.includes('normalizeImportData')) fail('JSON import normalization is missing');
if (!app.includes('csvCell')) fail('CSV escaping helper is missing');
if (!app.includes('restoreFromLocalBackup')) fail('offline local-backup restore is missing');
if (!app.includes('tariffSnapshot')) fail('record tariff snapshots are missing');
if (!app.includes('komynalka_pre_import_backup')) fail('pre-import backup is missing');
if (!app.includes('showActionToast')) fail('action toast with undo/rollback is missing');
if (!app.includes('payableIds')) fail('batch pay is not scoped to visible records');
if (!app.includes('getSaveAnomalyWarning')) fail('save-time anomaly warning is missing');
if (!app.includes('escapeAttr')) fail('HTML attribute escaping helper is missing');
if (!app.includes('sanitizeDomId')) fail('imported DOM id sanitization is missing');
if (!app.includes('CUSTOM_TARIFF_TEMPLATE_KEY')) fail('custom tariff template support is missing');
if (!app.includes('renderChangeLog')) fail('change log rendering is missing');
if (!app.includes('nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)')) fail('year-safe next-month forecast is missing');
if (!app.includes('applyLiquidGlassLevel')) fail('Liquid Glass runtime settings are missing');
if (app.includes('localStorage.clear()')) fail('logout still clears all local storage');

const index = await readFile(path.join(root, 'index.html'), 'utf8');
for (const id of ['restoreBackupBtn', 'restorePreImportBtn', 'saveTariffTemplateBtn', 'loadTariffTemplateBtn', 'resetTariffsBtn', 'changeLogList', 'forgetDeviceBtn']) {
  if (!index.includes(`id="${id}"`)) fail(`index is missing ${id}`);
}
if (!index.includes('--liquid-card-alpha')) fail('Liquid Glass CSS tokens are missing');
if (!index.includes('id="liquidGlassRange"')) fail('Liquid Glass slider is missing');

const admin = await readFile(path.join(root, 'admin.html'), 'utf8');
for (const unsafe of ['onclick="viewUser(', 'onclick="resetPassword(', 'onclick="deleteUser(', 'onclick="givePro(', 'onclick="revokePro(']) {
  if (admin.includes(unsafe)) fail(`admin still contains unsafe generated handler: ${unsafe}`);
}
if (!admin.includes("escHtml((ud.lastDevice || '—').slice(0, 12))")) fail('admin device details are not escaped');

if (!process.exitCode) console.log('Sanity checks passed');
