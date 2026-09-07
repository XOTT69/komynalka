// Worker-only Firebase ID-token verification. No user token is sent to Google.
const JWKS_URL='https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let keyCache={keys:[],expires:0};
function bytes(value){const base=value.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(base+'='.repeat((4-base.length%4)%4)),char=>char.charCodeAt(0));}
export async function verifyFirebaseToken(token,projectId){
  if(!projectId||token.length>16384)throw new Error('INVALID_TOKEN');
  const parts=token.split('.');if(parts.length!==3)throw new Error('INVALID_TOKEN');
  const header=JSON.parse(new TextDecoder().decode(bytes(parts[0])));
  const claims=JSON.parse(new TextDecoder().decode(bytes(parts[1])));
  const now=Math.floor(Date.now()/1000);
  if(header.alg!=='RS256'||typeof header.kid!=='string'||claims.aud!==projectId||claims.iss!==`https://securetoken.google.com/${projectId}`||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>128||!Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.iat)||claims.iat>now+30||!Number.isFinite(claims.auth_time)||claims.auth_time>now+30)throw new Error('INVALID_TOKEN');
  if(keyCache.expires<Date.now()){
    const response=await fetch(JWKS_URL);if(!response.ok)throw new Error('AUTH_UNAVAILABLE');
    const data=await response.json();if(!Array.isArray(data.keys))throw new Error('AUTH_UNAVAILABLE');
    keyCache={keys:data.keys,expires:Date.now()+3600000};
  }
  const jwk=keyCache.keys.find(key=>key.kid===header.kid&&key.kty==='RSA');
  if(!jwk){keyCache.expires=0;throw new Error('INVALID_TOKEN');}
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw new Error('INVALID_TOKEN');
  return claims.sub;
}
