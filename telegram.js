// Telegram is optional. The bot token stays in the Worker secret store.
const tokenPattern=/^[A-Za-z0-9_-]{32}$/;
const botRequest=async(env,method,payload)=>{
  if(!env.TG_BOT_TOKEN)throw new Error('TELEGRAM_NOT_CONFIGURED');
  const response=await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(8000)});
  const result=await response.json();if(!response.ok||!result.ok)throw new Error(`TELEGRAM_${method.toUpperCase()}_FAILED`);return result.result;
};
export async function webhookSecret(env){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`komunalka-telegram-webhook:${env.TG_BOT_TOKEN}`));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function prepareBot(env,workerUrl){
  const bot=await botRequest(env,'getMe',{});
  if(!bot.username)throw new Error('TELEGRAM_BOT_USERNAME_MISSING');
  const target=new URL('/telegram',workerUrl).href;
  const current=await botRequest(env,'getWebhookInfo',{});
  if(current.url&&current.url!==target)throw new Error('TELEGRAM_WEBHOOK_CONFLICT');
  await botRequest(env,'setWebhook',{url:target,secret_token:await webhookSecret(env),allowed_updates:['message'],drop_pending_updates:false});
  return bot.username;
}
export function randomLinkToken(){return Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');}
export async function sendTelegram(env,chatId,text){
  try{await botRequest(env,'sendMessage',{chat_id:chatId,text,disable_web_page_preview:true});return 200;}
  catch(error){return error.message==='TELEGRAM_SENDMESSAGE_FAILED'?503:503;}
}
export async function handleTelegramWebhook(req,env,accountRequest){
  if(!env.TG_BOT_TOKEN||req.headers.get('X-Telegram-Bot-Api-Secret-Token')!==await webhookSecret(env))return new Response('Forbidden',{status:403});
  let update;try{update=await req.json();}catch{return new Response('Bad request',{status:400});}
  const message=update?.message,chat=message?.chat;
  if(chat?.type!=='private'||!Number.isSafeInteger(chat.id))return new Response('OK');
  const text=String(message.text||'').trim(),chatId=String(chat.id);
  if(text==='/stop'){
    const login=await env.KV.get(`tg-chat:${chatId}`);
    if(login){await accountRequest(env,login,{action:'telegram-unlink',chatId});await env.KV.delete(`tg-chat:${chatId}`);}
    await sendTelegram(env,chatId,'Нагадування Комуналки в Telegram вимкнено.');
  }else if(/^\/start(?:\s|$)/.test(text)){
    const ticket=text.split(/\s+/)[1];
    if(!tokenPattern.test(ticket||'')){await sendTelegram(env,chatId,'Відкрийте Комуналку → Нагадування → Підключити Telegram.');return new Response('OK');}
    const login=await env.KV.get(`tg-link:${ticket}`);
    if(!login){await sendTelegram(env,chatId,'Посилання застаріло. Створіть нове в Комуналці.');return new Response('OK');}
    const owner=await env.KV.get(`tg-chat:${chatId}`);
    if(owner&&owner!==login){await sendTelegram(env,chatId,'Цей чат уже прив’язаний до іншого акаунта Комуналки. Спочатку надішліть /stop.');return new Response('OK');}
    const result=await accountRequest(env,login,{action:'telegram-confirm',ticket,chatId});
    if(result.success){await env.KV.put(`tg-chat:${chatId}`,login);await env.KV.delete(`tg-link:${ticket}`);if(result.previousChatId&&result.previousChatId!==chatId)await env.KV.delete(`tg-chat:${result.previousChatId}`);await sendTelegram(env,chatId,'Telegram підключено. Нагадування надходитимуть о 09:00 за Києвом у вибрані дні. Вимкнути: /stop або в застосунку.');}
    else await sendTelegram(env,chatId,'Посилання застаріло. Створіть нове в Комуналці.');
  }
  return new Response('OK');
}
