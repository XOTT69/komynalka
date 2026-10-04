// Derived administrator index. AccountStore and original KV values remain authoritative.
export function accountSummary(state){
 const data=state.value||{},addresses=Array.isArray(data.addresses)&&data.addresses.length?data.addresses:(Array.isArray(data.records)?[{records:data.records}]:[]);
 const records=addresses.flatMap(a=>Array.isArray(a.records)?a.records:[]),months=[...new Set(records.map(r=>r.month).filter(m=>/^\d{4}-\d{2}$/.test(m)))].sort();
 return{login:state.login,revision:state.revision,deleted:Boolean(state.deleted||!state.value),displayName:String(data.displayName||'').slice(0,240),hasGoogle:Boolean(data.hasGoogle),isPro:Boolean(data.isPro),records:records.length,addresses:addresses.length,lastMonth:months.at(-1)||'',months:'|'+months.join('|')+'|',devices:Array.isArray(data.knownDevices)?data.knownDevices.length:0,suspicious:Math.max(0,Number(data.suspiciousActivity)||0)};
}
const encodeCursor=value=>btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
const decodeCursor=value=>JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value),c=>c.charCodeAt(0))));
const fields={login:'login',records:'records',addresses:'addresses',lastMonth:'lastMonth',devices:'devices',suspicious:'suspicious'};
function pageOptions(body){
 const limit=body.limit===undefined?50:Number(body.limit);if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('INVALID_LIMIT');
 if(body.cursor!==undefined&&body.cursor!==null&&(typeof body.cursor!=='string'||body.cursor.length>2048))throw new Error('INVALID_CURSOR');
 return{limit,q:String(body.q||'').trim().toLocaleLowerCase('uk-UA').slice(0,240)};
}
function pageCursor(body,signature){
 if(!body.cursor)return null;
 try{const value=decodeCursor(body.cursor);if(value.signature!==signature||typeof value.login!=='string'||typeof value.value!=='string'&&typeof value.value!=='number')throw 0;return value;}catch{throw new Error('INVALID_CURSOR');}
}
const rows=cursor=>Array.from(cursor);
const initialized=new WeakSet();
export function initDirectory(sql){
 if(initialized.has(sql))return;
 sql.exec('CREATE TABLE IF NOT EXISTS admin_users (login TEXT PRIMARY KEY, revision INTEGER NOT NULL, deleted INTEGER NOT NULL, displayName TEXT NOT NULL, search TEXT NOT NULL, hasGoogle INTEGER NOT NULL, isPro INTEGER NOT NULL, records INTEGER NOT NULL, addresses INTEGER NOT NULL, lastMonth TEXT NOT NULL, months TEXT NOT NULL, devices INTEGER NOT NULL, suspicious INTEGER NOT NULL)');
 for(const field of Object.values(fields))sql.exec(`CREATE INDEX IF NOT EXISTS admin_users_${field} ON admin_users(deleted, ${field}, login)`);
 sql.exec('CREATE TABLE IF NOT EXISTS admin_feedback (id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, search TEXT NOT NULL, item TEXT NOT NULL, updatedAt INTEGER NOT NULL)');
 sql.exec('CREATE INDEX IF NOT EXISTS admin_feedback_status ON admin_feedback(status,id)');initialized.add(sql);
}
export async function directoryAction(ctx,body){
 const sql=ctx.storage.sql;if(!sql)throw new Error('ADMIN_INDEX_SQL_UNAVAILABLE');initDirectory(sql);
 const action=body.action;
 if(action==='directory-status')return{success:true,state:await ctx.storage.get('directory-build')||{ready:false,cursor:null,unrecognizedAccounts:0,pages:0}};
 if(action==='directory-build-commit'){
  const state=await ctx.storage.get('directory-build')||{ready:false,cursor:null,unrecognizedAccounts:0,pages:0};
  if(!state.ready&&state.cursor===(body.expectedCursor||null)){const next={ready:Boolean(body.complete),cursor:body.complete?null:body.cursor,unrecognizedAccounts:state.unrecognizedAccounts+(body.unrecognizedAccounts||0),pages:state.pages+1,updatedAt:new Date().toISOString()};await ctx.storage.put('directory-build',next);return{success:true,state:next};}
  return{success:true,state};
 }
 if(action==='directory-upsert'){
  const s=body.summary;if(!s||typeof s.login!=='string'||!Number.isInteger(s.revision))throw new Error('INVALID_SUMMARY');
  sql.exec('INSERT INTO admin_users VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(login) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted,displayName=excluded.displayName,search=excluded.search,hasGoogle=excluded.hasGoogle,isPro=excluded.isPro,records=excluded.records,addresses=excluded.addresses,lastMonth=excluded.lastMonth,months=excluded.months,devices=excluded.devices,suspicious=excluded.suspicious WHERE excluded.revision>=admin_users.revision OR ?=1',s.login,s.revision,Number(s.deleted),s.displayName,`${s.login} ${s.displayName}`.toLocaleLowerCase('uk-UA'),Number(s.hasGoogle),Number(s.isPro),s.records,s.addresses,s.lastMonth,s.months,s.devices,s.suspicious,Number(body.force===true));return{success:true};
 }
 if(action==='directory-feedback-upsert'){
  const item=body.item;if(!item?.id||!['problem','idea','other'].includes(item.type)||!['new','in_progress','done'].includes(item.status))throw new Error('INVALID_FEEDBACK');
  sql.exec('INSERT INTO admin_feedback VALUES (?,?,?,?,?,?) ON CONFLICT(id) '+(body.bootstrap?'DO NOTHING':'DO UPDATE SET type=excluded.type,status=excluded.status,search=excluded.search,item=excluded.item,updatedAt=excluded.updatedAt WHERE excluded.updatedAt>=admin_feedback.updatedAt'),item.id,item.type,item.status,`${item.login||''} ${item.contact||''} ${item.message||''}`.toLocaleLowerCase('uk-UA'),JSON.stringify(item),Date.parse(item.updatedAt||item.createdAt)||0);return{success:true};
 }
 const state=await ctx.storage.get('directory-build');if(!state?.ready)return{success:true,indexReady:false,state};
 if(action==='directory-users'){
  const {limit,q}=pageOptions(body),field=fields[body.sort||'records'];if(!field||!['asc','desc',undefined].includes(body.dir))throw new Error('INVALID_SORT');
  const dir=body.dir==='asc'?'ASC':'DESC',where=['deleted=0'],args=[];
  // A stable YYYY-MM value independent of host locale ordering.
  const parts=new Intl.DateTimeFormat('en',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit'}).formatToParts(new Date()),currentMonth=parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value;
  if(q){where.push('instr(search,?)>0');args.push(q);}
  if(body.type&&body.type!=='all'){if(!['google','login'].includes(body.type))throw new Error('INVALID_FILTER');where.push('hasGoogle=?');args.push(Number(body.type==='google'));}
  if(body.pro&&body.pro!=='all'){if(!['pro','free'].includes(body.pro))throw new Error('INVALID_FILTER');where.push('isPro=?');args.push(Number(body.pro==='pro'));}
  if(body.active&&body.active!=='all'){if(!['active','inactive','suspicious'].includes(body.active))throw new Error('INVALID_FILTER');where.push(body.active==='suspicious'?'suspicious>0':`instr(months,?)${body.active==='active'?'>0':'=0'}`);if(body.active!=='suspicious')args.push('|'+currentMonth+'|');}
  const signature=JSON.stringify([q,body.type||'all',body.pro||'all',body.active||'all',field,dir]),cursor=pageCursor(body,signature);
  const total=rows(sql.exec('SELECT count(*) AS total FROM admin_users WHERE '+where.join(' AND '),...args))[0].total;
  if(cursor){where.push(`(${field} ${dir==='ASC'?'>':'<'} ? OR (${field}=? AND login>?))`);args.push(cursor.value,cursor.value,cursor.login);}
  const users=rows(sql.exec('SELECT login,displayName,hasGoogle,isPro,records,addresses,lastMonth,devices,suspicious,instr(months,?)>0 AS activeThisMonth FROM admin_users WHERE '+where.join(' AND ')+` ORDER BY ${field} ${dir},login ASC LIMIT ?`,'|'+currentMonth+'|',...args,limit+1));
  const more=users.length>limit;users.length=Math.min(users.length,limit);
  for(const u of users){u.hasGoogle=Boolean(u.hasGoogle);u.isPro=Boolean(u.isPro);u.activeThisMonth=Boolean(u.activeThisMonth);u.lastMonth=u.lastMonth||null;}
  const aggregate=rows(sql.exec('SELECT count(*) AS totalUsers,coalesce(sum(records),0) AS totalRecords,coalesce(sum(isPro),0) AS proUsers,coalesce(sum(hasGoogle),0) AS googleUsers,coalesce(sum(suspicious>0),0) AS suspiciousUsers,coalesce(sum(instr(months,?)>0),0) AS activeThisMonth,coalesce(sum(records>0),0) AS withRecords,coalesce(avg(devices),0) AS averageDevices,coalesce(sum(devices>1),0) AS multiDevice FROM admin_users WHERE deleted=0','|'+currentMonth+'|'))[0];
  aggregate.feedbackNew=rows(sql.exec("SELECT count(*) AS n FROM admin_feedback WHERE status='new'"))[0].n;
  const analytics={topUsers:rows(sql.exec('SELECT login,records FROM admin_users WHERE deleted=0 ORDER BY records DESC,login LIMIT 15')),suspicious:rows(sql.exec('SELECT login,suspicious FROM admin_users WHERE deleted=0 AND suspicious>0 ORDER BY suspicious DESC,login LIMIT 50')),months:rows(sql.exec("SELECT lastMonth AS month,count(*) AS count FROM admin_users WHERE deleted=0 AND lastMonth<>'' GROUP BY lastMonth ORDER BY lastMonth DESC LIMIT 12"))};
  const last=users.at(-1);return{success:true,indexReady:true,mode:'directory',users,total,cursor:more?encodeCursor({signature,login:last.login,value:last[field]??''}):null,stats:aggregate,analytics,unrecognizedAccounts:state.unrecognizedAccounts};
 }
 if(action==='directory-feedback'){
  const {limit,q}=pageOptions(body),where=[],args=[];
  if(q){where.push('instr(search,?)>0');args.push(q);}
  if(body.type&&body.type!=='all'){if(!['problem','idea','other'].includes(body.type))throw new Error('INVALID_FILTER');where.push('type=?');args.push(body.type);}
  if(body.status&&body.status!=='all'){if(!['active','new','in_progress','done'].includes(body.status))throw new Error('INVALID_FILTER');where.push(body.status==='active'?"status<>'done'":'status=?');if(body.status!=='active')args.push(body.status);}
  const signature=JSON.stringify([q,body.type||'all',body.status||'all']),cursor=pageCursor({...body,cursor:body.cursor},signature);
  const condition=where.length?' WHERE '+where.join(' AND '):'';
  const total=rows(sql.exec('SELECT count(*) AS total FROM admin_feedback'+condition,...args))[0].total;
  if(cursor){where.push('id<?');args.push(cursor.login);}
  const items=rows(sql.exec('SELECT id,item FROM admin_feedback'+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY id DESC LIMIT ?',...args,limit+1));
  const more=items.length>limit;items.length=Math.min(items.length,limit);return{success:true,mode:'directory',indexReady:true,total,feedback:items.map(r=>JSON.parse(r.item)),cursor:more?encodeCursor({signature,login:items.at(-1).id,value:''}):null};
 }
 throw new Error('INVALID_ACTION');
}
