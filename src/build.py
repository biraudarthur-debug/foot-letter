# Reconstruit index.html (site) et netlify/lib/game.mjs (règles partagées avec le serveur).
import json, pathlib, re
root = pathlib.Path(__file__).resolve().parent
repo = root.parent
html = (root / "index.template.html").read_text(encoding="utf8")
players = (root / "players.txt").read_text(encoding="utf8")
(repo / "index.html").write_text(html.replace("/*PLAYERS*/", players), encoding="utf8")

def seg(tag):
    m = re.search(r"/\*<" + tag + r">\*/(.*?)/\*</" + tag + r">\*/", html, re.S)
    return m.group(1)

lib = repo / "netlify" / "lib"
lib.mkdir(parents=True, exist_ok=True)
(lib / "game.mjs").write_text(
    "// Fichier généré par src/build.py : mêmes règles que le site, utilisées par le serveur.\n"
    "const RAW_PLAYERS = " + json.dumps(players, ensure_ascii=False) + ";\n"
    "function fetchJSON(url, ms){\n"
    "  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms);\n"
    "  return fetch(url, {signal: ctl.signal, headers: {'User-Agent': 'FootLetter/1.0 (jeu de quiz foot; netlify)'}})\n"
    "    .then(r => { clearTimeout(tm); if(!r.ok) throw new Error('http'); return r.json(); });\n"
    "}\n"
    + seg("GAME") + "\n" + seg("GAME2") +
    "\nexport { norm, titleCase, checkLocal, nameLetters, fullNameLetters, resolveRemote, DRAW_LETTERS, DAILY_LETTERS, ALL_LETTERS, parisDate, dailyLetter, P };\n",
    encoding="utf8")
print("index.html + netlify/lib/game.mjs reconstruits")

# Pages de référencement /joueurs/*.html
import subprocess
subprocess.run(["node", str(root / "seo.mjs")], check=True)
