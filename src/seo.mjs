// Génère les pages /joueurs/ (référencement) à partir de la base de joueurs.
import { P, ALL_LETTERS } from '../netlify/lib/game.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
const out = new URL('../joueurs/', import.meta.url); mkdirSync(out, {recursive: true});
const esc = s => s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const by = {}; ALL_LETTERS.forEach(l => by[l] = []);
P.forEach(p => { const l = (p.sur || '')[0]; if (by[l]) by[l].push(p.name); });
const raw = {}; ALL_LETTERS.forEach(l => raw[l] = [...by[l]]);
Object.values(by).forEach(a => a.sort((x, y) => x.localeCompare(y, 'fr')));
const css = `body{margin:0;font-family:Archivo,Arial,sans-serif;background:#0b2a1d;color:#f1f6ef;line-height:1.5}
main{max-width:860px;margin:0 auto;padding:24px 16px 60px}a{color:#f3d27a}
h2{font-family:"Big Shoulders Display",Impact,sans-serif;font-size:28px;margin:1.4em 0 .4em}h3{font-size:17px;margin:1.2em 0 .2em}h1{font-family:"Big Shoulders Display",Impact,sans-serif;font-size:clamp(34px,7vw,56px);line-height:1;margin:.4em 0}
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
  const title = `Footballeurs commençant par ${L} : ${n} joueurs | Quiz foot FOOT LETTERS`;
  const desc = `Liste de ${n} footballeurs dont le nom commence par la lettre ${L} : ${list.slice(0, 6).join(', ')}… Teste ta culture foot avec FOOT LETTERS.`;
  const ld = {"@context":"https://schema.org","@type":"ItemList","name":`Footballeurs commençant par ${L}`,"numberOfItems":n,
    "itemListElement":list.slice(0,100).map((name,i)=>({"@type":"ListItem","position":i+1,"name":name}))};
  writeFileSync(new URL(`${l}.html`, out), head(title, desc, `/joueurs/${l}.html`) +
    `<h1>Footballeurs commençant par ${L}</h1>
<p>Combien de joueurs dont le <strong>nom de famille</strong> commence par <strong>${L}</strong> peux-tu citer en 3 minutes ? Voici ${n} footballeurs célèbres, d'hier et d'aujourd'hui, pour réviser avant ta partie.</p>
<a class="cta" href="/">Jouer à FOOT LETTERS →</a>${nav(l)}
<ul>${list.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
<p>Prêt pour le quiz foot ? <a href="/">Joue la lettre ${L}</a> ou découvre <a href="/quiz-foot/">comment marche le quiz</a>. La base du jeu reconnaît aussi des milliers d'autres joueurs professionnels via Wikidata. <a href="/">Lance une partie</a>, défie tes amis ou tente la lettre du jour.</p>
<script type="application/ld+json">${JSON.stringify(ld)}</script>` + foot);
});
writeFileSync(new URL('index.html', out), head('Footballeurs par lettre de A à Z | FOOT LETTERS',
  `Plus de ${P.length} footballeurs célèbres classés par la première lettre de leur nom, de A à Z. Révise puis joue à FOOT LETTERS.`, '/joueurs/') +
  `<h1>Footballeurs de A à Z</h1><p><a href="/quiz-foot/">Le quiz foot FOOT LETTERS</a> : une lettre, un chrono, combien de joueurs peux-tu citer ?</p><p>Plus de ${P.length} joueurs célèbres classés par la première lettre de leur nom de famille. Choisis une lettre :</p>
<a class="cta" href="/">Jouer à FOOT LETTERS →</a>${nav('')}
<ul>${ALL_LETTERS.map(l => `<li><a href="/joueurs/${l}.html">Footballeurs commençant par ${l.toUpperCase()}</a> (${by[l].length})</li>`).join('')}</ul>` + foot);
// Page « quiz foot »
const top = [...ALL_LETTERS].sort((a, b) => by[b].length - by[a].length);
const ex = (l, k) => raw[l].slice(0, k).join(', ');
const qdir = new URL('../quiz-foot/', import.meta.url); mkdirSync(qdir, {recursive: true});
const qfaq = [
  ['Le quiz foot est-il gratuit ?', 'Oui. FOOT LETTERS est entièrement gratuit et se joue dans le navigateur, sans téléchargement. Tu peux aussi l\'installer sur ton téléphone comme une appli.'],
  ['Faut-il un compte pour jouer ?', 'Non. Un compte (juste un pseudo et un mot de passe) sert seulement à garder tes statistiques, débloquer des badges et apparaître dans les classements.'],
  ['Peut-on faire un quiz foot entre amis ?', 'Oui : le mode « Entre amis » crée un salon en ligne avec un code à 4 lettres. Tes amis rejoignent depuis leur téléphone, où qu\'ils soient. Le mode « Jouer ici » permet aussi de jouer à plusieurs sur un seul appareil.'],
  ['Quels footballeurs sont acceptés ?', `Les joueurs professionnels, actuels et retraités, de tous les pays : ${P.length} joueurs sont intégrés au jeu et des milliers d'autres sont vérifiés en direct. Seul le nom de famille compte (ou le nom d'usage, comme Neymar ou Pelé).`],
  ['Quelle est la lettre la plus facile ?', `Les lettres avec le plus de footballeurs connus sont ${top.slice(0, 4).map((l) => l.toUpperCase()).join(', ')}. Les plus dures : ${top.slice(-4).map((l) => l.toUpperCase()).join(', ')}.`],
];
const qld = [{"@context":"https://schema.org","@type":"FAQPage","mainEntity":qfaq.map(([q,a])=>({"@type":"Question","name":q,"acceptedAnswer":{"@type":"Answer","text":a}}))},
  {"@context":"https://schema.org","@type":"VideoGame","name":"FOOT LETTERS","url":"https://footletters.com/","genre":["Quiz","Football"],"inLanguage":"fr","offers":{"@type":"Offer","price":"0","priceCurrency":"EUR"}}];
writeFileSync(new URL('index.html', qdir), head('Quiz foot gratuit en ligne : teste ta culture foot | FOOT LETTERS',
  'Quiz foot gratuit : une lettre, un chrono, cite un maximum de footballeurs. Lettre du jour, défis, quiz foot entre amis en ligne et classements mondiaux.', '/quiz-foot/') +
`<h1>Quiz foot : le jeu de culture foot gratuit</h1>
<p><strong>FOOT LETTERS</strong> est un quiz foot en ligne, simple et addictif : une lettre tombe, et tu dois citer un maximum de footballeurs dont le <strong>nom de famille</strong> commence par cette lettre. Pas de QCM, pas de questions pièges : juste ta mémoire du foot contre le chrono.</p>
<a class="cta" href="/">Lancer le quiz foot →</a>
<h2>Comment jouer ?</h2>
<p>Une lettre est tirée, par exemple <strong>M</strong>. Tu tapes un nom : Mbappé, Messi, Modrić, Maldini, Mahrez, Matuidi… Chaque bonne réponse rapporte un point, les doublons et les mauvaises lettres sont refusés. Le jeu reconnaît les accents, les fautes légères et les noms d'usage.</p>
<h2>6 façons de jouer</h2>
<ul style="columns:1">
<li><strong>Lettre du jour</strong> : la même lettre pour tout le monde, 3 minutes, un seul essai et un classement du jour. Partage ta grille de résultat comme sur Wordle.</li>
<li><strong>Quiz foot entre amis</strong> : un salon en ligne avec un code, chacun joue sur son téléphone. Manches, points (3, 2, 1) et classement mondial des victoires.</li>
<li><strong>Jouer ici</strong> : à plusieurs sur un même téléphone, on se passe l'appareil.</li>
<li><strong>Défi</strong> : annonce combien de joueurs tu vas trouver, puis tiens parole avec 30 secondes par nom.</li>
<li><strong>Tour de l'alphabet</strong> : un footballeur pour chaque lettre de A à Z, le plus vite possible, avec 3 jokers.</li>
<li><strong>Solo</strong> : entraîne-toi, débloque des badges et fais grimper ta série de jours.</li>
</ul>
<h2>Exemples par lettre</h2>
<p><strong>A</strong> : ${ex('a', 5)}. <strong>B</strong> : ${ex('b', 5)}. <strong>R</strong> : ${ex('r', 5)}. <strong>Z</strong> : ${ex('z', 5)}.</p>
<p>Pour réviser avant de jouer, consulte la liste complète des <a href="/joueurs/">footballeurs de A à Z</a>.</p>
${nav('')}
<h2>Questions fréquentes</h2>
${qfaq.map(([q,a])=>`<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('\n')}
<a class="cta" href="/">Jouer gratuitement →</a>
${qld.map(x=>`<script type="application/ld+json">${JSON.stringify(x)}</script>`).join('')}` + foot);
console.log('pages /joueurs générées :', ALL_LETTERS.map(l => l + by[l].length).join(' '));
