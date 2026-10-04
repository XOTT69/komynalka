import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../admin-panel.js', import.meta.url), 'utf8');
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
        : body.action === 'admin_feedback_list'
          ? { success: true, feedback: [{ id: '1759220000000-abcdefgh', type: 'problem', category: 'google', source: 'pre_auth', status: 'new', login: '', contact: 'anna@example.com', message: '<img src=x onerror=alert(1)> Не працює нагадування', createdAt: '2026-09-30T09:00:00.000Z', appVersion: '5.10.0' }] }
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
    ui.window.document.getElementById('newAdminUserPass').value='StrongPass9';
    await ui.window.saveNewPassword({preventDefault(){}});
    assert.equal(ui.calls.some(call=>call.action==='admin_reset_password'&&call.newPass==='StrongPass9'),true);
  } finally { ui.close(); }
});

test('feedback inbox escapes messages and updates their workflow status', async()=>{
  const ui=setup();try{
    await ui.window.loadFeedback();
    assert.equal(ui.window.document.querySelector('#feedbackList img'),null);
    assert.match(ui.window.document.getElementById('feedbackList').textContent,/<img src=x onerror=alert\(1\)>/);
    assert.match(ui.window.document.getElementById('feedbackList').textContent,/До входу.*Гість.*Google-вхід/);
    const select=ui.window.document.querySelector('.feedback-status');select.value='done';select.dispatchEvent(new ui.window.Event('change'));
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(ui.calls.some(call=>call.action==='admin_feedback_update'&&call.status==='done'),true);
  }finally{ui.close();}
});

test('admin navigation returns to the signed-in app and remembers the working section', async()=>{
  const ui=setup();try{
    await ui.window.loadStats();
    const {document,sessionStorage}=ui.window,headerLink=document.getElementById('backToApp'),loginLink=document.querySelector('.login-back');
    assert.equal(new URL(headerLink.href).pathname,'/index.html');assert.equal(new URL(loginLink.href).pathname,'/index.html');assert.equal(headerLink.target,'');
    const analyticsTab=document.querySelector('[data-admin-tab="analytics"]');ui.window.switchAdminTab('analytics',analyticsTab);assert.equal(sessionStorage.getItem('admin_tab'),'analytics');assert.equal(analyticsTab.getAttribute('aria-selected'),'true');assert.equal(document.getElementById('tabAnalytics').classList.contains('hidden'),false);
    ui.window.switchAdminTab('not-valid');assert.equal(sessionStorage.getItem('admin_tab'),'users');assert.equal(document.querySelector('[data-admin-tab="users"]').getAttribute('aria-selected'),'true');
  }finally{ui.close();}
});

test('server pages retain selected users, show global totals and export all pages instead of just the visible rows',async()=>{
 const users=Array.from({length:51},(_,i)=>({login:'user-'+String(i).padStart(2,'0'),records:1,addresses:1,devices:0,suspicious:0,lastMonth:'2026-10'})),ui=setup();
 const queries=[];
 ui.window.fetch=async(_url,options)=>{const body=JSON.parse(options.body);queries.push(body);const result=body.action==='admin_stats'?{success:true,indexReady:true,mode:'directory',stats:{totalUsers:51,totalRecords:51,activeThisMonth:51,proUsers:0,googleUsers:0,suspiciousUsers:0},users:body.cursor?users.slice(50):users.slice(0,50),total:51,cursor:body.cursor?null:'second',analytics:{topUsers:[users[50]],months:[{month:'2026-10',count:51}],suspicious:[]}}:{success:true,indexReady:true};return{ok:true,status:200,json:async()=>result};};
 try{
  await ui.window.loadStats();const checkbox=ui.window.document.querySelector('.user-checkbox');checkbox.checked=true;ui.window.updateSelection();
  await ui.window.nextPage();assert.equal(ui.window.document.querySelectorAll('.user-row').length,1);assert.equal(ui.window.document.getElementById('pageInfo').textContent,'51–51 з 51');assert.match(ui.window.document.getElementById('selectedCount').textContent,/1/);
  await ui.window.prevPage();assert.equal(ui.window.document.querySelector('.user-checkbox').checked,true);assert.equal(ui.window.document.getElementById('statRecords').textContent,'51');
  ui.window.renderAnalytics();assert.match(ui.window.document.getElementById('topUsers').textContent,/user-50/);
  let csv;ui.window.downloadFile=text=>{csv=text;};await ui.window.exportAllData();assert.equal(csv.trim().split('\n').length,52);assert.ok(queries.some(q=>q.limit===100&&q.sort==='login'));
 }finally{ui.close();}
});

test('feedback fetches one page and loads more on demand, rather than downloading the entire inbox',async()=>{
 const ui=setup();let pages=0;
 ui.window.fetch=async(_url,options)=>{const body=JSON.parse(options.body);let data={success:true,indexReady:true};if(body.action==='admin_feedback_list'){pages++;data={...data,mode:'directory',total:60,feedback:Array.from({length:25},(_,i)=>({id:(1759220000000+i+(body.cursor?25:0))+'-abcdefgh',type:'problem',status:'new',message:'Тестове повідомлення',createdAt:'2026-10-01'})),cursor:body.cursor?null:'next'};}return{ok:true,status:200,json:async()=>data};};
 try{await ui.window.loadFeedback();assert.equal(pages,1);assert.equal(ui.window.document.querySelectorAll('#feedbackList article').length,25);assert.equal(ui.window.document.getElementById('feedbackMore').classList.contains('hidden'),false);await ui.window.loadMoreFeedback();assert.equal(pages,2);assert.equal(ui.window.document.querySelectorAll('#feedbackList article').length,50);}finally{ui.close();}
});
