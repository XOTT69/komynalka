const WORKER_URL = "https://komunproga.mikolenko-anton1.workers.dev";
        const APP_VERSION = document.querySelector('meta[name="app-version"]')?.content || 'dev';
        let adminToken = sessionStorage.getItem('admin_token') || '';
        let adminLoginTime = parseInt(sessionStorage.getItem('admin_login_time') || '0');
        let adminExpiresAt = parseInt(sessionStorage.getItem('admin_expires_at') || '0');
        let allUsers = [];
        let selectedUsers = new Set();
        let currentSort = { field: 'records', dir: 'desc' };
        let currentPage = 0;
        const PAGE_SIZE = 50;
        let allTariffs = [];
        let allFeedback = [];
        let statsRequest = null;
        let sessionInterval = null;
        let passwordLogin = '';
        let serverPages=false,userTotal=0,userCursor=null,userCursors=[null],usersGeneration=0,userFilterTimer,usersBusy=false;
        let indexedStats=null,indexedAnalytics=null,indexRequest=null;
        let feedbackCursor=null,feedbackTotal=0,feedbackGeneration=0,feedbackFilterTimer,feedbackBusy=false;
        function userQuery(){return{paginated:true,limit:PAGE_SIZE,cursor:userCursors[currentPage],q:document.getElementById('searchUsers').value,type:document.getElementById('filterType').value,pro:document.getElementById('filterPro').value,active:document.getElementById('filterActive').value,sort:currentSort.field,dir:currentSort.dir};}
        async function ensureAdminIndex(){
            if(indexRequest)return indexRequest;
            const owner=adminToken;
            indexRequest=(async()=>{let result;do{if(adminToken!==owner)throw new Error('Сесія змінилась');result=await adminApi('admin_index_prepare');if(result.indexReady===false)document.getElementById('lastUpdate').textContent='Готую індекс: '+result.pages+' сторінок';}while(result.indexReady===false);})();
            try{await indexRequest;}finally{indexRequest=null;}
        }
        async function requestUserPage(){
            const generation=++usersGeneration,owner=adminToken,query=userQuery();
            usersBusy=true;document.querySelectorAll('button[onclick="prevPage()"],button[onclick="nextPage()"]').forEach(button=>button.disabled=true);
            try{
            const data=await adminApi('admin_stats',query);
            if(generation!==usersGeneration||owner!==adminToken)return;
            if(data.indexReady===false)throw new Error('Індекс ще готується. Натисніть оновити.');
            const {stats,users}=data;serverPages=data.mode==='directory';userTotal=data.total??users.length;userCursor=data.cursor||null;
            allUsers=users;indexedStats=serverPages?stats:null;indexedAnalytics=data.analytics||null;
            if(!serverPages){const known=new Set(users.map(u=>u.login));for(const login of selectedUsers)if(!known.has(login))selectedUsers.delete(login);}
            for(const [id,value] of Object.entries({statUsers:stats.totalUsers,statActive:stats.activeThisMonth,statRecords:stats.totalRecords,statPro:stats.proUsers||0,statGoogle:stats.googleUsers??users.filter(u=>u.hasGoogle).length,statSuspicious:stats.suspiciousUsers??users.filter(u=>u.suspicious>0).length,statTariffs:stats.communityTariffs||0}))document.getElementById(id).textContent=value;
            document.getElementById('statRetention').textContent=stats.totalUsers?Math.round(stats.activeThisMonth/stats.totalUsers*100)+'%':'0%';
            const badge=document.getElementById('feedbackBadge');badge.textContent=stats.feedbackNew||'';badge.classList.toggle('hidden',!stats.feedbackNew);
            const warning=document.getElementById('unrecognizedAccountsWarning');warning.classList.toggle('hidden',!data.unrecognizedAccounts);
            if(data.unrecognizedAccounts)warning.textContent='У KV є '+data.unrecognizedAccounts+' записів невідомого формату. Вони збережені та не включені до списку користувачів.';
            document.getElementById('lastUpdate').textContent='Оновлено: '+new Date().toLocaleTimeString('uk-UA');renderUsers();
            if(sessionStorage.getItem('admin_tab')==='analytics')renderAnalytics();
            if(sessionStorage.getItem('admin_tab')==='security')renderSecurity();
            }finally{if(generation===usersGeneration){usersBusy=false;document.querySelector('button[onclick="prevPage()"]').disabled=currentPage===0;document.querySelector('button[onclick="nextPage()"]').disabled=serverPages?!userCursor:(currentPage+1)*PAGE_SIZE>=getFilteredUsers().length;}}
        }

        async function adminApi(action, payload = {}) {
            const owner=adminToken;
            let response;
            try {
                response = await fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, adminToken, ...payload }) });
            } catch {
                throw new Error('Немає з’єднання з сервером');
            }
            let data;
            try { data = await response.json(); } catch { throw new Error('Сервер повернув неочікувану відповідь'); }
            if(owner!==adminToken)throw new Error('Сесія змінилась. Повторіть дію.');
            if (response.status === 401 || data.error === 'UNAUTHORIZED') {
                adminLogout();
                throw new Error('Сесія закінчилася. Увійдіть знову.');
            }
            if (!response.ok || !data.success) {
                const errors = { MAINTENANCE_READ_ONLY: 'Сервер у режимі лише читання', NOT_FOUND: 'Запис не знайдено', TOO_MANY_ATTEMPTS: 'Забагато спроб. Зачекайте', INCOMPLETE_USER_LIST: 'Список неповний. Спробуйте ще раз' };
                throw new Error(errors[data.error] || data.error || 'Не вдалося виконати дію');
            }
            return data;
        }

        // Auto-login if token exists and not expired
        if (adminToken && adminExpiresAt > Date.now()) {
            document.getElementById('loginScreen').classList.add('hidden');
            document.getElementById('adminPanel').classList.remove('hidden');
            loadStats();
            startSessionTimer();
            restoreAdminTab();
        } else {
            sessionStorage.removeItem('admin_token');
            sessionStorage.removeItem('admin_expires_at');
            adminToken = '';
            usersGeneration++;feedbackGeneration++;clearTimeout(userFilterTimer);clearTimeout(feedbackFilterTimer);
            allUsers=[];allFeedback=[];selectedUsers.clear();indexedStats=null;indexedAnalytics=null;serverPages=false;currentPage=0;userCursors=[null];userCursor=null;feedbackCursor=null;usersBusy=false;
            document.getElementById('usersTableBody').textContent='';document.getElementById('feedbackList').textContent='';document.getElementById('userModal').classList.add('hidden');
        }

        let toastTimer;
        function showAdminToast(msg, type = 'success') {
            const t = document.getElementById('adminToast');
            t.textContent = msg;
            t.className = `toast ${type} show`;
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => t.classList.remove('show'), 4500);
        }

        function escHtml(str) {
            const div = document.createElement('div');
            div.textContent = str || '';
            return div.innerHTML;
        }

        function escAttr(str) {
            return escHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        function startSessionTimer() {
            const el = document.getElementById('sessionTimer');
            const tokenEl = document.getElementById('tokenInfo');
            if (tokenEl) tokenEl.textContent = adminToken.slice(0, 8) + '...';
            clearInterval(sessionInterval);
            const updateTimer = () => {
                const remaining = Math.max(0, Math.ceil((adminExpiresAt-Date.now())/1000));
                const min = Math.floor(remaining / 60);
                const sec = remaining % 60;
                if (el) el.textContent = `${min}:${sec.toString().padStart(2, '0')} залишилось`;
                const securityTimer = document.getElementById('securitySessionTimer');
                if (securityTimer) securityTimer.textContent = `${min}:${sec.toString().padStart(2, '0')}`;
                if (remaining <= 0) adminLogout();
            };
            updateTimer();
            sessionInterval = setInterval(updateTimer, 1000);
        }

        // =================== AUTH ===================
        async function adminLogin() {
            const pass = document.getElementById('adminPass').value;
            const errEl = document.getElementById('loginError');
            const btn = document.getElementById('loginBtn');
            errEl.classList.add('hidden');
            if (!pass) { errEl.textContent = 'Введіть пароль'; errEl.classList.remove('hidden'); return; }
            btn.textContent = 'Завантаження...';
            btn.disabled = true;
            try {
                const res = await fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'admin_login', pass }) });
                const data = await res.json();
                if (data.success && data.token) {
                    adminToken = data.token;
                    adminLoginTime = Date.now();
                    adminExpiresAt = Number(data.expiresAt)||adminLoginTime+3600000;
                    sessionStorage.setItem('admin_token', adminToken);
                    sessionStorage.setItem('admin_login_time', String(adminLoginTime));
                    sessionStorage.setItem('admin_expires_at', String(adminExpiresAt));
                    document.getElementById('loginScreen').classList.add('hidden');
                    document.getElementById('adminPanel').classList.remove('hidden');
                    document.getElementById('adminPass').value = '';
                    loadStats();
                    startSessionTimer();
                    restoreAdminTab();
                } else {
                    errEl.textContent = res.status === 429 ? 'Забагато спроб. Зачекайте.' : data.error === 'ADMIN_NOT_CONFIGURED' ? 'Адміндоступ не налаштовано на сервері' : 'Неправильний пароль';
                    errEl.classList.remove('hidden');
                }
            } catch (e) {
                errEl.textContent = "Помилка з'єднання";
                errEl.classList.remove('hidden');
            }
            btn.textContent = 'Увійти';
            btn.disabled = false;
        }

        function adminLogout() {
            const tokenToRevoke=adminToken;if(tokenToRevoke)fetch(WORKER_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'admin_logout',adminToken:tokenToRevoke}),keepalive:true}).catch(()=>{});
            sessionStorage.removeItem('admin_token');
            sessionStorage.removeItem('admin_login_time');
            sessionStorage.removeItem('admin_expires_at');
            adminToken = '';
            adminExpiresAt = 0;
            clearInterval(sessionInterval);
            document.getElementById('adminPanel').classList.add('hidden');
            document.getElementById('loginScreen').classList.remove('hidden');
            document.getElementById('adminPass').value = '';
        }

        // =================== TABS ===================
        function switchAdminTab(tab, btn) {
            const allowed=['users','feedback','analytics','tariffs','security','settings'];if(!allowed.includes(tab))tab='users';
            document.querySelectorAll('.tab-btn').forEach(b => {b.classList.remove('active');b.setAttribute('aria-selected','false');});
            btn=btn||document.querySelector(`[data-admin-tab="${tab}"]`);if (btn) {btn.classList.add('active');btn.setAttribute('aria-selected','true');btn.scrollIntoView?.({block:'nearest',inline:'nearest'});}
            ['tabUsers', 'tabFeedback', 'tabAnalytics', 'tabTariffs', 'tabSecurity', 'tabSettings'].forEach(id => {
                document.getElementById(id).classList.toggle('hidden', id !== 'tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
            });
            sessionStorage.setItem('admin_tab',tab);
            if (tab === 'analytics') renderAnalytics();
            if (tab === 'security') renderSecurity();
            if (tab === 'tariffs') loadTariffs();
            if (tab === 'feedback') loadFeedback();
            if (tab === 'settings') loadBroadcast();
        }
        function restoreAdminTab(){const tab=sessionStorage.getItem('admin_tab')||'users';switchAdminTab(tab,document.querySelector(`[data-admin-tab="${tab}"]`));}

        // =================== DATA LOADING ===================
        async function loadStats(){
            if(statsRequest)return statsRequest;
            document.getElementById('lastUpdate').textContent='Завантаження…';refreshSystemHealth();
            statsRequest=(async()=>{try{await ensureAdminIndex();await requestUserPage();}catch(error){document.getElementById('lastUpdate').textContent='Помилка завантаження';showAdminToast(error.message,'error');}finally{statsRequest=null;}})();
            return statsRequest;
        }

        async function refreshSystemHealth() {
            const api=document.getElementById('systemApi'),storage=document.getElementById('systemStorage'),protocol=document.getElementById('systemProtocol');
            try{const data=await adminApi('admin_health');
                api.className='system-chip is-ok';api.textContent=`Worker ${data.version}`;
                storage.className='system-chip '+(data.kv&&data.authority?'is-ok':'is-error');storage.textContent=`KV: ${data.kv?'доступний':'помилка'} · Основне сховище: ${data.authority?'доступне':'помилка'}`;
                protocol.className='system-chip';protocol.textContent=data.readOnly?'Режим лише читання':'Збереження дозволено';
                document.getElementById('systemIntegrations').textContent=Object.entries(data.integrations).map(([key,value])=>`${key.toUpperCase()}: ${value?'налаштовано':'не налаштовано'}`).join(' · ')+'. Це перевірка конфігурації; доставку перевіряйте тестовим повідомленням.';
            }catch{api.className='system-chip is-error';api.textContent='Стан API не перевірено';storage.textContent='Стан сховищ невідомий';protocol.textContent='Повторіть перевірку';}
        }
        async function loadAdminAudit(){
            const target=document.getElementById('adminAuditList');target.textContent='Завантаження…';
            const labels={admin_give_pro:'Надано Pro',admin_revoke_pro:'Відкликано Pro',admin_delete_user:'Видалення акаунта',admin_broadcast:'Оголошення',admin_reset_password:'Скидання пароля',admin_delete_tariff:'Видалення тарифу',admin_clear_tariffs:'Очищення тарифів',admin_verify_tariff:'Перевірка тарифу',admin_feedback_update:'Статус звернення'};
            const status={success:'Завершено',rejected:'Відхилено',failed:'Помилка',attempted:'Запит прийнято; завершення не підтверджено'};
            try{const data=await adminApi('admin_audit_list');target.innerHTML=data.entries.map(entry=>`<div class="p-3 border rounded-xl"><strong>${escHtml(labels[entry.action]||entry.action)}</strong>${entry.target?` · ${escHtml(entry.target)}`:''}<p class="text-slate-500 mt-1">${escHtml(new Date(entry.createdAt).toLocaleString('uk-UA'))} · ${escHtml(status[entry.status]||entry.status)}</p></div>`).join('')||'Дій після цього оновлення ще немає.';}catch{target.textContent='Не вдалося завантажити журнал.';}
        }

        // =================== USERS TABLE ===================
        function getFilteredUsers() {
            if(serverPages)return allUsers;
            const q = (document.getElementById('searchUsers')?.value || '').trim().toLocaleLowerCase('uk-UA');
            const typeFilter = document.getElementById('filterType').value;
            const proFilter = document.getElementById('filterPro').value;
            const activeFilter = document.getElementById('filterActive').value;
            let filtered = allUsers.filter(u => {
                if (q && !String(u.login).toLocaleLowerCase('uk-UA').includes(q) && !String(u.displayName || '').toLocaleLowerCase('uk-UA').includes(q)) return false;
                if (typeFilter === 'google' && !u.hasGoogle) return false;
                if (typeFilter === 'login' && u.hasGoogle) return false;
                if (proFilter === 'pro' && !u.isPro) return false;
                if (proFilter === 'free' && u.isPro) return false;
                if (activeFilter === 'active' && !u.activeThisMonth) return false;
                if (activeFilter === 'inactive' && u.activeThisMonth) return false;
                if (activeFilter === 'suspicious' && !(u.suspicious > 0)) return false;
                return true;
            });
            // Sort
            filtered.sort((a, b) => {
                let va = a[currentSort.field], vb = b[currentSort.field];
                if (va == null) va = ''; if (vb == null) vb = '';
                const comparison = typeof va === 'string' ? va.localeCompare(String(vb), 'uk-UA') : Number(va) - Number(vb);
                return currentSort.dir === 'asc' ? comparison : -comparison;
            });
            return filtered;
        }

        function renderUsers() {
            const filtered = getFilteredUsers();
            if(!serverPages)currentPage = Math.min(currentPage, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
            const start = currentPage * PAGE_SIZE;
            const pageUsers = serverPages?allUsers:filtered.slice(start, start + PAGE_SIZE);
            const total=serverPages?userTotal:filtered.length;
            document.getElementById('usersCount').textContent = `${total} з ${indexedStats?.totalUsers??allUsers.length}`;
            document.getElementById('pageInfo').textContent = pageUsers.length ? `${start + 1}–${start+pageUsers.length} з ${total}` : 'Немає результатів';
            document.querySelector('button[onclick="prevPage()"]').disabled = currentPage === 0;
            document.querySelector('button[onclick="nextPage()"]').disabled = serverPages?!userCursor:start + PAGE_SIZE >= filtered.length;

            document.getElementById('usersTableBody').innerHTML = pageUsers.map(u => {
                const loginAttr = escAttr(u.login);
                const authBadge = u.hasGoogle ? '<span class="badge bg-blue-50 text-blue-600">G</span>' : '<span class="badge bg-slate-100 text-slate-500">L</span>';
                const proBadge = u.isPro ? '<span class="text-yellow-500">⭐</span>' : `<button class="give-pro badge bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100 cursor-pointer" data-login="${loginAttr}">+Pro</button>`;
                const suspBadge = u.suspicious > 0 ? `<span class="badge bg-red-50 text-red-500 ml-1">⚠${u.suspicious}</span>` : '';
                return `<tr class="border-b user-row text-xs">
                    <td class="p-3"><input type="checkbox" class="user-checkbox" data-login="${loginAttr}" onchange="updateSelection()" ${selectedUsers.has(u.login) ? 'checked' : ''} aria-label="Вибрати ${loginAttr}"></td>
                    <td class="p-3 font-bold text-slate-900 max-w-[180px] truncate" title="${loginAttr}">${escHtml(u.login)}${u.displayName ? `<div class="font-normal text-slate-500">${escHtml(u.displayName)}</div>` : ''}${suspBadge}</td>
                    <td class="p-3 text-center">${authBadge}</td>
                    <td class="p-3 text-center font-bold">${u.records || 0}</td>
                    <td class="p-3 text-center">${u.addresses || 0}</td>
                    <td class="p-3 text-center text-slate-400">${escHtml(u.lastMonth || '—')}</td>
                    <td class="p-3 text-center">${Number.isFinite(Number(u.devices)) ? Number(u.devices) : '?'}</td>
                    <td class="p-3 text-center">${proBadge}</td>
                    <td class="p-3 text-center">${u.activeThisMonth ? '<span class="badge bg-green-50 text-green-700">Є запис</span>' : '<span class="text-slate-400">—</span>'}</td>
                    <td class="p-3 text-center">
                        <div class="flex gap-1 justify-center">
                            <button data-action="view" data-login="${loginAttr}" class="admin-user-action px-2 py-1.5 bg-slate-100 rounded hover:bg-slate-200 active:scale-90 font-bold" aria-label="Деталі ${loginAttr}">Деталі</button>
                        </div>
                    </td>
                </tr>`;
            }).join('') || '<tr><td colspan="10" class="admin-empty">За цими фільтрами користувачів немає</td></tr>';
            const selectedOnPage = pageUsers.filter(u => selectedUsers.has(u.login)).length;
            const selectAll = document.getElementById('selectAll');
            selectAll.checked = pageUsers.length > 0 && selectedOnPage === pageUsers.length;
            selectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < pageUsers.length;
            updateSelectionStatus();
            document.querySelectorAll('.give-pro').forEach(btn => btn.addEventListener('click', () => givePro(btn.dataset.login)));
            document.querySelectorAll('.admin-user-action').forEach(btn => btn.addEventListener('click', () => {
                const login = btn.dataset.login;
                if (btn.dataset.action === 'view') viewUser(login);
            }));
        }

        function filterUsers(){currentPage=0;userCursors=[null];usersGeneration++;if(!serverPages){renderUsers();return;}clearTimeout(userFilterTimer);userFilterTimer=setTimeout(()=>requestUserPage().catch(error=>showAdminToast(error.message,'error')),200);}
        function sortUsers(field){if(currentSort.field===field)currentSort.dir=currentSort.dir==='asc'?'desc':'asc';else currentSort={field,dir:'desc'};filterUsers();}
        async function nextPage(){if(usersBusy)return;if(serverPages){if(!userCursor)return;userCursors[currentPage+1]=userCursor;currentPage++;try{await requestUserPage();}catch(error){currentPage--;showAdminToast(error.message,'error');}}else{const max=Math.ceil(getFilteredUsers().length/PAGE_SIZE)-1;if(currentPage<max){currentPage++;renderUsers();}}}
        async function prevPage(){if(usersBusy)return;if(currentPage<=0)return;currentPage--;if(serverPages){try{await requestUserPage();}catch(error){currentPage++;showAdminToast(error.message,'error');}}else renderUsers();}
        function toggleSelectAll() { const checked = document.getElementById('selectAll').checked; document.querySelectorAll('.user-checkbox').forEach(cb => { cb.checked = checked; checked ? selectedUsers.add(cb.dataset.login) : selectedUsers.delete(cb.dataset.login); }); updateSelectionStatus(); }
        function updateSelection() { document.querySelectorAll('.user-checkbox').forEach(cb => cb.checked ? selectedUsers.add(cb.dataset.login) : selectedUsers.delete(cb.dataset.login)); updateSelectionStatus(); }
        function updateSelectionStatus() {
            document.getElementById('selectedCount').textContent = `Вибрано: ${selectedUsers.size}`;
            document.getElementById('bulkProBtn').disabled = selectedUsers.size === 0;
            document.getElementById('bulkDeleteBtn').disabled = selectedUsers.size === 0;
        }

        // =================== ACTIONS ===================
        async function massAction(type) {
            if (selectedUsers.size === 0) return showAdminToast('Виберіть юзерів', 'error');
            const logins = [...selectedUsers];
            if (type === 'pro') {
                if (!confirm(`Надати Pro для ${logins.length} користувачів?`)) return;
            } else if (type === 'delete') {
                const phrase = `ВИДАЛИТИ ${logins.length}`;
                if (prompt(`Це назавжди видалить ${logins.length} акаунтів з усіма їхніми даними. Спершу зробіть резервну копію. Для підтвердження введіть: ${phrase}`) !== phrase) return;
            }
            let done = 0;
            const failed = [];
            for (const login of logins) {
                try { await adminApi(type === 'pro' ? 'admin_give_pro' : 'admin_delete_user', { login }); done++; }
                catch { failed.push(login); }
            }
            selectedUsers.clear();
            showAdminToast(`${type === 'pro' ? 'Pro надано' : 'Видалено'}: ${done} з ${logins.length}${failed.length ? '. Помилка для: ' + failed.join(', ') : ''}`, failed.length ? 'error' : 'success');
            await loadStats();
        }

        async function givePro(login) {
            if (!confirm(`Видати Pro для ${login}?`)) return;
            try { await adminApi('admin_give_pro', { login }); showAdminToast('Pro надано'); await loadStats(); document.getElementById('userModal').classList.add('hidden'); }
            catch (e) { showAdminToast(e.message, 'error'); }
        }

        async function viewUser(login) {
            document.getElementById('modalUserTitle').textContent = login;
            document.getElementById('modalUserContent').innerHTML = '<p class="text-slate-400 animate-pulse">Завантаження...</p>';
            document.getElementById('userModal').classList.remove('hidden');
            try {
                const data = await adminApi('admin_user_data', { login });
                const ud = data.data;
                const totalRecords = (ud.addresses || []).reduce((s, a) => (a.records?.length || 0) + s, 0);
                const loginAttr = escAttr(login);
                let html = `<div class="space-y-4">
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div class="bg-slate-50 p-3 rounded-xl"><p class="text-[9px] font-bold text-slate-400 uppercase">Тип</p><p class="font-bold">${ud.hasGoogle ? '🔵 Google' : '🔐 Login'}</p></div>
                        <div class="bg-slate-50 p-3 rounded-xl"><p class="text-[9px] font-bold text-slate-400 uppercase">Pro</p><p class="font-bold">${ud.isPro ? '⭐ Pro' : '— Free'}</p></div>
                        <div class="bg-slate-50 p-3 rounded-xl"><p class="text-[9px] font-bold text-slate-400 uppercase">Створено</p><p class="font-bold text-xs">${ud.createdAt ? new Date(ud.createdAt).toLocaleDateString('uk-UA') : '—'}</p></div>
                        <div class="bg-slate-50 p-3 rounded-xl"><p class="text-[9px] font-bold text-slate-400 uppercase">Оновлено</p><p class="font-bold text-xs">${ud.updatedAt ? new Date(ud.updatedAt).toLocaleDateString('uk-UA') : '—'}</p></div>
                        <div class="bg-slate-50 p-3 rounded-xl"><p class="text-[9px] font-bold text-slate-400 uppercase">Адрес</p><p class="font-bold">${ud.addresses?.length || 0}</p></div>
                        <div class="bg-slate-50 p-3 rounded-xl"><p class="text-[9px] font-bold text-slate-400 uppercase">Записів</p><p class="font-bold">${totalRecords}</p></div>
                        <div class="bg-slate-50 p-3 rounded-xl"><p class="text-[9px] font-bold text-slate-400 uppercase">Пристрої</p><p class="font-bold">${ud.knownDevices?.length || '—'}</p></div>
                        <div class="bg-slate-50 p-3 rounded-xl"><p class="text-[9px] font-bold text-slate-400 uppercase">Підозріло</p><p class="font-bold ${ud.suspiciousActivity > 0 ? 'text-red-500' : ''}">${ud.suspiciousActivity || 0}</p></div>
                    </div>
                    ${ud.lastIP ? `<div class="bg-slate-50 p-3 rounded-xl text-xs"><strong>Last IP:</strong> ${escHtml(ud.lastIP)} | <strong>Last Device:</strong> ${escHtml((ud.lastDevice || '—').slice(0, 12))}...</div>` : ''}
                    <div class="flex gap-2 flex-wrap">
                        <button data-modal-action="pro" data-login="${loginAttr}" class="admin-modal-action px-3 py-2 bg-yellow-500 text-white rounded-lg text-xs font-bold active:scale-95">⭐ Дати Pro</button>
                        <button data-modal-action="revoke" data-login="${loginAttr}" class="admin-modal-action px-3 py-2 bg-slate-200 text-slate-600 rounded-lg text-xs font-bold active:scale-95">Забрати Pro</button>
                        <button data-modal-action="reset" data-login="${loginAttr}" class="admin-modal-action px-3 py-2 bg-orange-500 text-white rounded-lg text-xs font-bold active:scale-95">🔑 ${ud.hasPassword ? 'Змінити' : 'Створити'} пароль</button>
                        <button data-modal-action="delete" data-login="${loginAttr}" class="admin-modal-action px-3 py-2 bg-red-500 text-white rounded-lg text-xs font-bold active:scale-95">🗑 Видалити</button>
                    </div>`;
                if (ud.addresses) {
                    ud.addresses.forEach(addr => {
                        html += `<div class="bg-slate-50 p-4 rounded-xl"><p class="font-bold mb-2">🏠 ${escHtml(addr.name)}</p>`;
                        html += `<p class="text-xs text-slate-500 mb-2">Записів: ${addr.records?.length || 0}</p>`;
                        if (addr.records?.length) {
                            const last5 = [...addr.records].sort((a, b) => b.month.localeCompare(a.month)).slice(0, 5);
                            html += `<div class="space-y-1">${last5.map(r => `<div class="flex justify-between text-xs bg-white p-2 rounded-lg"><span>${escHtml(r.month)}</span><span class="font-bold">${Number(r.total || 0).toFixed(0)} ₴</span><span class="${r.paid ? 'text-green-500' : 'text-orange-500'}">${r.paid ? '✅' : '⏳'}</span></div>`).join('')}</div>`;
                        }
                        html += `</div>`;
                    });
                }
                html += `</div>`;
                document.getElementById('modalUserContent').innerHTML = html;
                document.querySelectorAll('.admin-modal-action').forEach(btn => btn.addEventListener('click', () => {
                    const modalLogin = btn.dataset.login;
                    if (btn.dataset.modalAction === 'pro') givePro(modalLogin);
                    if (btn.dataset.modalAction === 'revoke') revokePro(modalLogin);
                    if (btn.dataset.modalAction === 'reset') resetPassword(modalLogin);
                    if (btn.dataset.modalAction === 'delete') deleteUser(modalLogin);
                }));
            } catch (e) { document.getElementById('modalUserContent').textContent = e.message; }
        }

        async function revokePro(login) {
            if (!confirm(`Забрати Pro у ${login}?`)) return;
            try { await adminApi('admin_revoke_pro', { login }); showAdminToast('Pro скасовано'); await loadStats(); document.getElementById('userModal').classList.add('hidden'); }
            catch (e) { showAdminToast(e.message, 'error'); }
        }

        function resetPassword(login) {
            passwordLogin = login;
            document.getElementById('passwordModalTitle').textContent = `Новий пароль · ${login}`;
            document.getElementById('newAdminUserPass').value = '';
            document.getElementById('passwordModal').classList.remove('hidden');
            document.getElementById('newAdminUserPass').focus();
        }
        function closePasswordModal() {
            passwordLogin = '';
            document.getElementById('newAdminUserPass').value = '';
            document.getElementById('passwordModal').classList.add('hidden');
        }
        async function saveNewPassword(event) {
            event.preventDefault();
            const login = passwordLogin;
            const newPass = document.getElementById('newAdminUserPass').value;
            if (!login || newPass.length < 8) return showAdminToast('Потрібно щонайменше 8 символів', 'error');
            try { await adminApi('admin_reset_password', { login, newPass }); closePasswordModal(); showAdminToast('Пароль змінено, старі сесії завершено'); }
            catch (e) { showAdminToast(e.message, 'error'); }
        }

        async function deleteUser(login) {
            if (prompt(`Це назавжди видалить акаунт ${login} та його дані. Для підтвердження введіть логін:`) !== login) return;
            try { await adminApi('admin_delete_user', { login }); showAdminToast('Акаунт видалено'); await loadStats(); document.getElementById('userModal').classList.add('hidden'); }
            catch (e) { showAdminToast(e.message, 'error'); }
        }

        function directViewUser() { const login = document.getElementById('directUserSearch').value.trim(); if (login) viewUser(login); }

        // =================== TARIFF MODERATION ===================
        async function loadTariffs() {
            const count = document.getElementById('tariffsCount');
            count.textContent = 'Завантаження тарифів…';
            try {
                const data = await adminApi('admin_get_tariffs');
                allTariffs = Array.isArray(data.tariffs) ? data.tariffs : [];
                const pending = allTariffs.filter(t => !t.verified).length;
                const badge = document.getElementById('pendingTariffsBadge');
                badge.textContent = pending;
                badge.classList.toggle('hidden', pending === 0);
                renderTariffs();
            } catch (e) { count.textContent = e.message; showAdminToast(e.message, 'error'); }
        }

        function renderTariffs() {
            const q = document.getElementById('searchTariffs').value.trim().toLocaleLowerCase('uk-UA');
            const status = document.getElementById('filterTariffs').value;
            const filtered = allTariffs.filter(t => {
                if (status === 'pending' && t.verified) return false;
                if (status === 'verified' && !t.verified) return false;
                return !q || [t.name, t.city, t.region, t.author, t.login].some(value => String(value || '').toLocaleLowerCase('uk-UA').includes(q));
            });
            document.getElementById('tariffsCount').textContent = `${filtered.length} з ${allTariffs.length} тарифів · ${allTariffs.filter(t => !t.verified).length} очікують перевірки`;
            document.getElementById('tariffsTableBody').innerHTML = filtered.map(t => {
                const id = escAttr(t.id);
                const rates = Object.entries({ 'Вода': t.tariffs?.water, 'Гаряча': t.tariffs?.hotWater, 'Електрика': t.tariffs?.electroBase, 'Зима': t.tariffs?.electroWinter, 'Газ': t.tariffs?.gas })
                    .filter(([, value]) => Number(value) > 0).map(([label, value]) => `${label}: ${Number(value).toLocaleString('uk-UA')}`).join(' · ');
                const date = t.updatedAt || t.createdAt;
                return `<tr class="border-b text-xs">
                    <td class="p-3"><strong>${escHtml(t.name)}</strong><div class="text-slate-500">${escHtml([t.city,t.region].filter(Boolean).join(', ') || 'Регіон не вказано')}</div></td>
                    <td class="p-3">${escHtml(t.author || 'Анонім')}<div class="text-slate-500">${escHtml(t.login || '—')}</div></td>
                    <td class="p-3 max-w-[260px] whitespace-normal">${escHtml(rates || '—')}</td>
                    <td class="p-3">${date && !Number.isNaN(Date.parse(date)) ? new Date(date).toLocaleDateString('uk-UA') : '—'}</td>
                    <td class="p-3"><span class="badge ${t.verified ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'}">${t.verified ? 'Підтверджено' : 'Очікує'}</span></td>
                    <td class="p-3"><div class="flex gap-1">
                        <button class="tariff-action px-2 py-1.5 rounded bg-blue-50 text-blue-700 font-bold" data-action="verify" data-id="${id}">${t.verified ? 'Зняти підтвердження' : 'Підтвердити'}</button>
                        <button class="tariff-action px-2 py-1.5 rounded bg-red-50 text-red-700 font-bold" data-action="delete" data-id="${id}">Видалити</button>
                    </div></td></tr>`;
            }).join('') || '<tr><td colspan="6" class="admin-empty">Тарифів за цими умовами немає</td></tr>';
            document.querySelectorAll('.tariff-action').forEach(button => button.addEventListener('click', () => moderateTariff(button.dataset.action, button.dataset.id)));
        }

        async function moderateTariff(action, id) {
            const tariff = allTariffs.find(t => t.id === id);
            if (!tariff) return;
            const label = tariff.name || id;
            if (action === 'delete') {
                if (prompt(`Видалення тарифу «${label}» незворотне. Введіть ВИДАЛИТИ:`) !== 'ВИДАЛИТИ') return;
            } else if (!confirm(`${tariff.verified ? 'Зняти підтвердження' : 'Підтвердити'} тариф «${label}»?`)) return;
            try {
                await adminApi(action === 'delete' ? 'admin_delete_tariff' : 'admin_verify_tariff', { id, ...(action === 'verify' ? { verified: !tariff.verified } : {}) });
                showAdminToast(action === 'delete' ? 'Тариф видалено' : 'Статус тарифу оновлено');
                await loadTariffs();
                await loadStats();
            } catch (e) { showAdminToast(e.message, 'error'); }
        }

        // =================== FEEDBACK ===================
        async function loadFeedback(more=false){
            const generation=more?feedbackGeneration:++feedbackGeneration,owner=adminToken;
            const query={paginated:true,limit:25,cursor:more?feedbackCursor:null,q:document.getElementById('searchFeedback').value,type:document.getElementById('filterFeedbackType').value,status:document.getElementById('filterFeedbackStatus').value};
            if(!more){allFeedback=[];feedbackCursor=null;document.getElementById('feedbackList').textContent='Завантаження…';}
            feedbackBusy=true;document.getElementById('feedbackMore').disabled=true;
            try{await ensureAdminIndex();const data=await adminApi('admin_feedback_list',query);if(generation!==feedbackGeneration||owner!==adminToken)return;if(data.indexReady===false)throw new Error('Індекс ще не готовий');allFeedback=more?[...allFeedback,...(data.feedback||[])]:data.feedback||[];feedbackTotal=data.total??allFeedback.length;feedbackCursor=data.cursor||null;renderFeedback();}
            catch(error){if(generation===feedbackGeneration&&owner===adminToken){document.getElementById('feedbackList').textContent=error.message;showAdminToast(error.message,'error');}}
            finally{if(generation===feedbackGeneration){feedbackBusy=false;document.getElementById('feedbackMore').disabled=false;document.getElementById('feedbackMore').classList.toggle('hidden',!feedbackCursor);}}
        }
        function filterFeedback(){feedbackCursor=null;document.getElementById('feedbackMore').classList.add('hidden');feedbackGeneration++;clearTimeout(feedbackFilterTimer);feedbackFilterTimer=setTimeout(()=>loadFeedback(),200);}
        function loadMoreFeedback(){if(!feedbackBusy&&feedbackCursor)return loadFeedback(true);}
        function renderFeedback(){
            const q=(document.getElementById('searchFeedback')?.value||'').trim().toLocaleLowerCase('uk-UA'),type=document.getElementById('filterFeedbackType')?.value||'all',status=document.getElementById('filterFeedbackStatus')?.value||'active';
            const items=allFeedback.filter(item=>(type==='all'||item.type===type)&&(status==='all'||(status==='active'?item.status!=='done':item.status===status))&&(!q||`${item.login} ${item.contact} ${item.message}`.toLocaleLowerCase('uk-UA').includes(q)));
            const labels={problem:'Проблема',idea:'Ідея',other:'Інше'},categories={login:'Вхід за логіном',registration:'Реєстрація',google:'Google-вхід',other:'Інше'},statuses={new:'Нове',in_progress:'У роботі',done:'Завершено'};
            document.getElementById('feedbackCount').textContent=`Показано ${items.length} із ${feedbackTotal}`;
            document.getElementById('feedbackList').innerHTML=items.map(item=>`<article class="rounded-xl border border-slate-200 p-4 ${item.status==='new'?'bg-emerald-50/40':'bg-white'}"><div class="flex flex-wrap items-start justify-between gap-2"><div><span class="inline-flex px-2 py-1 rounded-lg bg-slate-100 text-[10px] font-black uppercase">${escHtml(labels[item.type]||'Інше')}</span>${item.source==='pre_auth'?'<span class="inline-flex ml-1 px-2 py-1 rounded-lg bg-blue-50 text-blue-700 text-[10px] font-black uppercase">До входу</span>':''}<strong class="ml-2 text-sm">${escHtml(item.login||(item.source==='pre_auth'?'Гість':'—'))}</strong><p class="text-xs text-slate-400 mt-1">${item.category?`${escHtml(categories[item.category]||item.category)} · `:''}${escHtml(new Date(item.createdAt).toLocaleString('uk-UA'))}${item.appVersion?` · v${escHtml(item.appVersion)}`:''}</p></div><select class="feedback-status px-3 py-2 border rounded-lg text-xs font-bold bg-white" data-id="${escAttr(item.id)}" aria-label="Статус звернення"><option value="new" ${item.status==='new'?'selected':''}>${statuses.new}</option><option value="in_progress" ${item.status==='in_progress'?'selected':''}>${statuses.in_progress}</option><option value="done" ${item.status==='done'?'selected':''}>${statuses.done}</option></select></div><p class="mt-3 whitespace-pre-wrap break-words text-sm text-slate-700">${escHtml(item.message)}</p>${item.contact?`<a class="inline-flex mt-3 text-xs font-bold text-blue-600" href="mailto:${escAttr(item.contact)}"><i class="fa-solid fa-envelope mr-2"></i>${escHtml(item.contact)}</a>`:''}</article>`).join('')||'<div class="text-center py-10 text-slate-400"><i class="fa-regular fa-comments text-3xl mb-3"></i><p>Звернень за цим фільтром немає</p></div>';
            document.querySelectorAll('.feedback-status').forEach(select=>select.addEventListener('change',()=>updateFeedbackStatus(select.dataset.id,select.value,select)));
        }
        async function updateFeedbackStatus(id,status,select){
            select.disabled=true;try{await adminApi('admin_feedback_update',{id,status});const item=allFeedback.find(entry=>entry.id===id);if(item)item.status=status;await loadFeedback();await loadStats();showAdminToast('Статус звернення оновлено');}catch(error){showAdminToast(error.message,'error');await loadFeedback();}finally{select.disabled=false;}
        }

        // =================== ANALYTICS ===================
        function renderAnalytics() {
            // Top users
            const top = indexedAnalytics?.topUsers||[...allUsers].sort((a,b)=>b.records-a.records).slice(0,15);
            document.getElementById('topUsers').innerHTML = top.map((u, i) => `<div class="flex justify-between items-center py-2 ${i ? 'border-t' : ''} text-sm"><span class="font-bold truncate max-w-[200px]">${i + 1}. ${escHtml(u.login)}</span><span class="font-black text-blue-600">${u.records}</span></div>`).join('') || '<p class="text-slate-400">Немає даних</p>';

            // Distribution
            const googleCount = indexedStats?.googleUsers??allUsers.filter(u => u.hasGoogle).length;
            const proCount = indexedStats?.proUsers??allUsers.filter(u => u.isPro).length;
            const activeCount = indexedStats?.activeThisMonth??allUsers.filter(u => u.activeThisMonth).length;
            const withRecords = indexedStats?.withRecords??allUsers.filter(u => u.records > 0).length;
            const total = (indexedStats?.totalUsers??allUsers.length)||1;
            document.getElementById('distributionStats').innerHTML = `
                <div class="flex justify-between"><span>Google авторизація</span><span class="font-bold">${googleCount} (${Math.round(googleCount / total * 100)}%)</span></div>
                <div class="flex justify-between"><span>Pro юзери</span><span class="font-bold">${proCount} (${Math.round(proCount / total * 100)}%)</span></div>
                <div class="flex justify-between"><span>Активні цей місяць</span><span class="font-bold">${activeCount} (${Math.round(activeCount / total * 100)}%)</span></div>
                <div class="flex justify-between"><span>З записами</span><span class="font-bold">${withRecords} (${Math.round(withRecords / total * 100)}%)</span></div>
                <div class="flex justify-between"><span>Пусті акаунти</span><span class="font-bold text-orange-600">${(indexedStats?.totalUsers??allUsers.length) - withRecords}</span></div>`;

            // Monthly activity
            const months = {};
            allUsers.forEach(u => { if (u.lastMonth && u.lastMonth !== '—') { months[u.lastMonth] = (months[u.lastMonth] || 0) + 1; } });
            const sortedMonths = indexedAnalytics?indexedAnalytics.months.map(item=>[item.month,item.count]):Object.entries(months).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,12);
            document.getElementById('monthlyActivity').innerHTML = sortedMonths.map(([m, c]) => `<div class="flex justify-between items-center py-1 text-sm"><span class="text-slate-600">${escHtml(m)}</span><div class="flex items-center gap-2"><div class="h-2 bg-blue-500 rounded-full" style="width:${Math.max(4, c * 3)}px"></div><span class="font-bold text-xs">${c}</span></div></div>`).join('') || '<p class="text-slate-400">Немає даних</p>';

            // Device stats
            const deviceCounts = allUsers.map(u => u.devices || 0);
            const avgDevices = indexedStats?Number(indexedStats.averageDevices).toFixed(1):deviceCounts.length?(deviceCounts.reduce((a,b)=>a+b,0)/deviceCounts.length).toFixed(1):0;
            const multiDevice = indexedStats?.multiDevice??allUsers.filter(u => (u.devices || 0) > 1).length;
            document.getElementById('deviceStats').innerHTML = `
                <div class="flex justify-between"><span>Середня к-сть пристроїв</span><span class="font-bold">${avgDevices}</span></div>
                <div class="flex justify-between"><span>Мультипристрій (2+)</span><span class="font-bold">${multiDevice}</span></div>
                <div class="flex justify-between"><span>Підозріла активність</span><span class="font-bold text-red-500">${indexedStats?.suspiciousUsers??allUsers.filter(u => u.suspicious > 0).length}</span></div>`;
        }

        // =================== SECURITY ===================
        function renderSecurity() {
            loadAdminAudit();const suspicious = indexedAnalytics?.suspicious||allUsers.filter(u => u.suspicious > 0).sort((a,b)=>b.suspicious-a.suspicious);
            document.getElementById('suspiciousUsers').innerHTML = suspicious.length ? suspicious.map(u => `<div class="flex justify-between items-center p-3 bg-red-50 rounded-xl border border-red-100"><div><span class="font-bold text-sm">${escHtml(u.login)}</span><span class="ml-2 badge bg-red-100 text-red-600">⚠️ ${u.suspicious} подій</span></div><button data-login="${escAttr(u.login)}" class="security-view-user px-3 py-1 bg-white rounded-lg text-xs font-bold border hover:bg-slate-50 active:scale-95">👁</button></div>`).join('') : '<p class="text-slate-400">Сигналів зміни пристрою немає. Це не перевірка всіх загроз.</p>';
            document.querySelectorAll('.security-view-user').forEach(btn => btn.addEventListener('click', () => viewUser(btn.dataset.login)));

        }

        // =================== EXPORT ===================
        function csvCell(value) {
            const raw = String(value ?? '');
            const text = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
            return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        }

        async function exportAllData() {
            let exportUsers=allUsers;if(serverPages){try{exportUsers=[];let cursor;do{const data=await adminApi('admin_stats',{paginated:true,limit:100,sort:'login',dir:'asc',cursor});if(!data.indexReady)throw new Error('Індекс недоступний');exportUsers.push(...data.users);cursor=data.cursor;}while(cursor);}catch(error){showAdminToast(error.message,'error');return;}}
            const rows = [
                ['Login', 'Type', 'Pro', 'Records', 'Addresses', 'LastMonth', 'Active', 'Devices', 'Suspicious'],
                ...exportUsers.map(u => [u.login, u.hasGoogle ? 'Google' : 'Login', u.isPro ? 'Pro' : 'Free', u.records, u.addresses, u.lastMonth, u.activeThisMonth ? 'Yes' : 'No', u.devices || 0, u.suspicious || 0])
            ];
            const csv = rows.map(row => row.map(csvCell).join(',')).join('\n') + '\n';
            downloadFile('\uFEFF' + csv, 'komunalka_users.csv', 'text/csv');
            showAdminToast('CSV експортовано');
        }

        async function exportFullBackup() {
            const progress = document.getElementById('backupProgress');
            progress.textContent = 'Читаю список акаунтів…';
            const authorities=[],kvEntries=[];let cursor,readOnly=true;
            const password=document.getElementById('backupPassword').value;
            if(password.length<12){progress.textContent='Вкажіть пароль шифрування: щонайменше 12 символів.';return;}
            try {
                const accounts=await adminApi('admin_stats');
                if(!Array.isArray(accounts.users))throw new Error('Неповний список акаунтів.');
                for(const user of accounts.users){progress.textContent=`Акаунти: ${authorities.length+1} з ${accounts.users.length}`;const result=await adminApi('admin_backup_account',{login:user.login});authorities.push(result.snapshot);readOnly=readOnly&&result.readOnly;}
                do{const page=await adminApi('admin_backup_page',{cursor});if(!Array.isArray(page.entries))throw new Error('Неповна сторінка KV');kvEntries.push(...page.entries);readOnly=readOnly&&page.readOnly;cursor=page.cursor;if(!page.listComplete&&!cursor)throw new Error('Неповна сторінка KV');}while(cursor);
                const catalogue=await adminApi('admin_backup_community');readOnly=readOnly&&catalogue.readOnly;
                const finalAccounts=await adminApi('admin_stats');if(JSON.stringify(finalAccounts.users.map(u=>u.login).sort())!==JSON.stringify(accounts.users.map(u=>u.login).sort()))throw new Error('Список акаунтів змінився під час копіювання. Повторіть.');
                for(const snapshot of authorities){const check=await adminApi('admin_backup_account',{login:snapshot.login});if(check.revision!==snapshot.account.revision)throw new Error('Акаунт змінився під час копіювання. Повторіть.');}
                const finalCatalogue=await adminApi('admin_backup_community');if(finalCatalogue.community.revision!==catalogue.community.revision)throw new Error('Каталог змінився під час копіювання. Повторіть.');
                const archive=await KomunalkaBackup.create({authorities,kvEntries,community:catalogue.community,version:APP_VERSION,readOnly,unrecognizedAccounts:accounts.unrecognizedAccounts||0});await KomunalkaBackup.verify(archive);
                const encrypted=await KomunalkaBackup.seal(archive,password);downloadFile(JSON.stringify(encrypted,null,2),`komunalka_recovery_${new Date().toISOString().slice(0,10)}.encrypted.json`,'application/json');
                document.getElementById('backupPassword').value='';sessionStorage.setItem('lastBackupAt',new Date().toISOString());
                progress.textContent=`Зашифровану копію створено: ${archive.manifest.accounts} акаунтів, ${archive.manifest.kvKeys} ключів KV. ${readOnly?'Режим лише читання.':'Для міграції потрібна копія в режимі лише читання.'} Для перевірки відновлення використайте backup:restore-check.`;
                if(accounts.unrecognizedAccounts)progress.textContent+=` У KV збережено ${accounts.unrecognizedAccounts} нерозпізнаних значень; перед міграцією потрібна їх перевірка.`;showAdminToast('Зашифровану резервну копію завантажено');
            }catch(error){progress.textContent = 'Експорт не завершено. Дані на сервері не змінено.';showAdminToast(error.message,'error');}
        }

        async function cleanupEmptyAccounts() {
            const empty = allUsers.filter(u => u.records === 0 && u.addresses === 0);
            if (!empty.length) return showAdminToast('Акаунтів без адрес і записів немає');
            const names = empty.map(u => u.login).join(', ');
            if (prompt(`Перевірте ${empty.length} акаунтів без адрес і записів: ${names}. Вони можуть містити налаштування чи прив’язку Google. Для видалення введіть ВИДАЛИТИ ПОРОЖНІ:`) !== 'ВИДАЛИТИ ПОРОЖНІ') return;
            let deleted = 0, failed = 0;
            for (const u of empty) {
                try { await adminApi('admin_delete_user', { login: u.login }); deleted++; } catch { failed++; }
            }
            showAdminToast(`Видалено: ${deleted}. Помилок: ${failed}`, failed ? 'error' : 'success');
            await loadStats();
        }

        function downloadFile(content, filename, type) {
            const blob = new Blob([content], { type });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        }

        // =================== BROADCAST ===================
        function openBroadcast() { document.getElementById('broadcastModal').classList.remove('hidden'); }
        async function loadBroadcast() {
            const target = document.getElementById('currentBroadcast');
            try {
                const data = await adminApi('get_broadcast');
                target.textContent = data.message ? `${data.message}${data.date ? ' · ' + data.date : ''}` : 'Наразі оголошення немає.';
            } catch (e) { target.textContent = e.message; }
        }
        async function publishBroadcast(msg) {
            if (!msg) return showAdminToast('Введіть текст оголошення', 'error');
            if (msg.length > 500) return showAdminToast('Не більше 500 символів', 'error');
            if (!confirm(`Опублікувати оголошення для всіх користувачів?\n\n${msg}`)) return;
            try { await adminApi('admin_broadcast', { message: msg }); showAdminToast('Оголошення опубліковано'); await loadBroadcast(); return true; }
            catch (e) { showAdminToast(e.message, 'error'); return false; }
        }
        async function sendBroadcast() {
            const msg = document.getElementById('broadcastMsg').value.trim();
            if (await publishBroadcast(msg)) { document.getElementById('broadcastModal').classList.add('hidden'); document.getElementById('broadcastMsg').value = ''; }
        }

        async function sendBroadcastFromSettings() {
            const msg = document.getElementById('broadcastMsgSettings').value.trim();
            if (await publishBroadcast(msg)) document.getElementById('broadcastMsgSettings').value = '';
        }

        // =================== KEYBOARD ===================
        document.getElementById('adminPass').addEventListener('keydown', e => { if (e.key === 'Enter') adminLogin(); });
        document.getElementById('directUserSearch')?.addEventListener('keydown', e => { if (e.key === 'Enter') directViewUser(); });
        document.getElementById('passwordForm').addEventListener('submit', saveNewPassword);

        // =================== AUTO-REFRESH ===================
        setInterval(() => { if (adminToken && document.visibilityState === 'visible') loadStats(); }, 300000); // 5 min
