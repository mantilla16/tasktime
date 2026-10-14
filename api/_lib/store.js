/* Acceso a Postgres compartido por todas las funciones de /api.

   En producción (Vercel) se usa Neon a través de DATABASE_URL. Para trabajar en
   el computador sin base remota, dev-server.js activa USE_PGLITE=1 y entonces se
   usa PGlite: un Postgres embebido que guarda los datos en la carpeta .pglite/.
   Ambos se consumen con la misma función etiquetada: sql`select ... ${valor}`.

   Los archivos y carpetas que empiezan por "_" no los publica Vercel como
   funciones: este módulo solo se importa desde las que sí lo son. */

const path = require('path');
const fs = require('fs');

const ROLES = ['gerente', 'senior', 'junior'];
const PHASES = ['previas', 'planeacion', 'ejecucion', 'cierre', 'informe', 'vacaciones', 'compensatorio', 'especiales'];
const STATUSES = ['pendiente', 'en_progreso', 'en_revision', 'terminada'];
const PRIORITIES = ['alta', 'media', 'baja'];

const MISSING_DB_MESSAGE =
  'Falta la variable de entorno DATABASE_URL. Conecta la base de Neon en Vercel (Storage) y vuelve a desplegar.';

// La integración Neon de Vercel inyecta DATABASE_URL; aceptamos alias por si acaso.
function connectionString() {
  return process.env.DATABASE_URL
    || process.env.POSTGRES_URL
    || process.env.NEON_DATABASE_URL
    || process.env.DATABASE_URL_UNPOOLED
    || '';
}

/* ---------- PGlite (solo desarrollo local) ---------- */

let pglitePromise = null;
let pgliteSql = null;

function getPgliteSql() {
  if (pgliteSql) return pgliteSql;
  pglitePromise = (async function () {
    // Nombre en variable: así Vercel no intenta empaquetar PGlite (solo es para desarrollo).
    const moduleName = '@electric-sql/pglite';
    const { PGlite } = require(moduleName);
    const dir = process.env.PGLITE_DATA_DIR || path.join(process.cwd(), '.pglite');
    const db = new PGlite(dir);
    await db.waitReady;
    return db;
  })();
  pgliteSql = async function (strings, ...values) {
    const db = await pglitePromise;
    let text = '';
    strings.forEach(function (s, i) {
      text += s;
      if (i < values.length) text += '$' + (i + 1);
    });
    const params = values.map(function (v) { return v === undefined ? null : v; });
    const r = await db.query(text, params);
    return r.rows;
  };
  return pgliteSql;
}

/* ---------- selección del motor ---------- */

let neonSql = null;

function getSql() {
  const cs = connectionString();
  if (cs) {
    if (!neonSql) {
      const { neon } = require('@neondatabase/serverless');
      neonSql = neon(cs);
    }
    return neonSql;
  }
  if (process.env.USE_PGLITE === '1') return getPgliteSql();
  return null;
}

/* ---------- esquema ---------- */

let schemaReady = false;

async function ensureSchema(sql) {
  if (schemaReady) return;

  await sql`
    create table if not exists people (
      id                   serial primary key,
      name                 text not null,
      email                text unique,
      role                 text not null,
      password_hash        text,
      must_change_password boolean not null default false,
      active               boolean not null default true,
      created_at           timestamptz not null default now()
    )`;
  await sql`
    create table if not exists sessions (
      token_hash text primary key,
      person_id  integer not null references people(id) on delete cascade,
      created_at timestamptz not null default now(),
      expires_at timestamptz not null
    )`;
  await sql`
    create table if not exists clients (
      id     serial primary key,
      name   text not null unique,
      active boolean not null default true
    )`;
  await sql`
    create table if not exists weeks (
      idx        integer primary key,
      week_start date not null unique,
      label      text not null,
      month      text not null,
      capacity   double precision not null default 0
    )`;
  await sql`
    create table if not exists budget (
      id        serial primary key,
      client_id integer not null references clients(id) on delete cascade,
      person_id integer not null references people(id) on delete cascade,
      week_idx  integer not null references weeks(idx),
      hours     double precision,
      phase     text,
      note      text,
      unique (client_id, person_id, week_idx)
    )`;
  await sql`
    create table if not exists tasks (
      id           serial primary key,
      title        text not null,
      description  text not null default '',
      client_id    integer references clients(id) on delete set null,
      phase        text,
      assignee_id  integer references people(id) on delete set null,
      created_by   integer references people(id) on delete set null,
      status       text not null default 'pendiente',
      priority     text not null default 'media',
      start_date   date,
      due_date     date,
      hours_budget double precision,
      hours_spent  double precision not null default 0,
      created_at   timestamptz not null default now(),
      updated_at   timestamptz not null default now(),
      completed_at timestamptz,
      notified_at  timestamptz
    )`;
  await sql`
    create table if not exists task_comments (
      id         serial primary key,
      task_id    integer not null references tasks(id) on delete cascade,
      person_id  integer references people(id) on delete set null,
      body       text not null,
      created_at timestamptz not null default now()
    )`;

  /* Cuenta de Google que envía las notificaciones. Una sola fila (id = 1): el
     equipo comparte un único remitente. El refresh_token NUNCA sale de aquí
     hacia el navegador — solo se usa dentro de las funciones de /api. */
  await sql`
    create table if not exists mail_sender (
      id            integer primary key,
      email         text        not null,
      name          text,
      refresh_token text        not null,
      connected_at  timestamptz not null default now(),
      last_error    text
    )`;

  schemaReady = true;
}

/* ---------- datos base: el presupuesto de horas del Excel ---------- */

function loadBudgetFile() {
  // Relativo a este archivo (api/_lib) para que Vercel incluya el JSON en la función.
  const file = path.join(__dirname, '..', '..', 'data', 'presupuesto-2026.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/* Carga semanas, clientes, funcionarios y celdas del presupuesto. Es
   idempotente: lo que ya existe se actualiza, lo que falta se crea, y nunca
   toca contraseñas, correos ni roles de personas ya registradas. */
async function seedBudget(sql, data) {
  data = data || loadBudgetFile();
  let created = { weeks: 0, clients: 0, people: 0, budget: 0 };

  for (const w of data.weeks) {
    await sql`
      insert into weeks (idx, week_start, label, month, capacity)
      values (${w.index}, ${w.start}, ${w.label}, ${w.month}, ${Number(w.capacity) || 0})
      on conflict (idx) do update
        set week_start = excluded.week_start, label = excluded.label,
            month = excluded.month, capacity = excluded.capacity`;
    created.weeks++;
  }

  const clientIds = {};
  for (const name of data.clients) {
    const rows = await sql`
      insert into clients (name) values (${name})
      on conflict (name) do update set name = excluded.name
      returning id`;
    clientIds[name] = rows[0].id;
    created.clients++;
  }

  const personIds = {};
  for (const p of data.people) {
    const existing = await sql`select id from people where lower(name) = lower(${p.name}) limit 1`;
    if (existing.length) {
      personIds[p.name] = existing[0].id;
    } else {
      const rows = await sql`
        insert into people (name, role) values (${p.name}, ${ROLES.includes(p.role) ? p.role : 'junior'})
        returning id`;
      personIds[p.name] = rows[0].id;
      created.people++;
    }
  }

  for (const b of data.budget) {
    const cid = clientIds[b.client];
    const pid = personIds[b.person];
    if (!cid || !pid) continue;
    await sql`
      insert into budget (client_id, person_id, week_idx, hours, phase)
      values (${cid}, ${pid}, ${b.week}, ${b.hours == null ? null : Number(b.hours)}, ${b.phase || null})
      on conflict (client_id, person_id, week_idx) do update
        set hours = excluded.hours, phase = excluded.phase`;
    created.budget++;
  }
  return created;
}

/* ---------- remitente de correo (sin cambios de fondo) ---------- */

async function readSender(sql) {
  const rows = await sql`
    select email, name, refresh_token, connected_at, last_error
      from mail_sender where id = 1`;
  return rows[0] || null;
}

async function saveSender(sql, { email, name, refreshToken }) {
  await sql`
    insert into mail_sender (id, email, name, refresh_token, connected_at, last_error)
    values (1, ${email}, ${name || null}, ${refreshToken}, now(), null)
    on conflict (id) do update
       set email = excluded.email,
           name = excluded.name,
           refresh_token = excluded.refresh_token,
           connected_at = now(),
           last_error = null`;
}

async function setSenderError(sql, message) {
  await sql`update mail_sender set last_error = ${message} where id = 1`;
}

async function clearSenderError(sql) {
  await sql`update mail_sender set last_error = null where id = 1`;
}

async function deleteSender(sql) {
  await sql`delete from mail_sender where id = 1`;
}

/* ---------- utilidades comunes a los handlers ---------- */

function readBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  return body && typeof body === 'object' ? body : null;
}

function queryOf(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try {
    const u = new URL(req.url, 'http://local');
    return Object.fromEntries(u.searchParams.entries());
  } catch (e) {
    return {};
  }
}

function str(v, max) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return max ? s.slice(0, max) : s;
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dateOrNull(v) {
  const s = str(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function fail(res, status, error, extra) {
  return res.status(status).json(Object.assign({ error: error }, extra || {}));
}

module.exports = {
  ROLES,
  PHASES,
  STATUSES,
  PRIORITIES,
  MISSING_DB_MESSAGE,
  connectionString,
  getSql,
  ensureSchema,
  loadBudgetFile,
  seedBudget,
  readSender,
  saveSender,
  setSenderError,
  clearSenderError,
  deleteSender,
  readBody,
  queryOf,
  str,
  numOrNull,
  dateOrNull,
  fail
};
