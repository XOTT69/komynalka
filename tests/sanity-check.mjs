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
if (!app.includes('TARIFF_PRESETS')) fail('city/provider tariff presets are missing');
if (!app.includes('publishCommunityTariffToCloud')) fail('community provider cloud publishing status is missing');
if (!app.includes('setCommunityTariffStatus')) fail('community provider status UI logic is missing');
if (!app.includes('cloud_tariff_loaded')) fail('cloud provider apply action is not logged');
if (!app.includes('cloudCommunityTariffsCache')) fail('cloud provider catalog cache is missing');
if (!app.includes("action: 'vote_tariff'")) fail('cloud provider voting action is missing');
if (!app.includes('TARIFF_SERVICE_LABELS')) fail('provider service labels are missing');
if (!app.includes('data.data?.linkedLogin')) fail('Google login does not read linkedLogin from response data');
if (!app.includes('action:"link_google", login: sessionLogin, pass: sessionPass, uid')) fail('Google linking does not send the current password hash');
if (!app.includes('familyRole')) fail('family role preferences are missing');
if (!app.includes('getPaymentStatus')) fail('payment status helpers are missing');
if (!app.includes('remGasStart')) fail('gas submission calendar is missing');
if (!app.includes('renderMonthMiniWidget')) fail('month mini widget logic is missing');
if (app.includes('localStorage.clear()')) fail('logout still clears all local storage');

const index = await readFile(path.join(root, 'index.html'), 'utf8');
for (const id of ['restoreBackupBtn', 'restorePreImportBtn', 'saveTariffTemplateBtn', 'loadTariffTemplateBtn', 'resetTariffsBtn', 'changeLogList', 'forgetDeviceBtn']) {
  if (!index.includes(`id="${id}"`)) fail(`index is missing ${id}`);
}
if (!index.includes('--liquid-card-alpha')) fail('Liquid Glass CSS tokens are missing');
if (!index.includes('--surface-base')) fail('clean design-system surface tokens are missing');
if (!index.includes('Inter Tight')) fail('modern display font is missing');
if (!index.includes('.tracking-tight{letter-spacing:0!important}')) fail('negative tracking override is missing');
if (!index.includes('id="liquidGlassRange"')) fail('Liquid Glass slider is missing');
for (const id of ['monthMiniWidget', 'miniDebt', 'miniDeadline', 'miniForecast', 'paymentStatusInput', 'paidAmountInput', 'tariffPresetSelect', 'familyRoleSelect', 'remGasStart', 'remGasEnd']) {
  if (!index.includes(`id="${id}"`)) fail(`index is missing ${id}`);
}
if (!index.includes('id="communityTariffStatus"')) fail('community provider publish status is missing');
for (const id of ['communityTariffCity', 'communityTariffRegion', 'communityTariffService', 'cloudTariffSearch', 'cloudTariffServiceFilter']) {
  if (!index.includes(`id="${id}"`)) fail(`index is missing provider catalog control ${id}`);
}
if (!index.includes('max-width:390px')) fail('floating dock max-width is missing');
if (!index.includes('bottom:calc(env(safe-area-inset-bottom,0px) + 14px)')) fail('floating dock safe-area offset is missing');
if (!index.includes('#aiFabBtn{bottom:calc(env(safe-area-inset-bottom,0px) + 104px)')) fail('AI FAB is not offset above dock');

const admin = await readFile(path.join(root, 'admin.html'), 'utf8');
for (const unsafe of ['onclick="viewUser(', 'onclick="resetPassword(', 'onclick="deleteUser(', 'onclick="givePro(', 'onclick="revokePro(']) {
  if (admin.includes(unsafe)) fail(`admin still contains unsafe generated handler: ${unsafe}`);
}
if (!admin.includes("escHtml((ud.lastDevice || '—').slice(0, 12))")) fail('admin device details are not escaped');

const worker = await readFile(path.join(root, 'worker.js'), 'utf8');
if (!worker.includes('function getUidLogin')) fail('worker cannot create first Google UID accounts');
if (!worker.includes("if (!pass || stored !== pass) return err('WRONG_PASSWORD', 403);")) fail('worker allows unsafe Google account linking');
if (worker.includes('await env.KV.put(`uid_${uid}`, cl);')) fail('worker still overwrites legacy uid user keys during Google linking');
const workerGetBlock = worker.slice(worker.indexOf('async function doGet'), worker.indexOf('async function doPost'));
if (/\b(action|body)\b/.test(workerGetBlock)) fail('worker GET path references POST-only action/body state');
if (!worker.includes("case 'vote_tariff':")) fail('worker provider voting endpoint is missing');
if (!worker.includes("case 'admin_verify_tariff':")) fail('worker provider moderation endpoint is missing');
if (!worker.includes('voters: _v')) fail('worker leaks provider tariff voters');
if (!worker.includes('history: previousSnapshot')) fail('worker provider tariff history is missing');

if (!process.exitCode) console.log('Sanity checks passed');
