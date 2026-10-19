// API FOOT LETTERS : comptes, parties vérifiées, classements, profils, badges.
// Tourne en fonction Netlify ; les données sont gardées dans Netlify Blobs.
// Principe anti-perte : chaque donnée qui peut être écrite en même temps par plusieurs
// requêtes vit dans son propre fichier (session, partie, essai du jour, ligne de classement),
// pour qu'aucune écriture n'en écrase une autre.
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import { norm, badNick, titleCase, checkLocal, nameLetters, fullNameLetters, resolveRemote, DRAW_LETTERS, ALL_LETTERS, parisDate, dailyLetter } from "../lib/game.mjs";

export const config = { path: ["/api/*", "/diag"] };

// Seule l'empreinte du code administrateur est ici ; le code lui-même n'est jamais publié.
const ADMIN_HASH = "c76e68b02e609ff7a876ca4494004f82c95ce464f96248aa15aac152315ebdd5";
const PER = 30000, DAILY_MS = 180000, ABC_PEN = 15000;
const store = () => getStore({ name: "footletter", consistency: "strong" });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex" } });
const fail = (code, status = 400) => json({ error: code }, status);
const getJSON = async (st, key) => { try { return (await st.get(key, { type: "json" })) || null; } catch (_) { return null; } };
const putJSON = (st, key, val) => st.setJSON(key, val);
const rnd = (n) => crypto.randomBytes(n).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, n);
async function listKeys(st, prefix) { const r = await st.list({ prefix }); return (r.blobs || []).map((b) => b.key); }

/* ---------- comptes et sessions ---------- */
const userKey = (name) => norm(name).replace(/ /g, "_");
const cleanName = (n) => String(n || "").replace(/\s+/g, " ").trim();
const validName = (n) => /^[\p{L}\p{N} _.\-]{2,18}$/u.test(n) && userKey(n).length >= 2 && !badNick(n);
// nom de remplacement stable pour un pseudo interdit (même joueur → même nom)
const stableName = (key) => "Joueur " + crypto.createHash("sha1").update(String(key)).digest("hex").slice(0, 3).toUpperCase();
const shownName = (u, n) => (n && !badNick(n) ? n : stableName(u));
const cleanRows = (list) => list.map((e) => (e && e.n && badNick(e.n) ? { ...e, n: stableName(e.u) } : e));
const hashPass = (pass, salt) => crypto.scryptSync(String(pass), salt, 32).toString("hex");
function newUser(name) {
  return { key: userKey(name), name, created: Date.now(), stats: blankStats(), badges: {}, daily: { last: null, streak: 0, best: 0 }, done: {}, runs: [] };
}
function blankStats() { return { games: { daily: 0, defi: 0, abc: 0, friends: 0, bot: 0 }, wins: 0, names: 0, bestDaily: 0, bestDefi: 0, bestAbc: 0, bestMinute: 0, abcClean: false, letters: {}, players: {}, online: { p: 0, w: 0, pts: 0, names: 0, podium: 0 } }; }
function fixUser(u) {
  u.stats = Object.assign(blankStats(), u.stats || {});
  u.stats.online = Object.assign({ p: 0, w: 0, pts: 0, names: 0, podium: 0 }, u.stats.online || {});
  u.stats.games = Object.assign({ daily: 0, defi: 0, abc: 0, friends: 0 }, u.stats.games || {});
  u.badges = u.badges || {}; u.daily = u.daily || { last: null, streak: 0, best: 0 }; u.done = u.done || {}; u.runs = u.runs || [];
  return u;
}
async function loadUser(st, key) { const u = await getJSON(st, "user/" + key); return u ? fixUser(u) : null; }
function top(obj) { const e = Object.entries(obj || {}).sort((a, b) => b[1] - a[1])[0]; return e ? { k: e[0], n: e[1] } : null; }
// Expérience : calculée à partir des stats, donc jamais perdue et toujours cohérente
// 10 XP par joueur cité, 20 par partie jouée, 50 par victoire entre amis, 15 par podium en ligne,
// 10 par jour du record de série, 100 par badge. Passer du niveau N au niveau N+1 coûte 100 x N XP.
function xpOf(u) {
  const s = u.stats, games = Object.values(s.games || {}).reduce((a, b) => a + b, 0);
  const xp = (s.names || 0) * 10 + games * 20 + (s.wins || 0) * 50 + ((s.online && s.online.podium) || 0) * 15 + ((u.daily && u.daily.best) || 0) * 10 + Object.keys(u.badges || {}).length * 100;
  let lvl = 1, rem = xp; while (rem >= 100 * lvl && lvl < 999) { rem -= 100 * lvl; lvl++; }
  return { xp, lvl, cur: rem, need: 100 * lvl };
}
function publicProfile(u) {
  const s = u.stats;
  return { name: u.name, key: u.key, guest: !!u.guest, created: u.created, level: xpOf(u), badges: u.badges, daily: u.daily,
    stats: { games: s.games, total: Object.values(s.games).reduce((a, b) => a + b, 0), wins: s.wins, names: s.names,
      bestDaily: s.bestDaily, bestDefi: s.bestDefi, bestAbc: s.bestAbc, topPlayer: top(s.players), topLetter: top(s.letters),
      letterCount: Object.keys(s.letters || {}).length, online: s.online, bot: s.bot || null } };
}
async function saveUser(st, u) {
  const p = u.stats.players; const ks = Object.keys(p);
  if (ks.length > 300) ks.sort((a, b) => p[a] - p[b]).slice(0, ks.length - 300).forEach((k) => delete p[k]);
  const days = Object.keys(u.done).sort(); if (days.length > 60) days.slice(0, days.length - 60).forEach((k) => delete u.done[k]);
  if (u.runs.length > 30) u.runs = u.runs.slice(-30);
  await putJSON(st, "user/" + u.key, u);
}
async function newSession(st, key) { const id = rnd(32); await putJSON(st, "session/" + id, { u: key, c: Date.now() }); return "S." + id; }
// anciens jetons signés (versions précédentes) : acceptés si le secret existe, puis remplacés
async function legacyKey(st, tok) {
  const m = await getJSON(st, "meta/secret"); if (!m) return null;
  const [body, sig] = String(tok).split("."); if (!body || !sig) return null;
  const exp = crypto.createHmac("sha256", m.k).update(body).digest("base64url");
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  try { const d = JSON.parse(Buffer.from(body, "base64url").toString()); return d.t === "s" ? d.u : null; } catch (_) { return null; }
}
async function authUser(req, st) {
  const h = req.headers.get("authorization") || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!tok) return null;
  let key = null, legacy = false;
  if (tok.startsWith("S.")) { const s = await getJSON(st, "session/" + tok.slice(2).replace(/[^A-Za-z0-9]/g, "")); key = s && s.u; }
  else { key = await legacyKey(st, tok); legacy = !!key; }
  if (!key) return null;
  const u = await loadUser(st, key);
  if (u) u._legacy = legacy;
  return u;
}

/* ---------- badges : calculés à partir des statistiques, donc jamais ratés ---------- */
const BADGE_RULES = {
  kickoff: (u) => Object.values(u.stats.games).some((n) => n > 0),
  ten_minute: (u) => u.stats.bestMinute >= 10,
  daily20: (u) => u.stats.bestDaily >= 20,
  streak3: (u) => u.daily.best >= 3, streak7: (u) => u.daily.best >= 7, streak30: (u) => u.daily.best >= 30,
  defi10: (u) => u.stats.bestDefi >= 10 || !!(u.stats.bot && (u.stats.bot.w.m || u.stats.bot.w.h)),
  defi20: (u) => u.stats.bestDefi >= 20 || !!(u.stats.bot && u.stats.bot.w.h),
  abc_clean: (u) => !!u.stats.abcClean, abc_fast: (u) => u.stats.bestAbc > 0 && u.stats.bestAbc < 180000,
  win1: (u) => u.stats.wins >= 1, win10: (u) => u.stats.wins >= 10,
  century: (u) => u.stats.names >= 100, legend: (u) => u.stats.names >= 500,
  polyglot: (u) => Object.keys(u.stats.letters).length >= 20,
};
function award(u) { const nb = []; for (const [id, ok] of Object.entries(BADGE_RULES)) if (!u.badges[id] && ok(u)) { u.badges[id] = Date.now(); nb.push(id); } return nb; }

/* ---------- classements : une ligne = un fichier par joueur ---------- */
const CMP = {
  daily: (a, b) => b.s - a.s || a.t - b.t || a.d - b.d,
  defi: (a, b) => b.s - a.s || a.t - b.t || a.d - b.d,
  bot: (a, b) => b.s - a.s || b.w - a.w || a.t - b.t || a.d - b.d,
  abc: (a, b) => a.t - b.t || a.s - b.s || a.d - b.d,
  // victoires en ligne : victoires, puis % de victoires, puis points
  online: (a, b) => b.s - a.s || (b.s / Math.max(1, b.p)) - (a.s / Math.max(1, a.p)) || b.pts - a.pts || a.d - b.d,
};
const entryKey = (kind, key, u) => "entry/" + kind + "/" + key + "/" + u;
async function entryPut(st, kind, key, e, force) {
  if (String(e.u).startsWith("g~")) e.g = 1;
  const k = entryKey(kind, key, e.u);
  if (force) return putJSON(st, k, e);
  const cur = await getJSON(st, k);
  if (!cur || CMP[kind](e, cur) < 0) await putJSON(st, k, e);
}
async function legacyBoard(st, kind, key) {
  if (kind === "defi") { const m = await getJSON(st, "board/defi"); return (m && m[key]) || []; }
  return (await getJSON(st, "board/" + kind + "/" + key)) || [];
}
async function boardRead(st, kind, key) {
  const keys = (await listKeys(st, "entry/" + kind + "/" + key + "/")).slice(0, 500);
  const rows = (await Promise.all(keys.map((k) => getJSON(st, k)))).filter(Boolean);
  const best = new Map();
  [...rows, ...(await legacyBoard(st, kind, key))].forEach((e) => { if (!e || !e.u) return; const c = best.get(e.u); if (!c || CMP[kind](e, c) < 0) best.set(e.u, e); });
  return cleanRows([...best.values()].sort(CMP[kind]).slice(0, 100));
}
async function letterMap(st, kind) {
  const keys = await listKeys(st, "entry/" + kind + "/");
  const letters = new Set(keys.map((k) => k.split("/")[2]));
  const out = {};
  await Promise.all([...letters].map(async (l) => { out[l] = await boardRead(st, kind, l); }));
  return out;
}
async function defiMap(st) {
  const keys = await listKeys(st, "entry/defi/");
  const letters = new Set(keys.map((k) => k.split("/")[2]));
  const old = (await getJSON(st, "board/defi")) || {};
  Object.keys(old).forEach((l) => letters.add(l));
  const out = {};
  await Promise.all([...letters].map(async (l) => { out[l] = await boardRead(st, "defi", l); }));
  return out;
}

// Rattrapage unique : tours de l'alphabet allés jusqu'au bout (25 lettres validées sur 26) mais
// refusés à cause de l'ancienne vérification du nom affiché (corrigée en v10.13). Temps = temps mesuré par le serveur.
async function restoreAbc(st) {
  if (await getJSON(st, "meta/restore-abc-1")) return;
  await putJSON(st, "meta/restore-abc-1", { t: Date.now() });
  const keys = await listKeys(st, "run/");
  const runs = (await Promise.all(keys.map((k) => getJSON(st, k)))).filter((r) => r && r.m === "abc" && r.used && r.result && !r.result.ok && r.result.score >= 25 && !r.answers);
  for (const r of runs) {
    const u = await loadUser(st, r.u); if (!u) continue;
    await entryPut(st, "abc", "all", { u: u.key, n: u.name, s: 0, t: r.used - r.t0, d: r.used, fix: 1 });
    if (!u.stats.bestAbc || u.stats.bestAbc > r.used - r.t0) { u.stats.bestAbc = r.used - r.t0; await saveUser(st, u); }
  }
}

/* ---------- vérification des réponses ---------- */
// Vérifie chaque réponse. Les noms hors base sont recherchés sur Wikidata avec un budget de temps :
// si le serveur n'obtient pas de réponse nette (réseau lent, limite de requêtes), on garde le verdict
// du site, seul un refus net (mauvaise lettre, doublon) annule un nom.
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r({ st: "none", off: 1 }), ms))]);
async function validateSeq(items, letterOf) {
  const used = new Set(), remote = new Map(), unknown = [];
  const alt = (it, L) => { if (!it.d || it.d === it.v) return null; const r = checkLocal(String(it.d).slice(0, 60), L, new Set()); return r.st === "ok" ? r : null; };
  items.forEach((it, i) => { if (checkLocal(String(it.v || "").slice(0, 60), letterOf(it, i), new Set()).st === "unknown" && !alt(it, letterOf(it, i))) unknown.push(i); });
  const deadline = Date.now() + 4000; let next = 0;
  const worker = async () => {
    while (next < unknown.length && Date.now() < deadline) {
      const i = unknown[next++];
      const left = Math.max(500, deadline - Date.now());
      remote.set(i, await withTimeout(resolveRemote(String(items[i].v).slice(0, 60), letterOf(items[i], i), new Set()).catch(() => ({ st: "none", off: 1 })), left));
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);
  return items.map((it, i) => {
    const L = letterOf(it, i), txt = String(it.v || "").slice(0, 60);
    let r = checkLocal(txt, L, used);
    if (r.st !== "ok") { const a = alt(it, L); if (a) r = a.keys.some((k) => used.has(k)) ? { st: "bad" } : a; }
    if (r.st === "unknown") {
      const rr = remote.get(i), n = norm(txt), l = L.toLowerCase();
      if (rr && rr.st === "ok") r = rr.keys.some((k) => used.has(k)) ? { st: "bad" } : rr;
      else if (rr && (rr.st === "bad" || (rr.st === "none" && !rr.off))) r = { st: "bad" };
      else if (n.length >= 2 && (fullNameLetters(n).has(l) || nameLetters(n).has(l))) {
        const key = (n.includes(" ") ? "f:" : "s:") + n;
        r = used.has(key) ? { st: "bad" } : { st: "ok", display: titleCase(txt), keys: [key] };
      } else r = { st: "bad" };
    }
    if (r.st === "ok") { r.keys.forEach((k) => used.add(k)); return { ok: true, display: r.display, L, ms: +it.ms || 0 }; }
    return { ok: false };
  });
}
function countNames(u, oks) {
  oks.forEach((a) => { u.stats.names++; const l = a.L.toLowerCase(); u.stats.letters[l] = (u.stats.letters[l] || 0) + 1; u.stats.players[a.display] = (u.stats.players[a.display] || 0) + 1; });
}
const yesterday = (date) => parisDate(new Date(Date.parse(date + "T12:00:00Z") - 86400000));
async function dailyToday(st, u, today) { return (await getJSON(st, "daily/" + today + "/" + u.key)) || u.done[today] || null; }

/* ---------- routes ---------- */
async function route(req, path, st) {
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const url = new URL(req.url);

  if (path === "health") {
    let blobs = false;
    try { const k = "meta/health"; const v = Date.now(); await putJSON(st, k, { v }); blobs = ((await getJSON(st, k)) || {}).v === v; } catch (_) { }
    const out = { ok: true, blobs, version: 11, time: Date.now() };
    if (url.searchParams.get("deep") === "1") {
      const t0 = Date.now(), pk = "probe/" + rnd(8);
      try { await putJSON(st, pk, { t: t0 }); out.probeWriteMs = Date.now() - t0; const l = await listKeys(st, "probe/"); out.probeListed = l.includes(pk); await st.delete(pk); } catch (e) { out.probeErr = String(e && e.message || e); }
      const count = async (p) => { try { return (await listKeys(st, p)).length; } catch (e) { return "err:" + (e && e.message); } };
      out.counts = { users: await count("user/"), entriesDaily: await count("entry/daily/"), entriesDefi: await count("entry/defi/"), entriesAbc: await count("entry/abc/"), entriesOnline: await count("entry/online/"), legacyBoards: await count("board/"), runs: await count("run/"), sessions: await count("session/") };
      try {
        const rk = await listKeys(st, "run/");
        const runs = (await Promise.all(rk.map((k) => getJSON(st, k)))).filter(Boolean);
        out.runs = runs.map((r) => ({ u: r.u, m: r.m, start: r.t0, used: r.used ? r.used - r.t0 : null, ok: r.result ? r.result.ok : null, score: r.result ? r.result.score : null, ranked: r.result ? !!r.result.entry : null })).sort((a, b) => a.start - b.start);
      } catch (_) { }
      try { out.entryKeys = (await listKeys(st, "entry/")).map((k) => k.split("/").slice(1, 3).join("/")); out.legacy = await listKeys(st, "board/"); } catch (_) { }
      try { const ks = (await listKeys(st, "log/")).sort().slice(-25); out.log = (await Promise.all(ks.map((k) => getJSON(st, k)))).filter(Boolean); } catch (_) { }
    }
    return json(out);
  }

  // joueur sans compte : profil invité (pseudo libre), classé comme les autres
  if (path === "guest") {
    let name = cleanName(String(body.name || "").replace(/[^\p{L}\p{N} _.\-]/gu, "")).slice(0, 18);
    const cur = await authUser(req, st);
    const gkey = cur && cur.guest ? cur.key : "g~" + rnd(14).toLowerCase();
    if (!validName(name)) name = cur && cur.guest && validName(cur.name) ? cur.name : stableName(gkey);
    if (cur && cur.guest) { if (cur.name !== name) { cur.name = name; await saveUser(st, cur); } await putJSON(st, "seen/" + cur.key, { t: Date.now() }); return json({ token: null, profile: publicProfile(cur) }); }
    const u = newUser(name); u.key = gkey; u.guest = true;
    await saveUser(st, u);
    await putJSON(st, "seen/" + u.key, { t: Date.now() });
    return json({ token: await newSession(st, u.key), profile: publicProfile(u) });
  }
  if (path === "register") {
    const name = cleanName(body.name), pass = String(body.pass || "");
    if (!validName(name)) return fail("bad_name");
    if (pass.length < 4 || pass.length > 64) return fail("bad_pass");
    const key = userKey(name);
    if (await getJSON(st, "user/" + key)) return fail("taken", 409);
    const u = newUser(name); u.salt = crypto.randomBytes(16).toString("hex"); u.hash = hashPass(pass, u.salt);
    const g = await authUser(req, st);
    if (g && g.guest) { u.stats = g.stats; u.badges = g.badges; u.daily = g.daily; u.done = g.done; u.created = g.created; }
    await saveUser(st, u);
    await putJSON(st, "seen/" + key, { t: Date.now() });
    return json({ token: await newSession(st, key), profile: publicProfile(u) });
  }
  if (path === "login") {
    const u = await loadUser(st, userKey(cleanName(body.name)));
    if (!u || !u.hash) return fail("bad_login", 401);
    const h = hashPass(String(body.pass || ""), u.salt);
    if (!crypto.timingSafeEqual(Buffer.from(h), Buffer.from(u.hash))) return fail("bad_login", 401);
    await putJSON(st, "seen/" + u.key, { t: Date.now() });
    return json({ token: await newSession(st, u.key), profile: publicProfile(u) });
  }
  if (path === "profile") {
    const u = await loadUser(st, userKey(url.searchParams.get("u") || ""));
    return u ? json({ profile: publicProfile(u) }) : fail("not_found", 404);
  }
  if (path === "board") {
    const kind = url.searchParams.get("kind"), key = String(url.searchParams.get("key") || "").toLowerCase();
    if (kind === "bot") return json(key ? { list: /^[a-z]$/.test(key) ? await boardRead(st, "bot", key) : [] } : { map: await letterMap(st, "bot") });
    if (kind === "defi") return json(key ? { list: /^[a-z]$/.test(key) ? await boardRead(st, "defi", key) : [] } : { map: await defiMap(st) });
    if (kind === "daily" && /^\d{4}-\d{2}-\d{2}$/.test(key)) return json({ list: await boardRead(st, "daily", key) });
    if (kind === "abc") { await restoreAbc(st); return json({ list: await boardRead(st, "abc", "all") }); }
    if (kind === "online") return json({ list: await boardRead(st, "online", "all") });
    if (kind === "xp") {
      const c = await getJSON(st, "cache/xp");
      if (c && Date.now() - c.t < 60000) return json({ list: c.list });
      const keys = (await listKeys(st, "user/")).slice(0, 2000);
      const users = (await Promise.all(keys.map((k) => getJSON(st, k)))).filter((x) => x && !x.guest).map(fixUser);
      const list = users.map((x) => { const l = xpOf(x); return { u: x.key, n: shownName(x.key, x.name), s: l.xp, lvl: l.lvl, d: x.created || 0 }; }).filter((e) => e.s > 0).sort((a, b) => b.s - a.s || a.d - b.d).slice(0, 100);
      await putJSON(st, "cache/xp", { t: Date.now(), list });
      return json({ list });
    }
    return fail("bad_board");
  }

  const u = await authUser(req, st);
  if (!u) return fail("auth", 401);
  const today = parisDate();

  if (path === "me") {
    const seen = await getJSON(st, "seen/" + u.key), now = Date.now();
    if (!seen || now - seen.t > 600000) await putJSON(st, "seen/" + u.key, { t: now });
    const nb = award(u); if (nb.length) await saveUser(st, u);
    const out = { profile: publicProfile(u), today: await dailyToday(st, u, today), date: today, admin: !!u.admin, newBadges: nb };
    if (u._legacy) out.renew = await newSession(st, u.key);
    return json(out);
  }

  if (path === "admin/claim") {
    const h = crypto.createHash("sha256").update(String(body.code || "").trim().toUpperCase()).digest("hex");
    if (h !== ADMIN_HASH) return fail("bad_code", 403);
    u.admin = true; await saveUser(st, u);
    return json({ admin: true });
  }
  if (path === "admin/stats") {
    if (!u.admin) return fail("forbidden", 403);
    const keys = (await listKeys(st, "user/")).slice(0, 1000);
    const all = (await Promise.all(keys.map((k) => getJSON(st, k)))).filter(Boolean).map(fixUser);
    const users = all.filter((x) => !x.guest), guestCount = all.length - users.length;
    const seen = await Promise.all(users.map((x) => getJSON(st, "seen/" + x.key)));
    const played = await Promise.all(users.map((x) => getJSON(st, "daily/" + today + "/" + x.key)));
    const now = Date.now(), DAY = 86400000;
    const rows = users.map((x, i) => {
      const g = x.stats.games;
      return { name: x.name, created: x.created, seen: (seen[i] && seen[i].t) || x.seen || x.created, games: Object.values(g).reduce((a, b) => a + b, 0), byMode: g,
        wins: x.stats.wins, names: x.stats.names, streak: x.daily.streak, bestStreak: x.daily.best, badges: Object.keys(x.badges || {}).length, admin: !!x.admin };
    }).sort((a, b) => b.seen - a.seen);
    const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
    return json({ total: rows.length, today: rows.filter((r) => now - r.seen < DAY).length, week: rows.filter((r) => now - r.seen < 7 * DAY).length,
      newWeek: rows.filter((r) => now - r.created < 7 * DAY).length, guests: guestCount, games: sum((r) => r.games), names: sum((r) => r.names),
      dailyToday: played.filter(Boolean).length + users.filter((x, i) => !played[i] && x.done[today]).length, rows });
  }

  if (path === "run/start") {
    const mode = body.mode, now = Date.now(), id = rnd(24);
    let run, letter = null;
    if (mode === "daily") {
      if (await dailyToday(st, u, today)) return fail("already", 409);
      letter = dailyLetter(today);
      await putJSON(st, "daily/" + today + "/" + u.key, { st: 1, t: now });
      run = { m: "daily", u: u.key, d: today, L: letter, t0: now };
    } else if (mode === "defi") {
      const l = String(body.letter || "").toLowerCase(), bet = Math.round(+body.bet);
      if (!DRAW_LETTERS.includes(l) || !(bet >= 1 && bet <= 99)) return fail("bad_run");
      letter = l.toUpperCase(); run = { m: "defi", u: u.key, L: letter, b: bet, t0: now };
    } else if (mode === "bot") {
      const l = String(body.letter || "").toLowerCase(), df = String(body.diff || "");
      if (!DRAW_LETTERS.includes(l) || !["e", "m", "h"].includes(df)) return fail("bad_run");
      letter = l.toUpperCase(); run = { m: "bot", u: u.key, L: letter, df, t0: now };
    } else if (mode === "abc") {
      run = { m: "abc", u: u.key, t0: now };
    } else return fail("bad_run");
    await putJSON(st, "run/" + id, run);
    return json({ run: "R." + id, letter });
  }

  if (path === "run/finish") {
    const id = String(body.run || "").replace(/^R\./, "").replace(/[^A-Za-z0-9]/g, "");
    const run = id ? await getJSON(st, "run/" + id) : null;
    if (!run || run.u !== u.key) return fail("bad_run");
    if (run.result) return json(run.result);

    run.used = run.used || Date.now(); await putJSON(st, "run/" + id, run);
    const now = Date.now(), elapsed = run.used - run.t0;
    // temps affiché par le jeu (chrono lancé à l'apparition de la lettre) ; le serveur vérifie qu'il est
    // plausible : jamais plus long que son propre chrono, et au plus 12 s de moins (animation + réseau)
    const cd = +body.dur, dur = Number.isFinite(cd) && cd > 0 ? Math.round(Math.min(elapsed, Math.max(cd, elapsed - 12000))) : elapsed;
    const answers = Array.isArray(body.answers) ? body.answers.slice(0, 120) : [];
    let entry = null, key, ok = true, oks = [];

    if (run.m === "daily") {
      const items = answers.filter((a) => (+a.ms || 0) <= DAILY_MS + 2000);
      const res = elapsed <= DAILY_MS + 90000 ? await validateSeq(items, () => run.L) : [];
      oks = res.filter((r) => r.ok);
      const score = oks.length, t = Math.min(Math.max(0, ...oks.map((o) => o.ms)), elapsed);
      key = run.d;
      await putJSON(st, "daily/" + run.d + "/" + u.key, { s: score, t: now });
      u.done[run.d] = { s: score };
      if (u.daily.last !== run.d) { u.daily.streak = u.daily.last === yesterday(run.d) ? u.daily.streak + 1 : 1; u.daily.last = run.d; u.daily.best = Math.max(u.daily.best, u.daily.streak); }
      u.stats.bestDaily = Math.max(u.stats.bestDaily, score);
      u.stats.bestMinute = Math.max(u.stats.bestMinute, oks.filter((o) => o.ms <= 60000).length);
      entry = { u: u.key, n: u.name, s: score, t, d: now };
    } else if (run.m === "defi") {
      const okTime = elapsed <= run.b * PER + 30000;
      const res = okTime ? await validateSeq(answers.slice(0, run.b + 5), () => run.L) : [];
      oks = res.filter((r) => r.ok);
      ok = oks.length >= run.b; key = run.L.toLowerCase();
      if (ok) { u.stats.bestDefi = Math.max(u.stats.bestDefi, run.b); entry = { u: u.key, n: u.name, s: run.b, t: dur, d: now }; }
    } else if (run.m === "bot") {
      // duel contre le bot : le joueur commence, chacun son tour (30 s pour le joueur, quelques secondes pour le bot)
      const COEF = { e: 1, m: 2, h: 3 }[run.df] || 1, bot = Math.max(0, Math.min(200, Math.round(+body.bot || 0)));
      const sent = answers.slice(0, 200);
      const okTime = elapsed <= (sent.length + bot + 2) * (PER + 12000);
      const res = okTime ? await validateSeq(sent, () => run.L) : [];
      oks = res.filter((r) => r.ok);
      // victoire : le bot a séché après la dernière réponse du joueur (donc un nom de moins que lui)
      ok = body.win === true && okTime && bot === sent.length - 1 && oks.length === sent.length;
      const pts = oks.length * COEF + (ok ? 10 * COEF : 0); key = run.L.toLowerCase();
      u.stats.bot = u.stats.bot || { p: 0, w: { e: 0, m: 0, h: 0 } }; u.stats.bot.p++; if (ok) u.stats.bot.w[run.df] = (u.stats.bot.w[run.df] || 0) + 1;
      if (okTime && (oks.length > 0 || ok)) entry = { u: u.key, n: u.name, s: pts, w: ok ? 1 : 0, df: run.df, nm: oks.length, bt: bot, t: dur, d: now };
    } else {
      const okTime = elapsed <= ALL_LETTERS.length * PER + 30000;
      const items = answers.filter((a) => !a.joker && a.L).slice(0, 26);
      const jokers = answers.filter((a) => a.joker).length;
      const res = okTime ? await validateSeq(items, (it) => String(it.L).toUpperCase()) : [];
      oks = res.filter((r) => r.ok);
      const covered = new Set([...oks.map((o) => o.L.toLowerCase()), ...answers.filter((a) => a.joker).map((a) => String(a.L).toLowerCase())]);
      ok = okTime && jokers <= 3 && ALL_LETTERS.every((l) => covered.has(l));
      const t = dur + jokers * ABC_PEN; key = "all";
      if (ok) { u.stats.bestAbc = u.stats.bestAbc ? Math.min(u.stats.bestAbc, t) : t; if (jokers === 0) u.stats.abcClean = true; entry = { u: u.key, n: u.name, s: jokers, t, d: now }; }
    }
    u.stats.games[run.m] = (u.stats.games[run.m] || 0) + 1;
    countNames(u, oks);
    const newBadges = award(u);
    await saveUser(st, u);
    if (entry) await entryPut(st, run.m, key, entry);
    const list = entry ? await boardRead(st, run.m, key) : null;
    const result = { ok, score: oks.length, valid: oks.map((o) => o.display), entry, list, newBadges, profile: publicProfile(u) };
    run.result = { ok, score: oks.length, valid: result.valid, entry, newBadges: [], profile: result.profile };
    run.answers = answers.slice(0, 60).map((a) => ({ v: String(a.v || "").slice(0, 60), d: a.d ? String(a.d).slice(0, 60) : undefined, L: a.L, joker: a.joker ? 1 : undefined }));
    putJSON(st, "log/" + Date.now() + "-" + rnd(4), { k: "finish", m: run.m, ok, score: oks.length, sent: answers.length, entry: !!entry, ms: Date.now() - now, t: Date.now() }).catch(() => {});
    await putJSON(st, "run/" + id, run);
    return json(result);
  }

  if (path === "match") {
    const mid = String(body.mid || "").replace(/[^a-z0-9]/gi, "").slice(0, 16);
    if (mid) { const k = "match/" + mid + "/" + u.key; if (await getJSON(st, k)) return json({ newBadges: [], profile: publicProfile(u) }); await putJSON(st, k, { t: Date.now() }); }
    const names = Array.isArray(body.names) ? body.names.slice(0, 200).map((n) => titleCase(String(n).slice(0, 40))) : [];
    const online = body.online === true, players = Math.max(1, Math.min(10, +body.players || 1));
    let won = body.won === true;
    // même match signalé par plusieurs joueurs : un seul vainqueur possible
    if (mid && players >= 2) {
      const rk = "mres/" + mid, cur = await getJSON(st, rk), w = norm(String(body.winner || ""));
      if (!cur) await putJSON(st, rk, { w, n: players, t: Date.now() });
      else if (cur.w !== w) won = false;
    }
    u.stats.games.friends++;
    if (won) u.stats.wins++;
    names.forEach((n) => { u.stats.names++; u.stats.players[n] = (u.stats.players[n] || 0) + 1; });
    if (Array.isArray(body.letters)) body.letters.slice(0, 10).forEach((l) => { l = String(l).toLowerCase(); if (/^[a-z]$/.test(l)) u.stats.letters[l] = (u.stats.letters[l] || 0) + 1; });
    if (online && players >= 2) {
      const o = u.stats.online;
      o.p++; if (won) o.w++; o.pts += Math.max(0, Math.min(60, +body.pts || 0)); o.names += names.length;
      if ((+body.rank || 9) <= 3) o.podium++;
      await entryPut(st, "online", "all", { u: u.key, n: u.name, s: o.w, p: o.p, pts: o.pts, nm: o.names, pod: o.podium, d: Date.now() }, true);
    }
    const newBadges = award(u);
    await saveUser(st, u);
    putJSON(st, "log/" + Date.now() + "-" + rnd(4), { k: "match", online, players, won, claim: body.won === true, t: Date.now() }).catch(() => {});
    return json({ newBadges, profile: publicProfile(u) });
  }
  return fail("not_found", 404);
}

export default async (req) => {
  const pn = new URL(req.url).pathname;
  const path = pn === "/diag" ? (new URL(req.url).searchParams.get("kind") ? "board" : "health") : pn.replace(/^\/api\/?/, "").replace(/\/$/, "");
  try { return await route(req, path, store()); }
  catch (e) { console.error(e); try { await store().setJSON("log/" + Date.now() + "-" + rnd(4), { k: "error", path, msg: String(e && e.stack || e).slice(0, 400), t: Date.now() }); } catch (_) { } return fail("server", 500); }
};
