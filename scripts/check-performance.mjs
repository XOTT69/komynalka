import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
const html=await readFile('dist/index.html','utf8'),scripts=[];
for(const match of html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)){
  if(/^https?:/.test(match[1]))continue;
  if(!/\bdefer\b/.test(match[0]))throw new Error(`Parser-blocking application script: ${match[1]}`);
  const source=await readFile(path.join('dist',match[1]));scripts.push({file:match[1],bytes:source.length,gzipBytes:gzipSync(source).length});
}
const report={kind:'build-size-estimate-not-network-timing',initialScripts:scripts,initialJavaScriptGzipBytes:scripts.reduce((sum,item)=>sum+item.gzipBytes,0),htmlGzipBytes:gzipSync(html).length};
const budgets={initialJavaScriptGzipBytes:165*1024,htmlGzipBytes:35*1024};
for(const [metric,limit] of Object.entries(budgets))if(report[metric]>limit)throw new Error(`${metric}: ${report[metric]} exceeds ${limit}`);
for(const optional of ['ai-chat.js','year-report-image.js'])if(scripts.some(item=>item.file===optional))throw new Error(`Optional module is loaded at startup: ${optional}`);
await mkdir('test-results',{recursive:true});await writeFile('test-results/performance-build.json',JSON.stringify({...report,budgets},null,2));
console.log(`Build budgets passed: startup JS ${(report.initialJavaScriptGzipBytes/1024).toFixed(1)} KiB gzip; HTML ${(report.htmlGzipBytes/1024).toFixed(1)} KiB gzip. This is not a speed measurement.`);
