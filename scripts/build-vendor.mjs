import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);

async function copy(source, destination) {
  const from = path.join(root, 'node_modules', source);
  const to = path.join(root, 'vendor', destination);
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(from, to);
}

await Promise.all([
  copy('firebase/firebase-app-compat.js', 'firebase/firebase-app-compat.js'),
  copy('firebase/firebase-auth-compat.js', 'firebase/firebase-auth-compat.js'),
  copy('jspdf/dist/jspdf.umd.min.js', 'jspdf/jspdf.umd.min.js'),
  copy('jspdf-autotable/dist/jspdf.plugin.autotable.min.js', 'jspdf/jspdf.plugin.autotable.min.js'),
  copy('@fortawesome/fontawesome-free/css/all.min.css', 'fontawesome/css/all.min.css'),
  copy('@fontsource-variable/inter/files/inter-cyrillic-wght-normal.woff2', 'fonts/inter/inter-cyrillic-wght-normal.woff2'),
  copy('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'fonts/inter/inter-latin-wght-normal.woff2'),
  copy('@fontsource-variable/inter-tight/files/inter-tight-cyrillic-wght-normal.woff2', 'fonts/inter-tight/inter-tight-cyrillic-wght-normal.woff2'),
  copy('@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2', 'fonts/inter-tight/inter-tight-latin-wght-normal.woff2'),
]);

const fontSource = path.join(root, 'node_modules', '@fortawesome', 'fontawesome-free', 'webfonts');
const fontFiles = (await readdir(fontSource)).filter(file => file.endsWith('.woff2') || file.endsWith('.ttf'));
await Promise.all(fontFiles.map(file => copy(`@fortawesome/fontawesome-free/webfonts/${file}`, `fontawesome/webfonts/${file}`)));

console.log(`Vendor assets ready: ${9 + fontFiles.length} files`);
