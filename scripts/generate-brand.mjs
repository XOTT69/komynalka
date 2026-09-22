import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('..',import.meta.url));
const logo=await readFile(path.join(root,'brand-mark.svg'));
for(const size of [192,512,1024]){
  const name=size===1024?'icon.png':`icon-${size}.png`;
  await sharp(logo,{density:192}).resize(size,size).png({compressionLevel:9}).toFile(path.join(root,name));
  console.log(`Generated ${name}`);
}
const og=await readFile(path.join(root,'brand-og.svg'));
await sharp(og,{density:192}).resize(1200,630).png({compressionLevel:9}).toFile(path.join(root,'og-image.png'));
console.log('Generated og-image.png');
const badge=await readFile(path.join(root,'brand-badge.svg'));
await sharp(badge,{density:192}).resize(96,96).png({compressionLevel:9}).toFile(path.join(root,'badge-96.png'));
console.log('Generated badge-96.png');
