const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");
const Database = require("better-sqlite3");

const db = new Database(process.env.DB_PATH || "bavardage.db");
db.exec(`
create table if not exists users(id integer primary key autoincrement, email text unique, phone text unique, pv integer default 0, name text, created integer);
create table if not exists codes(email text primary key, hash text, exp integer, tries integer default 0, last integer);
create table if not exists sessions(token text primary key, user_id integer, created integer);
create table if not exists messages(id integer primary key autoincrement, from_id integer, to_id integer, text text, ts integer);
create index if not exists mi on messages(from_id, to_id, ts);
`);

const h = (code, email) => crypto.createHash("sha256").update(code + ":" + email).digest("hex");
const pub = (u, self) => ({ id: u.id, phone: u.phone, name: u.name, verified: !!u.pv, email: self ? u.email : undefined });
const userById = (id) => db.prepare("select * from users where id=?").get(id);

// --- Envoi du code par e-mail (Brevo). Sans clé : le code s'affiche dans la console (mode test).
async function sendMail(to, code) {
  if (!process.env.BREVO_API_KEY) { console.log(`[TEST] Code pour ${to} : ${code}`); return; }
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      sender: { name: "Bavardage", email: process.env.MAIL_FROM },
      to: [{ email: to }],
      subject: "Votre code Bavardage : " + code,
      htmlContent: `<p>Votre code de vérification :</p><p style="font-size:28px"><b>${code}</b></p><p>Il expire dans 10 minutes.</p>`
    })
  });
  if (!r.ok) throw new Error("Brevo " + r.status + " " + (await r.text()));
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "10kb" }));
// Projet « à plat » : seuls ces fichiers sont publics (le reste, comme la base de données, ne l'est jamais).
const path = require("path");
const PUBLIC = ["index.html", "download.html", "manifest.webmanifest", "sw.js", "icon-192.png", "icon-512.png", "bavardage.apk"];
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/:f", (req, res, next) => PUBLIC.includes(req.params.f) ? res.sendFile(path.join(__dirname, req.params.f)) : next());

// Limite simple par IP : 20 demandes de code par heure
const hits = new Map();
function limited(ip) {
  const now = Date.now(), a = (hits.get(ip) || []).filter((t) => now - t < 3600000);
  a.push(now); hits.set(ip, a); return a.length > 20;
}

const normPhone = (v) => String(v || "").replace(/[\s.\-()]/g, "");
const TW = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SID;

// --- SMS via Twilio Verify : Twilio génère, envoie et contrôle le code.
async function twilio(path, params) {
  const r = await fetch(`https://verify.twilio.com/v2/Services/${process.env.TWILIO_VERIFY_SID}/${path}`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(process.env.TWILIO_ACCOUNT_SID + ":" + process.env.TWILIO_AUTH_TOKEN).toString("base64"),
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(params)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Twilio " + r.status + " " + (j.message || ""));
  return j;
}

function target(body) {
  if (body.phone) {
    const p = normPhone(body.phone);
    return /^\+\d{9,15}$/.test(p) ? { kind: "phone", v: p } : null;
  }
  const e = String(body.email || "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? { kind: "email", v: e } : null;
}

app.post("/api/request-code", async (req, res) => {
  const t = target(req.body);
  if (!t) return res.status(400).json({ error: req.body.phone ? "Numéro invalide. Format : +33612345678." : "Adresse e-mail invalide." });
  if (limited(req.ip)) return res.status(429).json({ error: "Trop de demandes. Réessayez plus tard." });
  const c = db.prepare("select last from codes where email=?").get(t.v);
  if (c && Date.now() - c.last < 30000) return res.status(429).json({ error: "Patientez 30 secondes avant de redemander un code." });
  const now = Date.now();
  try {
    if (t.kind === "phone" && TW) {
      await twilio("Verifications", { To: t.v, Channel: "sms" });
      db.prepare(`insert into codes(email,hash,exp,tries,last) values(?,?,?,0,?)
        on conflict(email) do update set exp=excluded.exp, tries=0, last=excluded.last`).run(t.v, "twilio", now + 600000, now);
    } else {
      const code = String(crypto.randomInt(100000, 1000000));
      db.prepare(`insert into codes(email,hash,exp,tries,last) values(?,?,?,0,?)
        on conflict(email) do update set hash=excluded.hash, exp=excluded.exp, tries=0, last=excluded.last`)
        .run(t.v, h(code, t.v), now + 600000, now);
      if (t.kind === "email") await sendMail(t.v, code);
      else console.log(`[TEST SMS] Code pour ${t.v} : ${code}`);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: "Envoi impossible. Vérifiez la saisie et réessayez." });
  }
});

app.post("/api/verify", async (req, res) => {
  const t = target(req.body), code = String(req.body.code || "").trim();
  if (!t) return res.status(400).json({ error: "Saisie invalide." });
  const c = db.prepare("select * from codes where email=?").get(t.v);
  if (!c || c.exp < Date.now()) return res.status(400).json({ error: "Code expiré. Demandez-en un nouveau." });
  if (c.tries >= 5) return res.status(429).json({ error: "Trop d’essais. Demandez un nouveau code." });
  let ok;
  try {
    ok = t.kind === "phone" && TW
      ? (await twilio("VerificationCheck", { To: t.v, Code: code })).status === "approved"
      : c.hash === h(code, t.v);
  } catch (e) { return res.status(400).json({ error: "Code expiré. Demandez-en un nouveau." }); }
  if (!ok) {
    db.prepare("update codes set tries=tries+1 where email=?").run(t.v);
    return res.status(400).json({ error: "Code incorrect." });
  }
  db.prepare("delete from codes where email=?").run(t.v);
  let u;
  if (t.kind === "email") {
    u = db.prepare("select * from users where email=?").get(t.v)
      || userById(db.prepare("insert into users(email,created) values(?,?)").run(t.v, Date.now()).lastInsertRowid);
  } else {
    u = db.prepare("select * from users where phone=? and pv=1").get(t.v);
    if (!u) {
      // Le numéro vient d'être prouvé par SMS : il l'emporte sur une déclaration non vérifiée.
      db.prepare("update users set phone=null, pv=0 where phone=?").run(t.v);
      u = userById(db.prepare("insert into users(phone,pv,created) values(?,1,?)").run(t.v, Date.now()).lastInsertRowid);
    }
  }
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("insert into sessions values(?,?,?)").run(token, u.id, Date.now());
  res.json({ token, user: pub(u, true) });
});

function userFromToken(t) {
  const s = t && db.prepare("select user_id from sessions where token=?").get(t);
  return s ? userById(s.user_id) : null;
}
function auth(req, res, next) {
  const t = (req.headers.authorization || "").replace("Bearer ", "");
  const u = userFromToken(t);
  if (!u) return res.status(401).json({ error: "Session expirée." });
  req.user = u; req.token = t; next();
}

app.get("/api/me", auth, (req, res) => res.json(pub(req.user, true)));

app.post("/api/logout", auth, (req, res) => {
  db.prepare("delete from sessions where token=?").run(req.token); res.json({ ok: true });
});

app.post("/api/profile", auth, (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 40);
  if (req.user.pv) {  // numéro déjà vérifié par SMS : on ne change que le prénom
    db.prepare("update users set name=? where id=?").run(name, req.user.id);
    return res.json(pub(userById(req.user.id), true));
  }
  const phone = normPhone(req.body.phone);
  if (!/^\+\d{9,15}$/.test(phone)) return res.status(400).json({ error: "Format attendu : +33612345678 (avec l’indicatif)." });
  try { db.prepare("update users set phone=?, name=? where id=?").run(phone, name, req.user.id); }
  catch (e) { return res.status(409).json({ error: "Ce numéro est déjà utilisé." }); }
  res.json(pub(userById(req.user.id), true));
});

app.get("/api/find", auth, (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const u = q.includes("@")
    ? db.prepare("select * from users where email=? and phone is not null").get(q)
    : db.prepare("select * from users where phone=?").get(normPhone(q));
  if (!u) return res.status(404).json({ error: "Personne n’est inscrit avec ce numéro ou cet e-mail." });
  if (u.id === req.user.id) return res.status(400).json({ error: "C’est vous !" });
  res.json(pub(u));
});

app.get("/api/chats", auth, (req, res) => {
  const me = req.user.id;
  res.json(db.prepare(`
    select u.id, u.phone, u.name, m.text, m.ts, m.from_id from messages m
    join users u on u.id = (case when m.from_id=? then m.to_id else m.from_id end)
    where m.id in (select max(id) from messages where from_id=? or to_id=?
                   group by case when from_id=? then to_id else from_id end)
    order by m.ts desc`).all(me, me, me, me));
});

app.get("/api/messages/:id", auth, (req, res) => {
  const me = req.user.id, o = +req.params.id;
  const rows = db.prepare(`select id, from_id "from", to_id "to", text, ts from messages
    where (from_id=? and to_id=?) or (from_id=? and to_id=?) order by id desc limit 200`).all(me, o, o, me);
  res.json(rows.reverse());
});

const server = http.createServer(app);
const io = new Server(server);
io.use((socket, next) => {
  const u = userFromToken(socket.handshake.auth && socket.handshake.auth.token);
  if (!u || !u.phone) return next(new Error("auth"));
  socket.user = u; next();
});
io.on("connection", (socket) => {
  const me = socket.user.id;
  socket.join("u" + me);
  socket.on("send", (d, ack) => {
    const to = +(d && d.to), text = String((d && d.text) || "").trim().slice(0, 2000);
    if (!text || !to || to === me || !userById(to)) return ack && ack({ ok: false });
    const ts = Date.now();
    const id = db.prepare("insert into messages(from_id,to_id,text,ts) values(?,?,?,?)").run(me, to, text, ts).lastInsertRowid;
    io.to("u" + to).to("u" + me).emit("msg", { id, from: me, to, text, ts });
    ack && ack({ ok: true });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Bavardage sur http://localhost:" + PORT));
