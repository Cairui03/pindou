import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const template = read('src/index.template.html');
const core = read('src/core.js');
const palettes = read('src/palettes.js');
const app = read('src/app.js');

if (!template.includes('<!--CORE-->') || !template.includes('<!--APP-->')) {
  throw new Error('template placeholders missing');
}

let html = template.replace('<!--CORE-->', () => '<script>\n' + palettes + '\n' + core + '\n</script>');
html = html.replace('<!--APP-->', () => '<script>\n' + app + '\n</script>');
fs.writeFileSync(path.join(ROOT, 'index.html'), html);
console.log('built index.html', (html.length / 1024).toFixed(1) + ' KB');
