import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

function checkInlineScripts(source, filename) {
  const scripts = [...source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  scripts.forEach((match, index) => {
    try { new Function(match[1]); }
    catch (error) { fail(`${filename} inline script ${index + 1} has a syntax error: ${error.message}`); }
  });
}

for (const file of ['app.js', 'ui-dialogs.js', 'export-tools.js', 'record-card.js', 'ai-chat.js', 'sw.js', 'worker.js', 'year-report-image.js']) {
  try {
    execFileSync('node', ['--check', path.join(root, file)], { stdio: 'pipe' });
  } catch (error) {
    fail(`${file} has a syntax error\n${error.stderr?.toString() || error.message}`);
  }
}

const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const vendorAssets = [
  'vendor/firebase/firebase-app-compat.js',
  'vendor/firebase/firebase-auth-compat.js',
  'vendor/jspdf/jspdf.umd.min.js',
  'vendor/jspdf/jspdf.plugin.autotable.min.js',
  'vendor/fonts/Roboto-Regular.ttf',
  'vendor/fonts/inter/inter-cyrillic-wght-normal.woff2',
  'vendor/fonts/inter/inter-latin-wght-normal.woff2',
  'vendor/fonts/inter-tight/inter-tight-cyrillic-wght-normal.woff2',
  'vendor/fonts/inter-tight/inter-tight-latin-wght-normal.woff2',
  'vendor/fontawesome/css/all.min.css',
  'vendor/fontawesome/webfonts/fa-brands-400.woff2',
  'vendor/fontawesome/webfonts/fa-regular-400.woff2',
  'vendor/fontawesome/webfonts/fa-solid-900.woff2',
  'vendor/fontawesome/webfonts/fa-v4compatibility.woff2',
];
for (const asset of vendorAssets) {
  if (!(await fileExists(asset))) fail(`vendor asset is missing: ${asset}`);
}
const robotoBytes = await readFile(path.join(root, 'vendor/fonts/Roboto-Regular.ttf'));
const robotoHash = createHash('sha256').update(robotoBytes).digest('hex');
if (robotoHash !== '466989fd178ca6ed13641893b7003e5d6ec36e42c2a816dee71f87b775ea097f') fail('vendored Roboto font checksum does not match the pinned source');
for (const icon of manifest.icons || []) {
  if (!(await fileExists(icon.src))) fail(`manifest icon is missing: ${icon.src}`);
}

const sw = await readFile(path.join(root, 'sw.js'), 'utf8');
const precacheBlock = sw.slice(sw.indexOf('const PRECACHE_URLS'), sw.indexOf('];', sw.indexOf('const PRECACHE_URLS')) + 2);
const precachePaths = [...precacheBlock.matchAll(/['"]\.\/([^'"]*)['"]/g)].map(match => match[1].split('?')[0]).filter(Boolean);
for (const relativePath of precachePaths) {
  if (!(await fileExists(relativePath))) fail(`service worker precache target is missing: ${relativePath}`);
}
for (const asset of vendorAssets) {
  if (!sw.includes(`./${asset}`)) fail(`service worker does not precache vendor asset: ${asset}`);
}
for (const icon of ['icon-192.png', 'icon-512.png']) {
  if (!sw.includes(icon)) fail(`service worker does not precache ${icon}`);
}
if (!sw.includes('SKIP_WAITING')) fail('service worker cannot apply a waiting update on demand');
if (!sw.includes("event.request.mode === 'navigate'")) fail('service worker navigation fallback is missing');

const app = await readFile(path.join(root, 'app.js'), 'utf8');
const uiDialogs = await readFile(path.join(root, 'ui-dialogs.js'), 'utf8');
const exportTools = await readFile(path.join(root, 'export-tools.js'), 'utf8');
const recordCard = await readFile(path.join(root, 'record-card.js'), 'utf8');
const appShellCss = await readFile(path.join(root, 'styles/app-shell.css'), 'utf8');
const quietUiCss = await readFile(path.join(root, 'styles/quiet-ui.css'), 'utf8');
const supabaseMigration = await readFile(path.join(root, 'supabase/migrations/202607160001_initial.sql'), 'utf8');
if (!app.includes(`const APP_VERSION = '${packageJson.version}'`)) fail('app and package versions are out of sync');
if (!sw.includes(`komunalka-v${packageJson.version}`)) fail('service worker cache and package versions are out of sync');
if (!app.includes('updatefound')) fail('app does not listen for real service worker updates');
if (!app.includes('normalizeImportData')) fail('JSON import normalization is missing');
if (!exportTools.includes('csvCell')) fail('CSV escaping helper is missing');
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
const editRecordDefinitions = [...app.matchAll(/^function editRecordById\(/gm)].length;
if (editRecordDefinitions !== 1) fail(`editRecordById must have exactly one implementation, found ${editRecordDefinitions}`);
if (/onclick=["'][^"']*dismissBroadcast/.test(app)) fail('broadcast dismissal still uses an inline handler');
if (/onclick=["'][^"']*editingBanner/.test(app)) fail('editing banner still uses an inline handler');
if (!app.includes("input.dataset.keyboardNavBound==='true'")) fail('calculator keyboard navigation can be bound repeatedly');
if (!uiDialogs.includes('function showAppDialog(') || !uiDialogs.includes('DIALOG_FOCUSABLE')) fail('accessible dialog manager is missing');
if (/\bconfirm\s*\(/.test(app) || /(?<!deferredPrompt\.)\bprompt\s*\(/.test(app)) fail('native blocking dialogs remain in the main app');
if (app.includes('_origCreateRecordCard') || app.includes('createRecordCard = function')) fail('record card still has a dead overridden implementation');
if (!recordCard.includes('function createRecordCard(')) fail('record card module is missing its renderer');
if (!exportTools.includes('function exportCSV(') || !exportTools.includes('async function generatePDF(')) fail('export tools module is incomplete');
if (exportTools.includes('cdn.jsdelivr.net') || !exportTools.includes("fetch('vendor/fonts/Roboto-Regular.ttf')")) fail('PDF font is not loaded from the local vendor asset');
if (app.includes('function exportCSV(') || app.includes('async function generatePDF(')) fail('export tools were not removed from the app monolith');
for (const label of ['Поділитися записом', 'Редагувати запис', 'Видалити запис']) {
  if (!recordCard.includes(`aria-label="${label}"`)) fail(`record card action is missing label: ${label}`);
}
if (!recordCard.includes('aria-expanded="false"')) fail('record card details toggle is not accessible');
if (recordCard.includes('data-rec-id="${recId}"') || recordCard.includes('data-toggle-details="${recId}"')) fail('raw imported record id is interpolated into HTML');
if (app.includes('function createRecordCard(')) fail('record card renderer was not removed from the app monolith');
if (!(await fileExists('tests/record-card-harness.html'))) fail('record card browser harness is missing');
if (!(await fileExists('tests/dialog-harness.html'))) fail('dialog browser harness is missing');
if (!(await fileExists('tests/vendor-harness.html'))) fail('vendor browser harness is missing');

const runtimeSources = await Promise.all(['app.js', 'ui-dialogs.js', 'export-tools.js', 'record-card.js', 'ai-chat.js', 'year-report-image.js'].map(file => readFile(path.join(root, file), 'utf8')));
const combinedRuntime = runtimeSources.join('\n');
for (const [sourceIndex, source] of runtimeSources.entries()) {
  for (const match of source.matchAll(/^(?:async )?function\s+(\w+)/gm)) {
    const name = match[1];
    const references = combinedRuntime.match(new RegExp(`\\b${name}\\b`, 'g')) || [];
    if (references.length === 1) fail(`possible dead function ${name} in runtime source ${sourceIndex + 1}`);
  }
}

const index = await readFile(path.join(root, 'index.html'), 'utf8');
checkInlineScripts(index, 'index.html');
if (index.includes('cdn.tailwindcss.com')) fail('main app still loads Tailwind from the CDN');
if (/https:\/\/(?:www\.gstatic\.com\/firebasejs|cdnjs\.cloudflare\.com)/.test(index)) fail('main app still loads a critical library from a CDN');
if (/https:\/\/fonts\.(?:googleapis|gstatic)\.com/.test(index)) fail('main app still loads fonts from Google');
if (!index.includes('dist/tailwind.css')) fail('main app production stylesheet is missing');
if (!index.includes('styles/fonts.css')) fail('main app self-hosted font stylesheet is missing');
if (!index.includes('styles/app-shell.css')) fail('responsive application shell stylesheet is missing');
if (!index.includes('styles/quiet-ui.css')) fail('quiet UI stylesheet is missing');
if (!index.includes(`<script src="record-card.js?v=${packageJson.version}"></script>`)) fail('versioned record card module is not loaded');
if (!index.includes(`<script src="ui-dialogs.js?v=${packageJson.version}"></script>`)) fail('versioned dialog module is not loaded');
if (!index.includes(`<script src="export-tools.js?v=${packageJson.version}"></script>`)) fail('versioned export tools module is not loaded');
if (!(await fileExists('dist/tailwind.css'))) fail('compiled Tailwind stylesheet is missing; run the build');
for (const id of ['restoreBackupBtn', 'restorePreImportBtn', 'saveTariffTemplateBtn', 'loadTariffTemplateBtn', 'resetTariffsBtn', 'changeLogList', 'forgetDeviceBtn']) {
  if (!index.includes(`id="${id}"`)) fail(`index is missing ${id}`);
}
if (!index.includes('--surface-base')) fail('clean design-system surface tokens are missing');
if (!index.includes('Inter Tight')) fail('modern display font is missing');
if (!index.includes('.tracking-tight{letter-spacing:0!important}')) fail('negative tracking override is missing');
if (app.includes('applyLiquidGlassLevel') || index.includes('liquidGlassRange')) fail('obsolete Liquid Glass controls are still present');
for (const id of ['monthMiniWidget', 'miniDebt', 'miniDeadline', 'miniForecast', 'paymentStatusInput', 'paidAmountInput', 'tariffPresetSelect', 'familyRoleSelect', 'remGasStart', 'remGasEnd']) {
  if (!index.includes(`id="${id}"`)) fail(`index is missing ${id}`);
}
if (!index.includes('id="communityTariffStatus"')) fail('community provider publish status is missing');
for (const id of ['communityTariffCity', 'communityTariffRegion', 'communityTariffService', 'cloudTariffSearch', 'cloudTariffServiceFilter']) {
  if (!index.includes(`id="${id}"`)) fail(`index is missing provider catalog control ${id}`);
}
if (!index.includes('class="app-frame pt-5') || !index.includes('<div class="app-frame">')) fail('header and content do not share the responsive frame');
if (!appShellCss.includes('scrollbar-gutter: stable both-edges')) fail('scroll content can drift off the viewport center');
if (!appShellCss.includes('position: relative !important') || !appShellCss.includes('--app-viewport-height')) fail('mobile dock is not part of the iPhone-safe application flow');
if (!appShellCss.includes('grid-template-columns: repeat(5')) fail('achievements do not use a balanced grid');
if (/blur\(/.test(appShellCss.match(/\.achievement\.locked\s*\{[^}]*\}/)?.[0] || '')) fail('locked achievements are still visually blurred');
if (!appShellCss.includes('margin: 7px auto max(8px, env(safe-area-inset-bottom, 0px))')) fail('mobile dock safe-area margin is missing');
if (!index.includes('id="aiFabBtn" class="hidden col-span-2')) fail('AI assistant is not integrated into the More tools panel');
if (index.includes('<!-- AI FAB -->') || index.includes('z-[450] w-14 h-14')) fail('obsolete floating AI button is still present');
if (!quietUiCss.includes('.dashboard-summary') || !quietUiCss.includes('@media (min-width: 900px)')) fail('responsive quiet design system is incomplete');
if (!index.includes('class="dashboard-summary"')) fail('dashboard does not use the simplified summary');
if (index.includes('id="donutCanvas"') || app.includes('DonutChart')) fail('removed dashboard donut code is still present');
const bottomNav = index.slice(index.indexOf('<nav class="fixed'), index.indexOf('</nav>', index.indexOf('<nav class="fixed')));
const bottomNavButtons = [...bottomNav.matchAll(/<button\b/g)].length;
if (bottomNavButtons !== 4) fail(`bottom navigation must contain 4 primary destinations, found ${bottomNavButtons}`);
if (!index.includes(`styles/quiet-ui.css?v=${packageJson.version}`) || !index.includes(`app.js?v=${packageJson.version}`)) fail('app-shell assets are not versioned against mixed iPhone caches');
if (!sw.includes(`styles/quiet-ui.css?v=${packageJson.version}`) || !sw.includes('fetch(event.request).then(response =>')) fail('service worker does not cache and refresh versioned app-shell assets consistently');
if (index.includes('user-scalable=no') || index.includes('maximum-scale=1')) fail('viewport blocks user zoom');
if (!index.includes('role="status" aria-live="polite"')) fail('toast live region is missing');
if (!index.includes('rel="noopener noreferrer"')) fail('external blank-target links are not isolated');
if (/onclick=/.test(index)) fail('main app still contains inline event handlers');
for (const id of ['appDialog', 'appDialogTitle', 'appDialogInput', 'appDialogTextarea', 'appDialogConfirmBtn', 'appDialogCancelBtn']) {
  if (!index.includes(`id="${id}"`)) fail(`accessible app dialog is missing ${id}`);
}

const admin = await readFile(path.join(root, 'admin.html'), 'utf8');
const landing = await readFile(path.join(root, 'landing.html'), 'utf8');
checkInlineScripts(admin, 'admin.html');
checkInlineScripts(landing, 'landing.html');
if (/\b(?:confirm|prompt)\s*\(/.test(admin)) fail('admin still uses native blocking dialogs');
if (/\bon(?:click|change|input)=/i.test(admin)) fail('admin still contains inline event handlers');
if (!admin.includes("if (!pass) {") || !admin.includes("errEl.textContent = 'Введіть пароль'")) fail('admin login does not reject an empty password locally');
if (admin.includes('cdn.tailwindcss.com') || landing.includes('cdn.tailwindcss.com')) fail('a secondary page still loads Tailwind from the CDN');
if (admin.includes('cdnjs.cloudflare.com') || landing.includes('cdnjs.cloudflare.com')) fail('a secondary page still loads Font Awesome from a CDN');
if (!admin.includes('dist/tailwind.css') || !landing.includes('dist/tailwind.css')) fail('a secondary page is missing the production stylesheet');
if (!admin.includes(`Комуналка PWA v${packageJson.version}`)) fail('admin app version is out of sync');
for (const unsafe of ['onclick="viewUser(', 'onclick="resetPassword(', 'onclick="deleteUser(', 'onclick="givePro(', 'onclick="revokePro(']) {
  if (admin.includes(unsafe)) fail(`admin still contains unsafe generated handler: ${unsafe}`);
}
if (!admin.includes("escHtml((ud.lastDevice || '—').slice(0, 12))")) fail('admin device details are not escaped');

const worker = await readFile(path.join(root, 'worker.js'), 'utf8');
if (!supabaseMigration.includes('alter table public.utility_records enable row level security')) fail('Supabase records RLS is missing');
if (!supabaseMigration.includes('create table public.legacy_accounts')) fail('Supabase legacy migration bridge is missing');
if (!supabaseMigration.includes('create policy records_select_member')) fail('Supabase record access policies are missing');
if (!worker.includes('mirrorUserToSupabase') || !worker.includes("env.SUPABASE_SHADOW_WRITES === 'true'")) fail('Worker Supabase shadow writes are missing or not opt-in');
if (index.includes('SUPABASE_SERVICE_ROLE_KEY')) fail('Supabase service key leaked into the frontend');
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
