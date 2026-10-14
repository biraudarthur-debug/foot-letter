// API FOOT LETTER : comptes, parties vérifiées, classements, profils, badges.
// Tourne en fonction Netlify ; les données sont gardées dans Netlify Blobs.
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import { norm, titleCase, checkLocal, resolveRemote, DRAW_LETTERS, ALL_LETTERS, parisDate, dailyLetter } from "../lib/game.mjs";

export const config = { path: "/api/*" };

// Seule l'empreinte du code administrateur est ici ; le code lui-même n'est jamais publié.
const ADMIN_HASH = "c76e68b02e609ff7a876ca4494004f82c95ce464f96248aa15aac152315ebdd5";
const PER = 30000, DAILY_MS = 180000, ABC_PEN = 15000;
const store = () => getStore({ name: "footletter", consistency: "strong" });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (code, status = 400) => json({ error: code }, status);
const getJSON = async (st, key) => (await st.get(key, { type: "json" })) || null;
const putJSON = (st, key, val) => st.setJSON(key, val);

/* ---------- signatures (jetons de session et de partie) ---------- */
let SECRET = null;
async function secret(st) {
  if (SECRET) return SECRET;
  if (process.env.FL_SECRET) return (SECRET = process.env.FL_SECRET);
  let m = await getJSON(st, "meta/secret");
  if (!m) { m = { k: crypto.randomBytes(32).toString("hex") }; await putJSON(st, "meta/secret", m); }
  return (SECRET = m.k);
}
async function sign(st, obj) {
  const body = Buffer.from(JSON.stringify(obj)).toString("base64url");
  const sig = crypto.createHmac("sha256", await secret(st)).update(body).digest("base64url");
  return body + "." + sig;
}
async function verify(st, tok) {
  if (typeof tok !== "string") return null;
  const [body, sig] = tok.split(".");
  if (!body || !sig) return null;
  const exp = crypto.createHmac("sha256", await secret(st)).update(body).digest("base64url");
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString()); } catch (_) { return null; }
}

/* ---------- comptes ---------- */
const userKey = (name) => norm(name).replace(/ /g, "_");
const cleanName = (n) => String(n || "").replace(/\s+/g, " ").trim();
const validName = (n) => /^[\p{L}\p{N} _.\-]{2,18}$/u.test(n) && userKey(n).length >= 2;
const hashPass = (pass, salt) => crypto.scryptSync(String(pass), salt, 32).toString("hex");
function newUser(name) {
  return { key: userKey(name), name, created: Date.now(),
    stats: { games: { daily: 0, defi: 0, abc: 0, friends: 0 }, wins: 0, names: 0, bestDaily: 0, bestDefi: 0, bestAbc: 0, letters: {}, players: {} },
    badges: {}, daily: { last: null, streak: 0, best: 0 }, done: {}, runs: [] };
}
function top(obj) { const e = Object.entries(obj || {}).sort((a, b) => b[1] - a[1])[0]; return e ? { k: e[0], n: e[1] } : null; }
function publicProfile(u) {
  const s = u.stats;
  return { name: u.name, key: u.key, created: u.created, badges: u.badges, daily: u.daily,
    stats: { games: s.games, total: Object.values(s.games).reduce((a, b) => a + b, 0), wins: s.wins, names: s.names,
      bestDaily: s.bestDaily, bestDefi: s.bestDefi, bestAbc: s.bestAbc, topPlayer: top(s.players), topLetter: top(s.letters),
      letterCount: Object.keys(s.letters || {}).length } };
}
async function authUser(req, st) {
  const h = req.headers.get("authorization") || "";
  const d = await verify(st, h.startsWith("Bearer ") ? h.slice(7) : null);
  if (!d || d.t !== "s" || !d.u) return null;
  return await getJSON(st, "user/" + d.u);
}
async function saveUser(st, u) {
  const p = u.stats.players; const ks = Object.keys(p);
  if (ks.length > 300) ks.sort((a, b) => p[a] - p[b]).slice(0, ks.length - 300).forEach((k) => delete p[k]);
  const days = Object.keys(u.done).sort(); if (days.length > 60) days.slice(0, days.length - 60).forEach((k) => delete u.done[k]);
  if (u.runs.length > 30) u.runs = u.runs.slice(-30);
  await putJSON(st, "user/" + u.key, u);
}

/* ---------- classements ---------- */
const CMP = {
  daily: (a, b) => b.s - a.s || a.t - b.t || a.d - b.d,
  defi: (a, b) => b.s - a.s || a.t - b.t || a.d - b.d,
  abc: (a, b) => a.t - b.t || a.s - b.s || a.d - b.d,
};
function mergeEntry(kind, list, e) {
  const cur = list.find((x) => x.u === e.u);
  if (cur && CMP[kind](cur, e) <= 0) return list;
  return [...list.filter((x) => x.u !== e.u), e].sort(CMP[kind]).slice(0, 100);
}
async function boardAdd(st, kind, key, e) {
  if (kind === "defi") { const m = (await getJSON(st, "board/defi")) || {}; m[key] = mergeEntry(kind, m[key] || [], e); await putJSON(st, "board/defi", m); return m[key]; }
  const k = "board/" + kind + "/" + key; const list = mergeEntry(kind, (await getJSON(st, k)) || [], e); await putJSON(st, k, list); return list;
}

/* ---------- vérification des réponses ---------- */
async function validateSeq(items, letterOf) {
  const used = new Set(), remote = new Map();
  const unknown = [];
  items.forEach((it, i) => { if (checkLocal(String(it.v || "").slice(0, 60), letterOf(it, i), new Set()).st === "unknown") unknown.push(i); });
  await Promise.all(unknown.slice(0, 25).map(async (i) => { remote.set(i, await resolveRemote(String(items[i].v).slice(0, 60), letterOf(items[i], i), new Set()).catch(() => ({ st: "none" }))); }));
  return items.map((it, i) => {
    const L = letterOf(it, i), txt = String(it.v || "").slice(0, 60);
    let r = checkLocal(txt, L, used);
    if (r.st === "unknown") { const rr = remote.get(i); r = rr && rr.st === "ok" && !rr.keys.some((k) => used.has(k)) ? rr : { st: "bad" }; }
    if (r.st === "ok") { r.keys.forEach((k) => used.add(k)); return { ok: true, display: r.display, L, ms: +it.ms || 0 }; }
    return { ok: false };
  });
}

/* ---------- badges ---------- */
function award(u, ctx) {
  const s = u.stats, nb = [];
  const give = (id) => { if (!u.badges[id]) { u.badges[id] = Date.now(); nb.push(id); } };
  give("kickoff");
  if (ctx.mode === "daily") { if (ctx.inMinute >= 10) give("ten_minute"); if (ctx.score >= 20) give("daily20"); }
  if (u.daily.streak >= 3) give("streak3"); if (u.daily.streak >= 7) give("streak7"); if (u.daily.streak >= 30) give("streak30");
  if (ctx.mode === "defi" && ctx.ok) { if (ctx.bet >= 10) give("defi10"); if (ctx.bet >= 20) give("defi20"); }
  if (ctx.mode === "abc" && ctx.ok) { if (ctx.jokers === 0) give("abc_clean"); if (ctx.t < 180000) give("abc_fast"); }
  if (s.wins >= 1) give("win1"); if (s.wins >= 10) give("win10");
  if (s.names >= 100) give("century"); if (s.names >= 500) give("legend");
  if (Object.keys(s.letters).length >= 20) give("polyglot");
  return nb;
}
function countNames(u, oks) {
  oks.forEach((a) => { u.stats.names++; const l = a.L.toLowerCase(); u.stats.letters[l] = (u.stats.letters[l] || 0) + 1; u.stats.players[a.display] = (u.stats.players[a.display] || 0) + 1; });
}
const yesterday = (date) => parisDate(new Date(Date.parse(date + "T12:00:00Z") - 86400000));

/* ---------- routes ---------- */
async function route(req, path, st) {
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const url = new URL(req.url);

  if (path === "health") return json({ ok: true, time: Date.now() });

  if (path === "register") {
    const name = cleanName(body.name), pass = String(body.pass || "");
    if (!validName(name)) return fail("bad_name");
    if (pass.length < 4 || pass.length > 64) return fail("bad_pass");
    const key = userKey(name);
    if (await getJSON(st, "user/" + key)) return fail("taken", 409);
    const u = newUser(name); u.salt = crypto.randomBytes(16).toString("hex"); u.hash = hashPass(pass, u.salt);
    u.seen = Date.now();
    await saveUser(st, u);
    return json({ token: await sign(st, { t: "s", u: key, i: Date.now() }), profile: publicProfile(u) });
  }
  if (path === "login") {
    const u = await getJSON(st, "user/" + userKey(cleanName(body.name)));
    if (!u || !u.hash) return fail("bad_login", 401);
    const h = hashPass(String(body.pass || ""), u.salt);
    if (!crypto.timingSafeEqual(Buffer.from(h), Buffer.from(u.hash))) return fail("bad_login", 401);
    return json({ token: await sign(st, { t: "s", u: u.key, i: Date.now() }), profile: publicProfile(u) });
  }
  if (path === "profile") {
    const u = await getJSON(st, "user/" + userKey(url.searchParams.get("u") || ""));
    return u ? json({ profile: publicProfile(u) }) : fail("not_found", 404);
  }
  if (path === "board") {
    const kind = url.searchParams.get("kind"), key = String(url.searchParams.get("key") || "");
    if (kind === "defi") { const m = (await getJSON(st, "board/defi")) || {}; return json(key ? { list: m[key] || [] } : { map: m }); }
    if (kind === "daily" && /^\d{4}-\d{2}-\d{2}$/.test(key)) return json({ list: (await getJSON(st, "board/daily/" + key)) || [] });
    if (kind === "abc") return json({ list: (await getJSON(st, "board/abc/all")) || [] });
    return fail("bad_board");
  }

  const u = await authUser(req, st);
  if (!u) return fail("auth", 401);
  const today = parisDate();

  if (path === "me") {
    const now = Date.now();
    if (!u.seen || now - u.seen > 3600000) { u.seen = now; await saveUser(st, u); }
    return json({ profile: publicProfile(u), today: u.done[today] || null, date: today, admin: !!u.admin });
  }

  if (path === "admin/claim") {
    const h = crypto.createHash("sha256").update(String(body.code || "").trim().toUpperCase()).digest("hex");
    if (h !== ADMIN_HASH) return fail("bad_code", 403);
    u.admin = true; await saveUser(st, u);
    return json({ admin: true });
  }
  if (path === "admin/stats") {
    if (!u.admin) return fail("forbidden", 403);
    const { blobs } = await st.list({ prefix: "user/" });
    const users = (await Promise.all(blobs.slice(0, 1000).map((b) => getJSON(st, b.key)))).filter(Boolean);
    const now = Date.now(), DAY = 86400000;
    const rows = users.map((x) => {
      const g = x.stats.games;
      return { name: x.name, created: x.created, seen: x.seen || x.created, games: Object.values(g).reduce((a, b) => a + b, 0), byMode: g,
        wins: x.stats.wins, names: x.stats.names, streak: x.daily.streak, bestStreak: x.daily.best, badges: Object.keys(x.badges || {}).length, admin: !!x.admin };
    }).sort((a, b) => b.seen - a.seen);
    const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
    return json({ total: rows.length, today: rows.filter((r) => now - r.seen < DAY).length, week: rows.filter((r) => now - r.seen < 7 * DAY).length,
      newWeek: rows.filter((r) => now - r.created < 7 * DAY).length, games: sum((r) => r.games), names: sum((r) => r.names),
      dailyToday: users.filter((x) => x.done && x.done[today]).length, rows });
  }

  if (path === "run/start") {
    const mode = body.mode, now = Date.now(), id = crypto.randomBytes(6).toString("hex");
    let run, letter = null;
    if (mode === "daily") {
      if (u.done[today]) return fail("already", 409);
      letter = dailyLetter(today);
      u.done[today] = { st: 1 }; await saveUser(st, u);
      run = { t: "r", m: "daily", u: u.key, d: today, L: letter, t0: now, id };
    } else if (mode === "defi") {
      const l = String(body.letter || "").toLowerCase(), bet = Math.round(+body.bet);
      if (!DRAW_LETTERS.includes(l) || !(bet >= 1 && bet <= 99)) return fail("bad_run");
      letter = l.toUpperCase(); run = { t: "r", m: "defi", u: u.key, L: letter, b: bet, t0: now, id };
    } else if (mode === "abc") {
      run = { t: "r", m: "abc", u: u.key, t0: now, id };
    } else return fail("bad_run");
    return json({ run: await sign(st, run), letter });
  }

  if (path === "run/finish") {
    const run = await verify(st, body.run);
    if (!run || run.t !== "r" || run.u !== u.key) return fail("bad_run");
    if (u.runs.includes(run.id)) return fail("used", 409);
    u.runs.push(run.id);
    const now = Date.now(), elapsed = now - run.t0;
    const answers = Array.isArray(body.answers) ? body.answers.slice(0, 120) : [];
    let entry = null, key, ctx = { mode: run.m }, oks = [];

    if (run.m === "daily") {
      const items = answers.filter((a) => (+a.ms || 0) <= DAILY_MS + 2000);
      const res = elapsed <= DAILY_MS + 60000 ? await validateSeq(items, () => run.L) : [];
      oks = res.filter((r) => r.ok);
      const score = oks.length, t = Math.min(Math.max(0, ...oks.map((o) => o.ms)), elapsed);
      key = run.d; ctx.score = score; ctx.inMinute = oks.filter((o) => o.ms <= 60000).length;
      u.done[run.d] = { s: score };
      if (u.daily.last !== run.d) { u.daily.streak = u.daily.last === yesterday(run.d) ? u.daily.streak + 1 : 1; u.daily.last = run.d; u.daily.best = Math.max(u.daily.best, u.daily.streak); }
      u.stats.bestDaily = Math.max(u.stats.bestDaily, score);
      entry = { u: u.key, n: u.name, s: score, t, d: now };
    } else if (run.m === "defi") {
      const okTime = elapsed <= run.b * PER + 20000;
      const res = okTime ? await validateSeq(answers.slice(0, run.b + 5), () => run.L) : [];
      oks = res.filter((r) => r.ok);
      ctx.ok = oks.length >= run.b; ctx.bet = run.b; key = run.L.toLowerCase();
      if (ctx.ok) { u.stats.bestDefi = Math.max(u.stats.bestDefi, run.b); entry = { u: u.key, n: u.name, s: run.b, t: elapsed, d: now }; }
    } else {
      const okTime = elapsed <= ALL_LETTERS.length * PER + 20000;
      const items = answers.filter((a) => !a.joker && a.L).slice(0, 26);
      const jokers = answers.filter((a) => a.joker).length;
      const res = okTime ? await validateSeq(items, (it) => String(it.L).toUpperCase()) : [];
      oks = res.filter((r) => r.ok);
      const covered = new Set([...oks.map((o) => o.L.toLowerCase()), ...answers.filter((a) => a.joker).map((a) => String(a.L).toLowerCase())]);
      ctx.ok = okTime && jokers <= 3 && ALL_LETTERS.every((l) => covered.has(l)); ctx.jokers = jokers;
      const t = elapsed + jokers * ABC_PEN; ctx.t = t; key = "all";
      if (ctx.ok) { u.stats.bestAbc = u.stats.bestAbc ? Math.min(u.stats.bestAbc, t) : t; entry = { u: u.key, n: u.name, s: jokers, t, d: now }; }
    }
    u.stats.games[run.m]++;
    countNames(u, oks);
    const newBadges = award(u, ctx);
    await saveUser(st, u);
    const list = entry ? await boardAdd(st, run.m, key, entry) : null;
    return json({ ok: ctx.ok !== false, score: oks.length, valid: oks.map((o) => o.display), entry, list, newBadges, profile: publicProfile(u) });
  }

  if (path === "match") {
    const now = Date.now();
    if (u.lastMatch && now - u.lastMatch < 15000) return fail("too_soon", 429);
    u.lastMatch = now;
    const names = Array.isArray(body.names) ? body.names.slice(0, 200).map((n) => titleCase(String(n).slice(0, 40))) : [];
    u.stats.games.friends++;
    if (body.won === true) u.stats.wins++;
    names.forEach((n) => { u.stats.names++; u.stats.players[n] = (u.stats.players[n] || 0) + 1; });
    if (Array.isArray(body.letters)) body.letters.slice(0, 10).forEach((l) => { l = String(l).toLowerCase(); if (/^[a-z]$/.test(l)) u.stats.letters[l] = (u.stats.letters[l] || 0) + 1; });
    const newBadges = award(u, { mode: "friends" });
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
