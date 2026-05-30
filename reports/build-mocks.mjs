// Throwaway: assemble the 3 redesign concepts (from the workflow output) into
// standalone HTML files with a phone frame + a drawn-in keyboard, for rendering.
import { readFileSync, writeFileSync } from 'node:fs';

const OUT =
  'C:/Users/tnvmu/AppData/Local/Temp/claude/C--Users-tnvmu-Downloads-Projects-Hemanth-money-management-tool/f984a2c4-8b34-49d0-b30a-e51eb6b16173/tasks/w1vkgxuuz.output';

const data = JSON.parse(readFileSync(OUT, 'utf8'));
const concepts = data.result;

function unesc(s) {
  if (!/&lt;|&gt;|&amp;|&quot;|&#39;/.test(s)) return s;
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function keys() {
  const row = (n, extra = '') =>
    `<div class="krow">${Array.from({ length: n }, () => `<span class="key" ${extra}></span>`).join('')}</div>`;
  return `<div class="kbd"><span class="kbd-lbl">— keyboard —</span><div class="keys">
    ${row(10)}${row(10)}${row(9)}
    <div class="krow"><span class="key" style="flex:1.6"></span><span class="key wide"></span><span class="key" style="flex:1.6"></span></div>
  </div></div>`;
}

const SKELETON = (label, sub, typing, picker) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;background:#cfc8bd;padding:30px;display:flex;gap:46px;align-items:flex-start;}
  .col{display:flex;flex-direction:column;align-items:center;gap:12px;}
  .cap{font-size:15px;font-weight:800;color:#332e27;text-align:center;}
  .cap small{display:block;font-weight:500;color:#5f574c;font-size:12px;margin-top:3px;}
  .phone{width:320px;height:568px;background:#f7f2ea;border-radius:32px;overflow:hidden;position:relative;box-shadow:0 16px 40px rgba(0,0,0,.3);border:8px solid #15130f;}
  .typing-area{position:absolute;left:0;right:0;top:0;height:310px;overflow:hidden;}
  .picker-area{position:absolute;inset:0;overflow:hidden;}
  .kbd{position:absolute;left:0;right:0;bottom:0;height:258px;background:linear-gradient(#dbd6cd,#cdc7bd);border-top:1px solid #b7b0a4;padding:22px 6px 10px;}
  .kbd-lbl{position:absolute;top:6px;left:0;right:0;text-align:center;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#857e72;}
  .keys{height:100%;display:flex;flex-direction:column;gap:8px;}
  .krow{flex:1;display:flex;gap:5px;justify-content:center;}
  .key{flex:1;background:#fff;border-radius:6px;box-shadow:0 1px 0 #b3aca0;max-width:30px;}
  .key.wide{max-width:none;flex:5;}
  .title{font-size:20px;font-weight:800;color:#2b2620;margin:0 0 16px;}
</style></head><body>
  <div class="col">
    <div class="cap">① While you type<small>${sub}</small></div>
    <div class="phone"><div class="typing-area">${typing}</div>${keys()}</div>
  </div>
  <div class="col">
    <div class="cap">② Tap “Food” → its subs open<small>no keyboard while picking</small></div>
    <div class="phone"><div class="picker-area">${picker}</div></div>
  </div>
</body></html>`;

const SUBS = [
  'top boxes update as you type',
  'live line under the description',
  'full-screen, big and roomy'
];

concepts.forEach((c, i) => {
  const html = SKELETON(
    c.approach,
    SUBS[i] ?? 'keyboard up — nothing hidden',
    unesc(c.typingScreenHTML),
    unesc(c.pickerScreenHTML)
  );
  const path = `reports/mock-${i + 1}.html`;
  writeFileSync(path, html, 'utf8');
  console.log(`\n=== Option ${i + 1}: ${c.approach} ===`);
  console.log(`idea: ${c.plainIdea}`);
  console.log(`-> ${path}`);
});
console.log('\nDONE');
