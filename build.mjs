import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('.', import.meta.url);
async function read(name) { return readFile(new URL(name, root), 'utf8'); }
async function data(name, fallback) {
  try { return JSON.parse(await read(name)); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
const [template, tokens, css, js, glossary, cases, meta] = await Promise.all([
  read('index.template.html'), read('tokens.css'), read('styles.css'), read('app.js'),
  data('glossary.json', []), data('cases.json', []), data('meta.json', {})
]);
if (!Array.isArray(glossary) || !Array.isArray(cases) || !meta || Array.isArray(meta)) throw new Error('Invalid study data shape');
const json = JSON.stringify({glossary, cases, meta}).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const html = template.replace('/*__STYLES__*/', () => tokens + '\n' + css.replace(/^@import[^;]+;\s*/m, ''))
  .replace('/*__DATA__*/', () => json).replace('/*__SCRIPT__*/', () => js.replace(/<\/script/gi, '<\\/script'));
await writeFile(new URL('index.html', root), html);
console.log(`Built ${fileURLToPath(new URL('index.html', root))} (${cases.length} cases, ${glossary.length} terms)`);
