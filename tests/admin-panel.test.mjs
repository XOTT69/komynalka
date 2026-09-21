import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'admin script is present');
assert.equal(/<script[^>]+src="https?:\/\//.test(html), false, 'admin page does not run third-party JavaScript');

function setup(users = []) {
  const dom = new JSDOM(html, { url: 'https://komynalka.vercel.app/admin.html', runScripts: 'outside-only' });
  const { window } = dom;
  const calls = [];
  window.sessionStorage.setItem('admin_token', 'test-token');
  window.sessionStorage.setItem('admin_login_time', String(Date.now()));
  window.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    const result = body.action === 'admin_stats'
      ? { success: true, stats: { totalUsers: users.length, activeThisMonth: 0, totalRecords: users.length, proUsers: 0 }, users }
      : body.action === 'admin_get_tariffs'
        ? { success: true, tariffs: [{ id: 'tariff-1', name: '<img src=x onerror=alert(1)>', author: 'Автор', city: 'Київ', tariffs: { water: 42 }, verified: false }] }
        : body.action === 'get_broadcast'
          ? { success: true, message: 'Поточне оголошення', date: '2026-09-21' }
          : { success: true };
    return { ok: true, status: 200, json: async () => result };
  };
  window.confirm = () => false;
  window.prompt = () => null;
  window.eval(script);
  return { window, calls, close: () => window.close() };
}

test('admin list keeps selection across pages and never deletes without typed confirmation', async () => {
  const users = Array.from({ length: 51 }, (_, i) => ({ login: `user-${i}`, displayName: '', hasGoogle: false, isPro: false, records: 1, addresses: 1, lastMonth: '2026-09', devices: 1, suspicious: 0 }));
  const ui = setup(users);
  try {
    await ui.window.loadStats();
    const first = ui.window.document.querySelector('.user-checkbox');
    first.checked = true;
    ui.window.updateSelection();
    const login = first.dataset.login;
    ui.window.nextPage();
    assert.match(ui.window.document.getElementById('selectedCount').textContent, /1/);
    ui.window.prevPage();
    assert.equal(ui.window.document.querySelector(`.user-checkbox[data-login="${login}"]`).checked, true);
    await ui.window.massAction('delete');
    assert.equal(ui.calls.some(call => call.action === 'admin_delete_user'), false);
  } finally { ui.close(); }
});

test('tariff moderation is visible, escapes provider text and current broadcast is readable', async () => {
  const ui = setup();
  try {
    await ui.window.loadStats();
    await ui.window.loadTariffs();
    assert.equal(ui.window.document.getElementById('pendingTariffsBadge').textContent, '1');
    assert.equal(ui.window.document.querySelector('#tariffsTableBody img'), null);
    assert.match(ui.window.document.getElementById('tariffsTableBody').textContent, /<img src=x onerror=alert\(1\)>/);
    await ui.window.loadBroadcast();
    assert.match(ui.window.document.getElementById('currentBroadcast').textContent, /Поточне оголошення/);
    assert.equal(ui.calls.some(call => call.action === 'admin_verify_tariff'), false);
    ui.window.resetPassword('user');
    assert.equal(ui.window.document.getElementById('newAdminUserPass').type, 'password');
    assert.equal(ui.window.document.getElementById('passwordModal').classList.contains('hidden'), false);
  } finally { ui.close(); }
});
