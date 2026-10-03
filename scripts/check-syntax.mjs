import {readdir,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
for(const entry of await readdir('.'))if(entry.endsWith('.js'))execFileSync(process.execPath,['--check',entry],{stdio:'inherit'});
for(const directory of ['scripts','tests'])for(const entry of await readdir(directory))if(/\.(?:mjs|cjs)$/.test(entry))execFileSync(process.execPath,['--check',`${directory}/${entry}`],{stdio:'inherit'});
for(const file of ['index.html','admin.html','scripts/pwa-preview-controls.html']){
  const html=await readFile(file,'utf8');for(const [,source] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(source.trim())new Function(source);
}
console.log('JavaScript and inline script syntax passed');
