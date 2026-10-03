import {createHash} from 'node:crypto';

export function createReleaseBuildId(serviceWorker,deploymentConfig,assets){
  const hash=createHash('sha256');
  for(const source of [serviceWorker,deploymentConfig,...assets]){
    const bytes=Buffer.from(source);
    hash.update(String(bytes.length)+':');
    hash.update(bytes);
  }
  return hash.digest('hex').slice(0,12);
}
