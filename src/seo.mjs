// Génère les pages /joueurs/ (référencement) à partir de la base de joueurs.
import { P, ALL_LETTERS } from '../netlify/lib/game.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
const out = new URL('../joueurs/', import.meta.url); mkdirSync(out, {recursive: true});
const esc = s => s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const by = {}; ALL_LETTERS.forEach(l => by[l] = []);
P.forEach(p => { const l = (p.sur || '')[0]; if (by[l]) by[l].push(p.name); });
Object.values(by).forEach(a => a.sort((x, y) => x.localeCompare(y, 'fr')));
const css = `body{margin:0;font-family:Archivo,Arial,sans-serif;background:#0b2a1d;color:#f1f6ef;line-height:1.5}
main{max-width:860px;margin:0 auto;padding:24px 16px 60px}a{color:#f3d27a}
h1{font-family:"Big Shoulders Display",Impact,sans-serif;font-size:clamp(34px,7vw,56px);line-height:1;margin:.4em 0}
.cta{display:inline-block;background:linear-gradient(135deg,#fbe8a6,#d4a537,#b07d1f);color:#0a1f16;font-weight:800;padding:12px 20px;border-radius:14px;text-decoration:none;margin:8px 0 18px}
.letters{display:flex;flex-wrap:wrap;gap:6px;margin:16px 0}.letters a{padding:4px 10px;border-radius:8px;background:#1b4535;text-decoration:none;font-weight:700}
.letters a.on{background:#f3d27a;color:#0a1f16}ul{columns:3 200px;padding-left:18px}li{break-inside:avoid}.top{font-weight:800;text-decoration:none;font-size:20px}`;
const head = (title, desc, path) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="https://footletters.com${path}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="https://footletters.com/og.png">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" sizes="48x48" href="/icons/favicon-48.png"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><style>${css}</style></head><body><main><a class="top" href="/">⚽ FOOT LETTERS</a>`;
const nav = cur => `<nav class="letters">${ALL_LETTERS.map(l => `<a href="/joueurs/${l}.html"${l === cur ? ' class="on"' : ''}>${l.toUpperCase()}</a>`).join('')}</nav>`;
const foot = `</main></body></html>\n`;
ALL_LETTERS.forEach(l => {
  const L = l.toUpperCase(), list = by[l], n = list.length;
  const title = `Footballeurs commençant par ${L} : ${n} joueurs célèbres | FOOT LETTERS`;
  const desc = `Liste de ${n} footballeurs dont le nom commence par la lettre ${L} : ${list.slice(0, 6).join(', ')}… Teste ta culture foot avec FOOT LETTERS.`;
  const ld = {"@context":"https://schema.org","@type":"ItemList","name":`Footballeurs commençant par ${L}`,"numberOfItems":n,
    "itemListElement":list.slice(0,100).map((name,i)=>({"@type":"ListItem","position":i+1,"name":name}))};
  writeFileSync(new URL(`${l}.html`, out), head(title, desc, `/joueurs/${l}.html`) +
    `<h1>Footballeurs commençant par ${L}</h1>
<p>Combien de joueurs dont le <strong>nom de famille</strong> commence par <strong>${L}</strong> peux-tu citer en 3 minutes ? Voici ${n} footballeurs célèbres, d'hier et d'aujourd'hui, pour réviser avant ta partie.</p>
<a class="cta" href="/">Jouer à FOOT LETTERS →</a>${nav(l)}
<ul>${list.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
<p>La base du jeu reconnaît aussi des milliers d'autres joueurs professionnels via Wikidata. <a href="/">Lance une partie</a>, défie tes amis ou tente la lettre du jour.</p>
<script type="application/ld+json">${JSON.stringify(ld)}</script>` + foot);
});
writeFileSync(new URL('index.html', out), head('Footballeurs par lettre de A à Z | FOOT LETTERS',
  `Plus de ${P.length} footballeurs célèbres classés par la première lettre de leur nom, de A à Z. Révise puis joue à FOOT LETTERS.`, '/joueurs/') +
  `<h1>Footballeurs de A à Z</h1><p>Plus de ${P.length} joueurs célèbres classés par la première lettre de leur nom de famille. Choisis une lettre :</p>
<a class="cta" href="/">Jouer à FOOT LETTERS →</a>${nav('')}
<ul>${ALL_LETTERS.map(l => `<li><a href="/joueurs/${l}.html">Footballeurs commençant par ${l.toUpperCase()}</a> (${by[l].length})</li>`).join('')}</ul>` + foot);
console.log('pages /joueurs générées :', ALL_LETTERS.map(l => l + by[l].length).join(' '));
