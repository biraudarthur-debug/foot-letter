// API FOOT LETTERS : comptes, parties vérifiées, classements, profils, badges.
// Tourne en fonction Netlify ; les données sont gardées dans Netlify Blobs.
// Principe anti-perte : chaque donnée qui peut être écrite en même temps par plusieurs
// requêtes vit dans son propre fichier (session, partie, essai du jour, ligne de classement),
// pour qu'aucune écriture n'en écrase une autre.
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import { norm, titleCase, checkLocal, nameLetters, fullNameLetters, resolveRemote, DRAW_LETTERS, ALL_LETTERS, parisDate, dailyLetter } from "../lib/game.mjs";

export const config = { path: "/api/*" };

// Seule l'empreinte du code administrateur est ici ; le code lui-même n'est jamais publié.
const ADMIN_HASH = "c76e68b02e609ff7a876ca4494004f82c95ce464f96248aa15aac152315ebdd5";
const PER = 30000, DAILY_MS = 180000, ABC_PEN = 15000;
const store = () => getStore({ name: "footletter", consistency: "strong" });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (code, status = 400) => json({ error: code }, status);
const getJSON = async (st, key) => { try { return (await st.get(key, { type: "json" })) || null; } catch (_) { return null; } };
const putJSON = (st, key, val) => st.setJSON(key, val);
const rnd = (n) => crypto.randomBytes(n).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, n);
async function listKeys(st, prefix) { const r = await st.list({ prefix }); return (r.blobs || []).map((b) => b.key); }

/* ---------- comptes et sessions ---------- */
const userKey = (name) => norm(name).replace(/ /g, "_");
const cleanName = (n) => String(n || "").replace(/\s+/g, " ").trim();
const validName = (n) => /^[\p{L}\p{N} _.\-]{2,18}$/u.test(n) && userKey(n).length >= 2;
const hashPass = (pass, salt) => crypto.scryptSync(String(pass), salt, 32).toString("hex");
function newUser(name) {
  return { key: userKey(name), name, created: Date.now(), stats: blankStats(), badges: {}, daily: { last: null, streak: 0, best: 0 }, done: {}, runs: [] };
}
function blankStats() { return { games: { daily: 0, defi: 0, abc: 0, friends: 0 }, wins: 0, names: 0, bestDaily: 0, bestDefi: 0, bestAbc: 0, bestMinute: 0, abcClean: false, letters: {}, players: {} }; }
function fixUser(u) {
  u.stats = Object.assign(blankStats(), u.stats || {});
  u.stats.games = Object.assign({ daily: 0, defi: 0, abc: 0, friends: 0 }, u.stats.games || {});
  u.badges = u.badges || {}; u.daily = u.daily || { last: null, streak: 0, best: 0 }; u.done = u.done || {}; u.runs = u.runs || [];
  return u;
}
async function loadUser(st, key) { const u = await getJSON(st, "user/" + key); return u ? fixUser(u) : null; }
function top(obj) { const e = Object.entries(obj || {}).sort((a, b) => b[1] - a[1])[0]; return e ? { k: e[0], n: e[1] } : null; }
function publicProfile(u) {
  const s = u.stats;
  return { name: u.name, key: u.key, created: u.created, badges: u.badges, daily: u.daily,
    stats: { games: s.games, total: Object.values(s.games).reduce((a, b) => a + b, 0), wins: s.wins, names: s.names,
      bestDaily: s.bestDaily, bestDefi: s.bestDefi, bestAbc: s.bestAbc, topPlayer: top(s.players), topLetter: top(s.letters),
      letterCount: Object.keys(s.letters || {}).length } };
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
  defi10: (u) => u.stats.bestDefi >= 10, defi20: (u) => u.stats.bestDefi >= 20,
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
  abc: (a, b) => a.t - b.t || a.s - b.s || a.d - b.d,
};
const entryKey = (kind, key, u) => "entry/" + kind + "/" + key + "/" + u;
async function entryPut(st, kind, key, e) {
  const k = entryKey(kind, key, e.u), cur = await getJSON(st, k);
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
  return [...best.values()].sort(CMP[kind]).slice(0, 100);
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

/* ---------- vérification des réponses ---------- */
// Vérifie chaque réponse. Les noms hors base sont recherchés sur Wikidata avec un budget de temps :
// si le serveur n'obtient pas de réponse nette (réseau lent, limite de requêtes), on garde le verdict
// du site, seul un refus net (mauvaise lettre, doublon) annule un nom.
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r({ st: "none", off: 1 }), ms))]);
async function validateSeq(items, letterOf) {
  const used = new Set(), remote = new Map(), unknown = [];
  items.forEach((it, i) => { if (checkLocal(String(it.v || "").slice(0, 60), letterOf(it, i), new Set()).st === "unknown") unknown.push(i); });
  const deadline = Date.now() + 6500; let next = 0;
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
    return json({ ok: true, blobs, version: 9, time: Date.now() });
  }

  if (path === "register") {
    const name = cleanName(body.name), pass = String(body.pass || "");
    if (!validName(name)) return fail("bad_name");
    if (pass.length < 4 || pass.length > 64) return fail("bad_pass");
    const key = userKey(name);
    if (await getJSON(st, "user/" + key)) return fail("taken", 409);
    const u = newUser(name); u.salt = crypto.randomBytes(16).toString("hex"); u.hash = hashPass(pass, u.salt);
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
    if (kind === "defi") return json(key ? { list: /^[a-z]$/.test(key) ? await boardRead(st, "defi", key) : [] } : { map: await defiMap(st) });
    if (kind === "daily" && /^\d{4}-\d{2}-\d{2}$/.test(key)) return json({ list: await boardRead(st, "daily", key) });
    if (kind === "abc") return json({ list: await boardRead(st, "abc", "all") });
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
    const users = (await Promise.all(keys.map((k) => getJSON(st, k)))).filter(Boolean).map(fixUser);
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
      newWeek: rows.filter((r) => now - r.created < 7 * DAY).length, games: sum((r) => r.games), names: sum((r) => r.names),
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
    if (run.used && Date.now() - run.used < 20000) return json({ error: "busy" }, 503);
    run.used = Date.now(); await putJSON(st, "run/" + id, run);
    const now = Date.now(), elapsed = now - run.t0;
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
      if (ok) { u.stats.bestDefi = Math.max(u.stats.bestDefi, run.b); entry = { u: u.key, n: u.name, s: run.b, t: elapsed, d: now }; }
    } else {
      const okTime = elapsed <= ALL_LETTERS.length * PER + 30000;
      const items = answers.filter((a) => !a.joker && a.L).slice(0, 26);
      const jokers = answers.filter((a) => a.joker).length;
      const res = okTime ? await validateSeq(items, (it) => String(it.L).toUpperCase()) : [];
      oks = res.filter((r) => r.ok);
      const covered = new Set([...oks.map((o) => o.L.toLowerCase()), ...answers.filter((a) => a.joker).map((a) => String(a.L).toLowerCase())]);
      ok = okTime && jokers <= 3 && ALL_LETTERS.every((l) => covered.has(l));
      const t = elapsed + jokers * ABC_PEN; key = "all";
      if (ok) { u.stats.bestAbc = u.stats.bestAbc ? Math.min(u.stats.bestAbc, t) : t; if (jokers === 0) u.stats.abcClean = true; entry = { u: u.key, n: u.name, s: jokers, t, d: now }; }
    }
    u.stats.games[run.m]++;
    countNames(u, oks);
    const newBadges = award(u);
    await saveUser(st, u);
    if (entry) await entryPut(st, run.m, key, entry);
    const list = entry ? await boardRead(st, run.m, key) : null;
    const result = { ok, score: oks.length, valid: oks.map((o) => o.display), entry, list, newBadges, profile: publicProfile(u) };
    run.result = { ok, score: oks.length, valid: result.valid, entry, newBadges: [], profile: result.profile };
    await putJSON(st, "run/" + id, run);
    return json(result);
  }

  if (path === "match") {
    const mid = String(body.mid || "").replace(/[^a-z0-9]/gi, "").slice(0, 16);
    if (mid) { const k = "match/" + mid + "/" + u.key; if (await getJSON(st, k)) return json({ newBadges: [], profile: publicProfile(u) }); await putJSON(st, k, { t: Date.now() }); }
    const names = Array.isArray(body.names) ? body.names.slice(0, 200).map((n) => titleCase(String(n).slice(0, 40))) : [];
    u.stats.games.friends++;
    if (body.won === true) u.stats.wins++;
    names.forEach((n) => { u.stats.names++; u.stats.players[n] = (u.stats.players[n] || 0) + 1; });
    if (Array.isArray(body.letters)) body.letters.slice(0, 10).forEach((l) => { l = String(l).toLowerCase(); if (/^[a-z]$/.test(l)) u.stats.letters[l] = (u.stats.letters[l] || 0) + 1; });
    const newBadges = award(u);
    await saveUser(st, u);
    return json({ newBadges, profile: publicProfile(u) });
  }
  return fail("not_found", 404);
}

export default async (req) => {
  const path = new URL(req.url).pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  try { return await route(req, path, store()); }
  catch (e) { console.error(e); return fail("server", 500); }
};
