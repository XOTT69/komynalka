import {pushConfigured} from './push-delivery.js';
import {handleTelegramWebhook,prepareBot,randomLinkToken} from './telegram.js';
import {verifyFirebaseToken} from './auth-token.js';
import {createOpaqueToken,createPasswordVerifier,parseSessionToken,passwordPolicy,sessionToken,sha256Hex,validLogin,verifyPassword} from './password-auth.js';
export {AccountStore} from './account-store.js';
// ============================================================
// КОМУНАЛКА Worker — синхронізація, сесії, нагадування та адміністрування
// ============================================================

const CORS = {
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-FP',
};

const ok  = (d, s=200) => new Response(JSON.stringify(d), {
  status: s, headers: { ...CORS, 'Content-Type': 'application/json' }
});
const err = (msg, s) => ok({ success: false, error: msg }, s);

const sha256 = sha256Hex;

async function accountRequest(env,login,body){
  if(!env.ACCOUNT_STORE)throw new Error('ACCOUNT_STORE_NOT_CONFIGURED');
  const stub=env.ACCOUNT_STORE.get(env.ACCOUNT_STORE.idFromName(login));
  const response=await stub.fetch(new Request('https://account.internal',{method:'POST',body:JSON.stringify({login,...body})}));
  const result=await response.json();if(!response.ok){const error=new Error(result.error||'ACCOUNT_STORE_FAILED');error.status=response.status;throw error;}return result;
}
async function specialRequest(env,name,body){return accountRequest(env,`__${name}__`,body);}
async function getUser(env,login){
  let data;
  if(env.ACCOUNT_STORE){const result=await accountRequest(env,login,{action:'read'});data=result.value?{...result.value,_revision:result.revision}:null;}
  else{const raw=await env.KV.get(login);data=raw?JSON.parse(raw):null;}
  if(data&&(!Array.isArray(data)&&typeof data==='object')){if(data.pass&&!data.passHash)data.passHash=data.pass;if(data.passHash&&!data.pass)data.pass=data.passHash;return data;}
  if(data!==null)throw new Error('INVALID_ACCOUNT_DATA');return null;
}
async function saveUser(env,login,data,options={}){
  if(data.passHash&&!data.pass)data.pass=data.passHash;if(data.pass&&!data.passHash)data.passHash=data.pass;
  const {_revision=0,...value}=data;
  return accountRequest(env,login,{action:'write',value,expectedRevision:options.expectedRevision??_revision,mutationId:options.mutationId,fingerprint:options.fingerprint});
}

function normalize(d) {
  if (!d) return null;
  if (d.addresses && Array.isArray(d.addresses) && d.addresses.length > 0) return d;
  if (d.records || d.tariffs) {
    return {
      ...d,
      addresses: [{
        id: 'default', name: 'Мій дім',
        tariffs:        d.tariffs        || {},
        prefs:          d.prefs          || {},
        records:        d.records        || [],
        customServices: d.customServices || [],
      }],
      currentAddressId: 'default',
    };
  }
  return d;
}

async function rateLimit(env, key, limit, ms) {
  if(env.ACCOUNT_STORE){const result=await specialRequest(env,'security',{action:'rate-limit',key,limit,windowMs:ms});return result.allowed===true;}
  const bucket=Math.floor(Date.now()/ms),k=`rl:${key}:${bucket}`,cur=parseInt((await env.KV.get(k))||'0');
  if(cur>=limit)return false;await env.KV.put(k,String(cur+1),{expirationTtl:Math.ceil(ms/1000*2)});return true;
}

async function parseAuth(req,env) {
  const h = (req.headers.get('Authorization') || '').trim();
  if (!h.startsWith('Bearer ')) return null;
  const t = h.slice(7);
  if(t.startsWith('uid:'))return null;
  if(t.startsWith('s1.')){
    const parsed=parseSessionToken(t);if(!parsed)return null;
    return {type:'session',login:parsed.login,tokenHash:await sha256(parsed.token)};
  }
  if(t.split('.').length===3){try{return {type:'uid',uid:await verifyFirebaseToken(t,env.FIREBASE_PROJECT_ID||'pwakomun')};}catch{return null;}}
  if (t.startsWith('login:')) {
    const rest = t.slice(6);
    const idx  = rest.lastIndexOf(':');
    if (idx < 1) return null;
    try {
      const login    = decodeURIComponent(escape(atob(rest.slice(0, idx))));
      const passHash = rest.slice(idx + 1);
      if (!login || passHash.length !== 64) return null;
      return { type: 'login', login: login.toLowerCase().trim(), passHash };
    } catch { return null; }
  }
  return null;
}

async function resolveLogin(env, auth) {
  if(auth.type==='session'){
    const result=await accountRequest(env,auth.login,{action:'session-verify',tokenHash:auth.tokenHash}).catch(()=>null);
    return result?.success?auth.login:null;
  }
  if (auth.type === 'uid') {
    let linked = await env.KV.get(`uid:${auth.uid}`);
    if (linked) return linked;
    const oldGoogle=await env.KV.get(`google_${auth.uid}`);if(oldGoogle&&oldGoogle.length<=80)return oldGoogle;
    const legacyKey = `uid_${auth.uid}`;
    const legacyRaw = await env.KV.get(legacyKey);
    if (legacyRaw) {
      try {
        const parsed = JSON.parse(legacyRaw);
        if (parsed && typeof parsed === 'object') return legacyKey;
      } catch {
        return legacyRaw;
      }
    }
    return null;
  }
  const l = auth.login;
  if(!l||l.length<2||l.length>80)return null;
  const alias=await env.KV.get(`login-alias:${encodeURIComponent(l)}`);if(alias)return alias;
  if(await env.KV.get(l)!==null||await env.KV.get(`account-index:${encodeURIComponent(l)}`)!==null)return l;
  // Existing account keys may retain capitalization from earlier deployments.
  let cursor;const matches=[];
  do{const page=await env.KV.list({limit:1000,...(cursor?{cursor}:{})});matches.push(...page.keys.filter(k=>k.name.toLowerCase()===l).map(k=>k.name));cursor=page.list_complete?null:page.cursor;}while(cursor);
  if(matches.length>1)throw new Error('AMBIGUOUS_LEGACY_LOGIN');
  if(matches[0]){await env.KV.put(`login-alias:${encodeURIComponent(l)}`,matches[0]);return matches[0];}
  return l;
}

function publicAccount(data,login){
  const normalized=normalize(data),addrs=normalized?.addresses||[];
  return {revision:normalized?._revision??0,syncProtocol:2,accountSettings:normalized?.accountSettings,addresses:addrs,currentAddressId:normalized?.currentAddressId||addrs[0]?.id||null,isPro:normalized?.isPro||false,hasGoogle:normalized?.hasGoogle||false,hasPassword:Boolean(normalized?.credential||normalized?.passHash||normalized?.pass),displayName:normalized?.displayName||'',createdAt:normalized?.createdAt||null,linkedLogin:login};
}

async function issueSession(env,login,device=''){
  const token=sessionToken(login),tokenHash=await sha256(token),result=await accountRequest(env,login,{action:'session-create',tokenHash,ttl:30*86400000,device});
  return {token,expiresAt:result.expiresAt};
}

async function readCommunity(env){
  if(env.ACCOUNT_STORE)return specialRequest(env,'community',{action:'community-read'});
  let list=[];try{const raw=await env.KV.get('community_tariffs');if(raw)list=JSON.parse(raw);if(!Array.isArray(list))list=[];}catch{list=[];}return{list,revision:0};
}

async function mutateCommunity(env,mutator){
  for(let attempt=0;attempt<4;attempt++){
    const current=await readCommunity(env),draft=structuredClone(current.list),result=mutator(draft);
    if(!result)return null;
    if(!env.ACCOUNT_STORE){await env.KV.put('community_tariffs',JSON.stringify(result.list),{expirationTtl:86400*365});return result.value;}
    try{await specialRequest(env,'community',{action:'community-replace',expectedRevision:current.revision,list:result.list});return result.value;}catch(error){if(error.status!==409||attempt===3)throw error;}
  }
  throw new Error('COMMUNITY_CONFLICT');
}

async function verifyAccountPassword(data,password){
  if(data?.credential)return verifyPassword(String(password||''),data.credential);
  const legacy=data?.passHash||data?.pass;if(!legacy)return false;
  return (await sha256(String(password||'')))===legacy;
}

async function doAuthLogin(body,env,ip,fp){
  const requested=String(body.login||'').trim().toLowerCase(),password=String(body.password||'');
  if(!validLogin(requested)||!password)return err('INVALID_CREDENTIALS',400);
  const ipKey=(await sha256(String(ip||'unknown'))).slice(0,24);
  if(!await rateLimit(env,`login-ip:${ipKey}`,20,15*60000)||!await rateLimit(env,`login-user:${requested}`,8,15*60000))return err('TOO_MANY_ATTEMPTS',429);
  const login=await resolveLogin(env,{type:'login',login:requested,passHash:'0'.repeat(64)}),data=await getUser(env,login);
  if(!data||!await verifyAccountPassword(data,password))return err('INVALID_CREDENTIALS',403);
  let normalized=normalize(data);
  if(!normalized.credential){
    const credential=await createPasswordVerifier(password),{pass:_pass,passHash:_passHash,...clean}=normalized;
    normalized={...clean,credential};
    try{
      const saved=await saveUser(env,login,normalized,{expectedRevision:data._revision??0});normalized={...normalized,_revision:saved.revision};
    }catch(error){
      // Two devices may perform the first legacy login simultaneously. The winner
      // performs the migration; the other re-reads the now-modern credential.
      if(error.status!==409)throw error;
      const current=await getUser(env,login);if(!current?.credential||!await verifyAccountPassword(current,password))return err('CONFLICT',409);
      normalized=normalize(current);
    }
  }
  const session=await issueSession(env,login,fp);
  return ok({success:true,sessionToken:session.token,sessionExpiresAt:session.expiresAt,data:publicAccount(normalized,login)});
}

async function doAuthRegister(body,env,ip,fp){
  const login=String(body.login||'').trim().toLowerCase(),password=String(body.password||'');
  if(!validLogin(login))return err('INVALID_LOGIN',400);
  const policyError=passwordPolicy(password);if(policyError)return err(policyError,400);
  const ipKey=(await sha256(String(ip||'unknown'))).slice(0,24);
  if(!await rateLimit(env,`register-ip:${ipKey}`,5,86400000))return err('TOO_MANY_ATTEMPTS',429);
  const resolved=await resolveLogin(env,{type:'login',login,passHash:'0'.repeat(64)}),existing=await getUser(env,resolved);
  if(existing)return err('ACCOUNT_EXISTS',409);
  const value={credential:await createPasswordVerifier(password),displayName:'',addresses:[],currentAddressId:null,accountSettings:{},hasGoogle:false,isPro:false,createdAt:new Date().toISOString(),knownDevices:[fp],suspiciousActivity:0,lastDevice:fp};
  const saved=await saveUser(env,login,value,{expectedRevision:0}),data={...value,_revision:saved.revision};
  const session=await issueSession(env,login,fp);return ok({success:true,sessionToken:session.token,sessionExpiresAt:session.expiresAt,data:publicAccount(data,login)},201);
}

function getUidLogin(uid) {
  const safe = String(uid || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return safe ? `uid_${safe}` : null;
}

const handler = {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url   = new URL(req.url);
    const share = url.searchParams.get('share');
    const ip    = req.headers.get('CF-Connecting-IP') || 'unknown';
    const fp    = (req.headers.get('X-Device-FP') || 'unknown').slice(0, 64);
    try {
      if(url.pathname==='/telegram')return req.method==='POST'?handleTelegramWebhook(req,env,accountRequest):err('Method not allowed',405);
      if(url.searchParams.has('push-config'))return ok({success:true,enabled:Boolean(env.ACCOUNT_STORE)&&pushConfigured(env),publicKey:env.ACCOUNT_STORE&&pushConfigured(env)?env.VAPID_PUBLIC_KEY:null});
      if(url.searchParams.has('health'))return ok({success:true,syncProtocol:env.ACCOUNT_STORE?2:0,readOnly:env.MAINTENANCE_MODE==='read-only'});
      if(url.searchParams.has('admin-access'))return await doAdminAccess(req,env);
      if (share)                 return await doShare(req, env, share, ip);
      if (req.method === 'GET')  return await doGet(req, env, ip, fp);
      if (req.method === 'POST') return await doPost(req, env, ip, fp);
      return err('Method not allowed', 405);
    } catch (e) {
      console.error('Worker:', e?.message);
      const clientError=['PUSH_NOT_CONNECTED','TELEGRAM_NOT_CONNECTED','TEST_RATE_LIMITED','PUSH_TEST_FAILED','TELEGRAM_TEST_FAILED'];
      return err(clientError.includes(e.message)?e.message:e.status===409?'CONFLICT':e.message==='ACCOUNT_STORE_NOT_CONFIGURED'?'SERVER_UPDATE_REQUIRED':'Internal server error',e.status||503);
    }
  }
};

async function doAdminAccess(req,env) {
  const owner=String(env.ADMIN_OWNER_LOGIN||'').trim().toLowerCase();
  if(!owner)return ok({success:true,allowed:false});
  const auth=await parseAuth(req,env);
  if(!auth)return err('NO_AUTH',401);
  const login=await resolveLogin(env,auth);
  if(!login)return err('NOT_FOUND',404);
  const data=await getUser(env,login);
  if(!data)return err('NOT_FOUND',404);
  if(auth.type==='login'&&(data.passHash||data.pass)!==auth.passHash)return err('WRONG_PASSWORD',403);
  return ok({success:true,allowed:login.toLowerCase()===owner});
}

async function doGet(req, env, ip, fp) {
  const auth = await parseAuth(req,env);
  if (!auth) return err('NO_AUTH', 401);
  const login = await resolveLogin(env, auth);
  if (!login) return ok({success:false,error:'NOT_FOUND',syncProtocol:env.ACCOUNT_STORE?2:0},404);
  const data = await getUser(env, login);
  if (!data) return ok({success:false,error:'NOT_FOUND',syncProtocol:env.ACCOUNT_STORE?2:0},404);
  const storedPass = data.passHash || data.pass;
  if (auth.type === 'login' && storedPass !== auth.passHash) {
    return err('WRONG_PASSWORD', 403);
  }
  const normalized = normalize(data);
  const addrs      = normalized.addresses || [];
  const devs = normalized.knownDevices || [];
  if (!devs.includes(fp)) devs.push(fp);
  return ok({success:true,data:{...publicAccount(normalized,login),syncProtocol:env.ACCOUNT_STORE?2:0}});
}

async function doPost(req, env, ip, fp) {
  const cl = parseInt(req.headers.get('content-length') || '0');
  if (cl > 512 * 1024) return err('PAYLOAD_TOO_LARGE', 413);
  let body;
  try {body=await readBody(req);}catch(e){return err(e.message,e.message==='PAYLOAD_TOO_LARGE'?413:400);}
  const action = typeof body.action === 'string' ? body.action : '';

  if(env.MAINTENANCE_MODE==='read-only'&&!['auth_login','admin_login','admin_stats','admin_user_data','admin_backup_page','admin_get_tariffs','admin_feedback_list','get_tariffs','get_broadcast','push_status','push_unsubscribe'].includes(action))return err('MAINTENANCE_READ_ONLY',503);
  if(action==='auth_login')return doAuthLogin(body,env,ip,fp);
  if(action==='auth_register')return doAuthRegister(body,env,ip,fp);
  if (action === 'admin_login' || action.startsWith('admin_')) return doAdmin(action, body, env, ip);
  if (action === 'get_broadcast') return doGetBroadcast(env);
  if(action==='link_google'){const auth=await parseAuth(req,env);if(auth?.type!=='uid'||auth.uid!==body.uid)return err('NO_AUTH',401);return doLinkGoogle(body,env);}
  if(action==='feedback_public_submit')return doPublicFeedbackSubmit(body,env,ip);

  // ═══ Публічні дії (без суворої автентифікації) ═══
  // get_tariffs — доступний для всіх авторизованих
  if (action === 'get_tariffs') return doGetTariffs(env);

  const auth = await parseAuth(req,env);
  if (!auth) return err('NO_AUTH', 401);
  let login = await resolveLogin(env, auth);
  if (!login && auth.type === 'uid' && action === '' && Array.isArray(body.addresses)) {
    login = getUidLogin(auth.uid);
    if (login) await env.KV.put(`uid:${auth.uid}`, login);
  }
  if (!login) return err('NOT_FOUND', 404);
  if (!await rateLimit(env, `post:${login}`, 60, 60000)) return err('RATE_LIMITED', 429);

  let userData = await getUser(env, login);

  if (!userData) {
    if ((auth.type === 'login' || auth.type === 'uid') && action === '' && Array.isArray(body.addresses)) {
      userData = {
        ...(auth.type === 'login' ? { pass: auth.passHash, passHash: auth.passHash } : {}),
        displayName: '', addresses: [], currentAddressId: null,
        hasGoogle: auth.type === 'uid', isPro: false,
        createdAt: new Date().toISOString(),
        knownDevices: [fp], suspiciousActivity: 0,
        lastIP: ip, lastDevice: fp,
      };
    } else {
      return err('NOT_FOUND', 404);
    }
  } else {
    const storedPass = userData.passHash || userData.pass;
    if (auth.type === 'login' && storedPass !== auth.passHash) {
      return err('WRONG_PASSWORD', 403);
    }
    userData = normalize(userData);
  }

  if(action==='auth_upgrade_session'){
    if(auth.type!=='login')return err('INVALID_AUTH_UPGRADE',400);
    const session=await issueSession(env,login,fp);return ok({success:true,sessionToken:session.token,sessionExpiresAt:session.expiresAt});
  }
  if(action==='auth_logout'){
    if(auth.type==='session')await accountRequest(env,login,{action:'session-revoke',tokenHash:auth.tokenHash});
    return ok({success:true});
  }

  switch (action) {
    case 'telegram_status':{
      if(!env.TG_BOT_TOKEN)return ok({success:true,available:false,connected:false});
      const {chatId,...status}=await accountRequest(env,login,{action:'telegram-status'});
      return ok({...status,available:true});
    }
    case 'telegram_begin':{
      if(!env.TG_BOT_TOKEN)return err('TELEGRAM_NOT_CONFIGURED',503);
      const owner=String(env.ADMIN_OWNER_LOGIN||'').trim().toLowerCase();
      let username;try{username=await prepareBot(env,req.url,{allowConflict:Boolean(owner)&&login.toLowerCase()===owner});}catch(e){return err(e.message,503);}
      const ticket=randomLinkToken();
      await accountRequest(env,login,{action:'telegram-begin',ticket});
      await env.KV.put(`tg-link:${ticket}`,login,{expirationTtl:600});
      return ok({success:true,url:`https://t.me/${username}?start=${ticket}`});
    }
    case 'telegram_unlink':{
      const result=await accountRequest(env,login,{action:'telegram-unlink'});
      if(result.previousChatId)await env.KV.delete(`tg-chat:${result.previousChatId}`);
      return ok({success:true});
    }
    case 'telegram_test':return ok(await accountRequest(env,login,{action:'telegram-test'}));
    case 'push_subscribe':return ok(await accountRequest(env,login,{action:'push-subscribe',subscription:body.subscription}));
    case 'push_unsubscribe':return ok(await accountRequest(env,login,{action:'push-unsubscribe',endpoint:body.endpoint}));
    case 'push_status':return ok(await accountRequest(env,login,{action:'push-status',endpoint:body.endpoint}));
    case 'push_test':return ok(await accountRequest(env,login,{action:'push-test',endpoint:body.endpoint}));
    case 'change_password':  return doChangePass(body, env, login, userData, auth, fp);
    case 'account_export':   return doAccountExport(userData,login);
    case 'delete_account':   return doDeleteAccount(body,env,login,userData,auth);
    case 'share_list':       return doListShares(env,login);
    case 'share_revoke':     return doRevokeShare(body,env,login);
    case 'update_name':      return doUpdateName(body, env, login, userData);
    case 'feedback_submit':  return doFeedbackSubmit(body,env,login);
    case 'generate_share':   return doGenerateShare(body, env, login, userData);
    case 'ai_chat':          return doAiChat(body, env, login);
    // ═══ НОВІ: тарифи спільноти ═══
    case 'publish_tariff':   return doPublishTariff(body, env, login, ip);
    case 'vote_tariff':      return doVoteTariff(body, env, login);
    default:                 return doSave(body, env, login, userData, ip, fp);
  }
}

async function doSave(body,env,login,data,ip,fp){
  if(!Array.isArray(body.addresses)||body.addresses.length<1||body.addresses.length>10)return err('INVALID_DATA',400);
  if(!body.addresses.every(a=>a&&a.id!=null&&Array.isArray(a.records)&&a.records.every(r=>r&&r.id!=null&&/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month)&&Number.isFinite(Number(r.total)))))return err('INVALID_DATA',400);
  if(new Set(body.addresses.map(a=>String(a.id))).size!==body.addresses.length||body.addresses.some(a=>new Set(a.records.map(r=>String(r.id))).size!==a.records.length))return err('DUPLICATE_ID',400);
  if(!Number.isInteger(body.baseRevision)||typeof body.clientMutationId!=='string'||body.clientMutationId.length>128)return err('SYNC_UPGRADE_REQUIRED',409);
  const value={...data,addresses:body.addresses,currentAddressId:body.currentAddressId||data.currentAddressId,accountSettings:body.accountSettings??data.accountSettings??{},updatedAt:new Date().toISOString(),lastIP:ip,lastDevice:fp,knownDevices:[...new Set([...(data.knownDevices||[]),fp])].slice(-10)};
  const result=await saveUser(env,login,value,{expectedRevision:body.baseRevision,mutationId:body.clientMutationId,fingerprint:await sha256(JSON.stringify({addresses:body.addresses,currentAddressId:body.currentAddressId,accountSettings:body.accountSettings}))});
  return ok({success:true,revision:result.revision});
}

async function doUpdateName(body, env, login, data) {
  const name = String(body.displayName || '').trim().slice(0, 50);
  await saveUser(env, login, { ...data, displayName: name });
  return ok({ success: true, displayName: name });
}

async function doFeedbackSubmit(body,env,login){
  const type=String(body.type||''),message=String(body.message||'').trim(),contact=String(body.contact||'').trim(),appVersion=String(body.appVersion||'').slice(0,40);
  if(!['problem','idea','other'].includes(type)||message.length<10||message.length>1500)return err('INVALID_FEEDBACK',400);
  if(contact&&(contact.length>254||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contact)))return err('INVALID_CONTACT',400);
  if(!await rateLimit(env,`feedback:${login}`,5,86400000))return err('FEEDBACK_RATE_LIMITED',429);
  const id=`${Date.now()}-${randomLinkToken().slice(0,12)}`,createdAt=new Date().toISOString();
  await env.KV.put(`feedback:${id}`,JSON.stringify({id,type,message,contact,login,createdAt,status:'new',appVersion}));
  return ok({success:true,id});
}

async function doPublicFeedbackSubmit(body,env,ip){
  if(String(body.website||'').trim())return ok({success:true});
  const category=String(body.category||''),message=String(body.message||'').trim(),contact=String(body.contact||'').trim(),appVersion=String(body.appVersion||'').slice(0,40);
  if(!['login','registration','google','other'].includes(category)||message.length<10||message.length>1500)return err('INVALID_FEEDBACK',400);
  if(contact&&(contact.length>254||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contact)))return err('INVALID_CONTACT',400);
  const ipKey=(await sha256(String(ip||'unknown'))).slice(0,24);
  if(!await rateLimit(env,`feedback-public:${ipKey}`,3,86400000))return err('FEEDBACK_RATE_LIMITED',429);
  const id=`${Date.now()}-${randomLinkToken().slice(0,12)}`,createdAt=new Date().toISOString();
  await env.KV.put(`feedback:${id}`,JSON.stringify({id,type:'problem',category,source:'pre_auth',message,contact,login:'',createdAt,status:'new',appVersion}));
  return ok({success:true,id});
}

async function doShare(req, env, token, ip) {
  if (!/^[A-Za-z0-9_-]{12,128}$/.test(token)) return err('INVALID_TOKEN', 400);
  const raw = await env.KV.get(`share:${token}`)||await env.KV.get(`share_${token}`);
  if (!raw) return err('INVALID_OR_EXPIRED', 404);
  let sd;
  try { sd = JSON.parse(raw); } catch { return err('INVALID_TOKEN', 400); }
  const uData = normalize(await getUser(env,sd.login||sd.phone));
  if (!uData) return err('NOT_FOUND', 404);
  const addr = (uData.addresses || []).find(a => String(a.id) === String(sd.addressId));
  if (!addr) return err('ADDRESS_NOT_FOUND', 404);
  if (req.method === 'GET') return ok({ success: true, data: { addresses: [addr], currentAddressId: sd.addressId } });
  if(req.method==='POST')return err('READ_ONLY_SHARE',403);
  return err('Method not allowed', 405);
}

async function doGetBroadcast(env) {
  const raw = await env.KV.get('broadcast')||await env.KV.get('_broadcast');
  if (!raw) return ok({ success: true, message: null });
  try { return ok({ success: true, ...JSON.parse(raw) }); }
  catch { return ok({ success: true, message: null }); }
}

async function doLinkGoogle(body, env) {
  const { login, uid, password } = body;
  if (!login || !uid) return err('MISSING_PARAMS', 400);
  const requested=String(login).toLowerCase().trim().slice(0, 80);
  const cl=await resolveLogin(env,{type:'login',login:requested,passHash:'0'.repeat(64)});
  const uData = await getUser(env, cl);
  if (!uData) return err('NOT_FOUND', 404);
  if (!password || !await verifyAccountPassword(uData,password)) return err('WRONG_PASSWORD', 403);
  let next=normalize(uData);if(!next.credential){const credential=await createPasswordVerifier(password),{pass:_pass,passHash:_passHash,...clean}=next;next={...clean,credential};}
  await env.KV.put(`uid:${uid}`, cl);
  await saveUser(env, cl, { ...next, hasGoogle: true });
  return ok({ success: true });
}

async function doChangePass(body, env, login, data, auth, fp) {
  const { oldPass, newPass } = body;
  const policyError=passwordPolicy(newPass);if(policyError)return err(policyError,400);
  const hasCredential=Boolean(data.credential||data.passHash||data.pass);
  if(hasCredential&&!await verifyAccountPassword(data,oldPass))return err('WRONG_PASSWORD',403);
  if(!hasCredential&&auth.type!=='uid')return err('PASSWORD_SETUP_REQUIRES_GOOGLE',403);
  const credential=await createPasswordVerifier(newPass),{pass:_pass,passHash:_passHash,...clean}=data;
  const saved=await saveUser(env,login,{...clean,credential},{expectedRevision:data._revision??0});
  await accountRequest(env,login,{action:'session-revoke-all'});
  if(auth.type==='session'){
    const session=await issueSession(env,login,fp);return ok({success:true,revision:saved.revision,sessionToken:session.token,sessionExpiresAt:session.expiresAt});
  }
  return ok({success:true,revision:saved.revision});
}

function withoutPrivateAccount(data){
  const {pass:_pass,passHash:_passHash,credential:_credential,lastIP:_lastIP,...safe}=normalize(data)||{};
  return safe;
}

function doAccountExport(data,login){return ok({success:true,export:{version:1,exportedAt:new Date().toISOString(),login,data:withoutPrivateAccount(data)}});}

async function doListShares(env,login){
  const result=await accountRequest(env,login,{action:'share-list'});
  return ok({success:true,shares:(result.shares||[]).map(({token:_token,tokenHash,...item})=>({...item,id:tokenHash}))});
}

async function doRevokeShare(body,env,login){
  const id=String(body.id||'');if(!/^[a-f0-9]{64}$/.test(id))return err('INVALID_SHARE',400);
  const result=await accountRequest(env,login,{action:'share-revoke',tokenHash:id});if(result.token)await env.KV.delete(`share:${result.token}`);
  return ok({success:true});
}

async function deleteLoginAliases(env,login){
  await env.KV.delete(`account-index:${encodeURIComponent(login)}`);
  await env.KV.delete(`login-alias:${encodeURIComponent(login.toLowerCase())}`);
  for(const prefix of ['uid:','google_']){
    let cursor;
    do{
      const page=await env.KV.list({prefix,limit:1000,...(cursor?{cursor}:{})});
      for(const key of page.keys)if((await env.KV.get(key.name))===login)await env.KV.delete(key.name);
      cursor=page.list_complete?null:page.cursor;
    }while(cursor);
  }
}

async function doDeleteAccount(body,env,login,data,auth){
  if(String(body.confirmation||'').trim().toLowerCase()!==login.toLowerCase())return err('CONFIRMATION_MISMATCH',400);
  if(data.credential||data.passHash||data.pass){if(!await verifyAccountPassword(data,body.password))return err('WRONG_PASSWORD',403);}
  else if(auth.type!=='uid')return err('GOOGLE_REAUTH_REQUIRED',403);
  const telegram=await accountRequest(env,login,{action:'telegram-status'}).catch(()=>null);
  const shares=await accountRequest(env,login,{action:'share-clear'}).catch(()=>({tokens:[]}));
  for(const token of shares.tokens||[])await env.KV.delete(`share:${token}`);
  await accountRequest(env,login,{action:'delete'});
  if(telegram?.chatId)await env.KV.delete(`tg-chat:${telegram.chatId}`);
  await deleteLoginAliases(env,login);
  return ok({success:true});
}

async function doGenerateShare(body, env, login, data) {
  const { addressId } = body;
  if (!addressId) return err('NO_ADDRESS_ID', 400);
  const addr = (data.addresses || []).find(a => a.id === addressId);
  if (!addr) return err('ADDRESS_NOT_FOUND', 404);
  const days=Math.max(1,Math.min(Number(body.days)||30,90)),token=createOpaqueToken(24),createdAt=Date.now(),expiresAt=createdAt+days*86400000;
  await env.KV.put(`share:${token}`,JSON.stringify({login,addressId,createdAt,expiresAt}),{expirationTtl:86400*days});
  await accountRequest(env,login,{action:'share-add',token,tokenHash:await sha256(token),addressId,expiresAt});
  return ok({success:true,shareToken:token,expiresAt});
}

// ═══════════════════════════════════════════════════════
// ТАРИФИ СПІЛЬНОТИ
// ═══════════════════════════════════════════════════════

/**
 * Публікує тариф від користувача в спільну базу.
 * POST { action: 'publish_tariff', name, tariffs: {water, hotWater, electroBase, electroWinter, gas}, author }
 */
async function doPublishTariff(body, env, login, ip) {
  const name = String(body.name || '').trim().slice(0, 80);
  if (!name) return err('NO_NAME', 400);

  const t = body.tariffs;
  if (!t || typeof t !== 'object') return err('NO_TARIFFS', 400);

  // Валідація тарифів
  const water        = parseFloat(t.water)        || 0;
  const hotWater     = parseFloat(t.hotWater)     || 0;
  const electroBase  = parseFloat(t.electroBase)  || 0;
  const electroWinter= parseFloat(t.electroWinter)|| 0;
  const gas          = parseFloat(t.gas)          || 0;

  if (water <= 0 && electroBase <= 0 && gas <= 0) return err('INVALID_TARIFFS', 400);
  if (water > 10000 || electroBase > 1000 || gas > 1000) return err('TARIFF_TOO_HIGH', 400);

  const author = String(body.author || 'Анонім').trim().slice(0, 50);
  const city = String(body.city || '').trim().slice(0, 40);
  const region = String(body.region || '').trim().slice(0, 40);
  const allowedServices = new Set(['all', 'water', 'hotWater', 'electro', 'gas']);
  const serviceType = allowedServices.has(body.serviceType) ? body.serviceType : 'all';

  // Rate limit: 5 публікацій на годину з одного логіну
  if (!await rateLimit(env, `tariff_pub:${login}`, 5, 3_600_000)) {
    return err('RATE_LIMITED', 429);
  }

  const id=await mutateCommunity(env,list=>{
    const normalName=name.toLowerCase(),existingIdx=list.findIndex(item=>item.login===login&&item.name.toLowerCase()===normalName),previous=existingIdx>=0?list[existingIdx]:null;
    const entry={id:`t_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,name,city,region,serviceType,author,login,tariffs:{water,hotWater,electroBase,electroWinter,gas},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),verified:false,votes:1,voters:[login],history:[]};
    if(existingIdx>=0){const history=Array.isArray(previous.history)?previous.history:[],previousSnapshot=previous.tariffs?{tariffs:previous.tariffs,updatedAt:previous.updatedAt||previous.createdAt||new Date().toISOString()}:null;list[existingIdx]={...previous,...entry,id:previous.id,createdAt:previous.createdAt||entry.createdAt,verified:false,votes:Math.max(1,previous.votes||1),voters:Array.isArray(previous.voters)?previous.voters:[login],history:previousSnapshot?[previousSnapshot,...history].slice(0,12):history.slice(0,12)};}
    else list.unshift(entry);
    const final=list.slice(0,200);return{list:final,value:existingIdx>=0?final[existingIdx].id:entry.id};
  });
  return ok({success:true,id});
}

async function doVoteTariff(body, env, login) {
  const id = String(body.id || '').trim();
  if (!id) return err('NO_ID', 400);
  if (!await rateLimit(env, `tariff_vote:${login}`, 30, 3_600_000)) return err('RATE_LIMITED', 429);
  const result=await mutateCommunity(env,list=>{const idx=list.findIndex(item=>item.id===id);if(idx<0)return{list,value:{error:'NOT_FOUND'}};const voters=Array.isArray(list[idx].voters)?[...list[idx].voters]:[];if(voters.includes(login))return{list,value:{error:'ALREADY_VOTED'}};voters.push(login);list[idx]={...list[idx],voters,votes:Math.max(Number(list[idx].votes)||0,voters.length),updatedAt:list[idx].updatedAt||list[idx].createdAt||new Date().toISOString()};return{list,value:{votes:list[idx].votes}};});
  if(result.error)return err(result.error,result.error==='NOT_FOUND'?404:409);return ok({success:true,votes:result.votes});
}

/**
 * Повертає список тарифів спільноти.
 * POST { action: 'get_tariffs' }
 * Публічний — не потребує авторизації.
 */
async function doGetTariffs(env) {
  try {
    const {list}=await readCommunity(env);

    // Повертаємо без приватних полів
    const public_list = list.map(({ login: _l, voters: _v, ...item }) => item);

    return ok({ success: true, tariffs: public_list });
  } catch(e) {
    console.error('doGetTariffs:', e?.message);
    return ok({ success: true, tariffs: [] });
  }
}

// ═══════════════════════════════════════════════════════
// AI CHAT
// ═══════════════════════════════════════════════════════

async function doAiChat(body, env, login) {
  if(!await rateLimit(env,`ai:${login}`,20,3600000))return err('AI_RATE_LIMIT',429);
  const { messages, max_tokens = 400, temperature = 0.4 } = body;
  if (!Array.isArray(messages) || !messages.length) return err('NO_MESSAGES', 400);
  const safe = messages.slice(0, 20)
    .filter(m => m?.role && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: ['system','user','assistant'].includes(m.role) ? m.role : 'user', content: String(m.content).slice(0, 4000) }));
  if (!safe.length) return err('NO_VALID_MESSAGES', 400);
  const tk = Math.min(Math.max(1, Math.floor(Number(max_tokens)||400)), 500);
  const tp = Math.max(0, Math.min(Number(temperature)||0.4, 1));
  if (env.GROQ_API_KEY) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', Authorization:`Bearer ${env.GROQ_API_KEY}` },
        body: JSON.stringify({ model:'llama-3.1-8b-instant', messages:safe, max_completion_tokens:tk, temperature:tp }),
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok) return ok({ ...await r.json(), success:true });
    } catch(e) { console.error('Groq:', e?.message); }
  }
  if (env.GEMINI_API_KEY) {
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', Authorization:`Bearer ${env.GEMINI_API_KEY}` },
        body: JSON.stringify({ model:'gemini-2.0-flash', messages:safe, max_tokens:tk, temperature:tp }),
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok) return ok({ ...await r.json(), success:true, _fallback:'gemini' });
    } catch(e) { console.error('Gemini:', e?.message); }
  }
  return err('AI_PROVIDERS_FAILED', 502);
}

// ═══════════════════════════════════════════════════════
// АДМІН
// ═══════════════════════════════════════════════════════

async function doAdmin(action, body, env, ip) {
  if(!env.ADMIN_PASS)return err('ADMIN_NOT_CONFIGURED',503);
  if (action === 'admin_login') {
    const ipKey=(await sha256(String(ip||'unknown'))).slice(0,24);if(!await rateLimit(env,`admin-login:${ipKey}`,5,900000))return err('TOO_MANY_ATTEMPTS',429);
    const ih = await sha256(body.pass || '');
    const ah = await sha256(env.ADMIN_PASS);
    if (ih !== ah) return err('WRONG_PASSWORD', 403);
    const token=createOpaqueToken(32),created=await specialRequest(env,'security',{action:'admin-session-create',tokenHash:await sha256(token),ttl:3600000});
    return ok({success:true,token,expiresAt:created.expiresAt});
  }
  const { adminToken } = body;
  if (!adminToken) return err('UNAUTHORIZED', 401);
  const tokenHash=await sha256(adminToken),verified=await specialRequest(env,'security',{action:'admin-session-verify',tokenHash}).catch(()=>null);
  if(!verified?.success)return err('UNAUTHORIZED',401);
  if(action==='admin_logout'){await specialRequest(env,'security',{action:'admin-session-revoke',tokenHash});return ok({success:true});}
  switch (action) {
    case 'admin_backup_page':      return doAdminBackupPage(body,env);
    case 'admin_stats':            return doAdminStats(env);
    case 'admin_user_data':        return doAdminUserData(body, env);
    case 'admin_give_pro':         return doAdminPro(body, env, true);
    case 'admin_revoke_pro':       return doAdminPro(body, env, false);
    case 'admin_delete_user':      return doAdminDelete(body, env);
    case 'admin_broadcast':        return doAdminBroadcast(body, env);
    case 'admin_reset_password':   return doAdminResetPass(body, env);
    // ═══ НОВЕ: адмін може переглянути/очистити тарифи ═══
    case 'admin_get_tariffs':      return doAdminGetTariffs(env);
    case 'admin_delete_tariff':    return doAdminDeleteTariff(body, env);
    case 'admin_clear_tariffs':    return doAdminClearTariffs(env);
    case 'admin_verify_tariff':    return doAdminVerifyTariff(body, env);
    case 'admin_feedback_list':    return doAdminFeedbackList(env);
    case 'admin_feedback_update':  return doAdminFeedbackUpdate(body,env);
    default: return err('UNKNOWN_ACTION', 400);
  }
}

async function doAdminBackupPage(body,env){
  if(body.cursor!=null&&(typeof body.cursor!=='string'||body.cursor.length>4096))return err('INVALID_CURSOR',400);
  const page=await env.KV.list({limit:100,...(body.cursor?{cursor:body.cursor}:{})});
  const entries=await Promise.all(page.keys.map(async key=>{const value=await env.KV.get(key.name);if(value===null)throw new Error('BACKUP_CHANGED_DURING_READ');return{...key,value};}));
  return ok({success:true,entries,listComplete:page.list_complete,cursor:page.list_complete?null:page.cursor,readOnly:env.MAINTENANCE_MODE==='read-only'});
}

async function doAdminStats(env) {
  const curMonth = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
  const all={keys:[]};let cursor;do{const page=await env.KV.list({limit:1000,...(cursor?{cursor}:{})});all.keys.push(...page.keys);cursor=page.list_complete?null:page.cursor;}while(cursor);
  const skip     = ['share:','share_','google_','_broadcast','uid:','rl:','adminlogin:','ai_rl:','broadcast','community_tariffs','tariff_pub:','account-index:','feedback:'];
  const indexed=new Set(all.keys.filter(({name})=>name.startsWith('account-index:')).map(({name})=>decodeURIComponent(name.slice('account-index:'.length))));
  const logins=[...new Set([...all.keys.filter(({name})=>name!=='broadcast'&&!skip.some(p=>name.startsWith(p))).map(({name})=>name),...indexed])];
  const users    = [];let unrecognizedAccounts=0;
  for (let i = 0; i < logins.length; i += 10) {
    const results = await Promise.allSettled(logins.slice(i,i+10).map(async login => {
      if(!indexed.has(login)){const raw=await env.KV.get(login);if(!raw)return null;let legacy;try{legacy=JSON.parse(raw);}catch{if(login.startsWith('uid_'))return null;unrecognizedAccounts++;return null;}
      if(!legacy||typeof legacy!=='object'||Array.isArray(legacy))return null;}
      const data=await getUser(env,login);if(!data)return null;
      const norm = normalize(data);
      const recs = (norm.addresses||[]).flatMap(a=>a.records||[]);
      const sort = [...recs].sort((a,b)=>b.month.localeCompare(a.month));
      return { login, displayName:norm.displayName||'', hasGoogle:!!norm.hasGoogle, isPro:!!norm.isPro, records:recs.length, addresses:(norm.addresses||[]).length, activeThisMonth:recs.some(r=>r.month===curMonth), lastMonth:sort[0]?.month||null, devices:(norm.knownDevices||[]).length, suspicious:norm.suspiciousActivity||0 };
    }));
    if(results.some(r=>r.status==='rejected'))return err('INCOMPLETE_USER_LIST',503);
    results.forEach(r=>{if(r.value)users.push(r.value);});
  }
  // Кількість спільних тарифів
  let tariffsCount=0;try{tariffsCount=(await readCommunity(env)).list.length;}catch{}

  let feedbackNew=0;try{feedbackNew=(await readFeedback(env)).filter(item=>item.status==='new').length;}catch{}
  return ok({ success:true, unrecognizedAccounts, stats:{ totalUsers:users.length, activeThisMonth:users.filter(u=>u.activeThisMonth).length, totalRecords:users.reduce((s,u)=>s+u.records,0), proUsers:users.filter(u=>u.isPro).length, communityTariffs: tariffsCount, feedbackNew }, users });
}

async function readFeedback(env){
  const keys=[];let cursor;do{const page=await env.KV.list({prefix:'feedback:',limit:1000,...(cursor?{cursor}:{})});keys.push(...page.keys.filter(key=>key.name.startsWith('feedback:')));cursor=page.list_complete?null:page.cursor;}while(cursor);
  const values=await Promise.all(keys.slice(0,500).map(async key=>{try{return JSON.parse(await env.KV.get(key.name));}catch{return null;}}));
  return values.filter(item=>item&&item.id&&['problem','idea','other'].includes(item.type)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}
async function doAdminFeedbackList(env){return ok({success:true,feedback:await readFeedback(env)});}
async function doAdminFeedbackUpdate(body,env){
  const id=String(body.id||''),status=String(body.status||'');
  if(!/^\d{10,16}-[A-Za-z0-9_-]{6,24}$/.test(id)||!['new','in_progress','done'].includes(status))return err('INVALID_FEEDBACK_UPDATE',400);
  const key=`feedback:${id}`,raw=await env.KV.get(key);if(!raw)return err('NOT_FOUND',404);
  let item;try{item=JSON.parse(raw);}catch{return err('INVALID_FEEDBACK',503);}
  await env.KV.put(key,JSON.stringify({...item,status,updatedAt:new Date().toISOString()}));
  return ok({success:true});
}

async function doAdminUserData(body, env) {
  if (!body.login) return err('NO_LOGIN', 400);
  const data = await getUser(env, body.login);
  if (!data) return err('NOT_FOUND', 404);
  const normalized=normalize(data),{pass:_pass,passHash:_passHash,credential:_credential,...safe}=normalized;
  return ok({ success:true, data:{...safe,hasPassword:Boolean(normalized.credential||normalized.passHash||normalized.pass)} });
}

async function doAdminPro(body, env, val) {
  if (!body.login) return err('NO_LOGIN', 400);
  const data = await getUser(env, body.login);
  if (!data) return err('NOT_FOUND', 404);
  await saveUser(env, body.login, { ...normalize(data), isPro:val });
  return ok({ success:true });
}

async function doAdminDelete(body, env) {
  if (!body.login) return err('NO_LOGIN', 400);
  const login=String(body.login),telegram=await accountRequest(env,login,{action:'telegram-status'}).catch(()=>null);
  const shares=await accountRequest(env,login,{action:'share-clear'}).catch(()=>({tokens:[]}));
  for(const token of shares.tokens||[])await env.KV.delete(`share:${token}`);
  await accountRequest(env,login,{action:'delete'});
  if(telegram?.chatId)await env.KV.delete(`tg-chat:${telegram.chatId}`);
  await deleteLoginAliases(env,login);
  return ok({ success:true });
}

async function doAdminBroadcast(body, env) {
  if (!body.message) return err('NO_MESSAGE', 400);
  await env.KV.put('broadcast', JSON.stringify({ message:String(body.message).slice(0,500), date:new Date().toISOString().slice(0,10) }));
  return ok({ success:true });
}

async function doAdminResetPass(body, env) {
  if (!body.login) return err('MISSING_PARAMS', 400);
  const policyError=passwordPolicy(body.newPass);if(policyError)return err(policyError,400);
  const data = await getUser(env, body.login);
  if (!data) return err('NOT_FOUND', 404);
  const normalized=normalize(data),{pass:_pass,passHash:_passHash,credential:_credential,...safe}=normalized;
  await saveUser(env, body.login, { ...safe, credential:await createPasswordVerifier(body.newPass) });
  await accountRequest(env,body.login,{action:'session-revoke-all'});
  return ok({ success:true });
}

// Адмін: перегляд тарифів з логінами (для модерації)
async function doAdminGetTariffs(env) {
  try {
    const tariffs=(await readCommunity(env)).list;
    if (!Array.isArray(tariffs)) return err('INVALID_TARIFF_DATA', 503);
    return ok({ success: true, tariffs });
  } catch(e) {
    return err('INVALID_TARIFF_DATA', 503);
  }
}

// Адмін: видалення конкретного тарифу за id
async function doAdminDeleteTariff(body, env) {
  if (!body.id) return err('NO_ID', 400);
  try {
    const deleted=await mutateCommunity(env,list=>{if(!list.some(item=>item.id===body.id))return{list,value:false};return{list:list.filter(item=>item.id!==body.id),value:true};});
    if(!deleted)return err('NOT_FOUND',404);
    return ok({ success: true });
  } catch(e) {
    return err('ERROR', 500);
  }
}

async function doAdminVerifyTariff(body, env) {
  if (!body.id) return err('NO_ID', 400);
  try {
    const changed=await mutateCommunity(env,list=>{const idx=list.findIndex(item=>item.id===body.id);if(idx<0)return{list,value:false};list[idx]={...list[idx],verified:body.verified!==false,moderatedAt:new Date().toISOString()};return{list,value:true};});
    if(!changed)return err('NOT_FOUND',404);
    return ok({ success: true });
  } catch(e) {
    return err('ERROR', 500);
  }
}

// Адмін: повне очищення списку тарифів
async function doAdminClearTariffs(env) {
  await mutateCommunity(env,()=>({list:[],value:true}));
  return ok({ success: true });
}

async function readBody(req){
  const reader=req.body?.getReader();if(!reader)throw new Error('INVALID_JSON');
  const chunks=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>512*1024){await reader.cancel();throw new Error('PAYLOAD_TOO_LARGE');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{const body=JSON.parse(new TextDecoder().decode(bytes));if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();return body;}catch{throw new Error('INVALID_JSON');}
}
export default {
  async fetch(req,env){
    const origin=req.headers.get('Origin');
    const allowed=new Set(['https://komynalka.vercel.app','http://127.0.0.1:4173','http://localhost:4173',...(env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean)]);
    if(origin&&!allowed.has(origin))return err('ORIGIN_NOT_ALLOWED',403);
    const response=await handler.fetch(req,env);
    const headers=new Headers(response.headers);if(origin)headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');
    return new Response(response.body,{status:response.status,headers});
  }
};
