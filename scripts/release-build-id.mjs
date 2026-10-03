import {createHash} from 'node:crypto';

export function createReleaseBuildId(serviceWorker,deploymentConfig,assets){
  const hash=createHash('sha256');
  const {headers=[],rewrites=[],redirects=[]}=JSON.parse(Buffer.from(deploymentConfig).toString());
  // Ignore formatting and platform build metadata; preserve rule/array order.
  // Only response policy can change cached HTML without changing its bytes.
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
  const responsePolicy=JSON.stringify(canonical({headers,rewrites,redirects}));
  for(const source of [serviceWorker,responsePolicy,...assets]){
    const bytes=Buffer.from(source);
    hash.update(String(bytes.length)+':');
    hash.update(bytes);
  }
  return hash.digest('hex').slice(0,12);
}
