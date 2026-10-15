/* Acceso a Postgres compartido por todas las funciones de /api.

   Entidades: people (equipo y cuentas), clients (con su sede), weeks (semanas
   con su cargabilidad) y budget_days (horas asignadas por cliente, persona y
   DÍA). La tabla budget (por semana) se conserva solo como origen de la
   migración a días; nada la lee después.

   Tres motores, una sola interfaz (sql`select ... ${valor}` devuelve filas):
   - Postgres propio (servidor Ubuntu, Docker): DATABASE_URL=postgres://... con el
     paquete `pg`.
   - Neon (Vercel): si DATABASE_URL apunta a *.neon.tech se usa su driver HTTP.
   - PGlite (desarrollo local sin base): server.js --dev activa USE_PGLITE=1 y
     los datos quedan en la carpeta .pglite/.

   Los archivos y carpetas que empiezan por "_" no los publica Vercel como
   funciones: este módulo solo se importa desde las que sí lo son. */

const path = require('path');
const fs = require('fs');

const calendario = require('./calendario.js');

const ROLES = ['gerente', 'senior', 'junior'];
const SEDES = ['Barranquilla', 'Santa Marta'];
const CAPACIDAD_SEMANAL = 42;
const PHASES = ['previas', 'planeacion', 'ejecucion', 'cierre', 'informe', 'vacaciones', 'compensatorio', 'especiales'];

const MISSING_DB_MESSAGE =
  'Falta la variable de entorno DATABASE_URL (postgres://usuario:clave@host:5432/base).';

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

/* ---------- Postgres propio con `pg` ---------- */

let pgSql = null;

function getPgSql(cs) {
  if (pgSql) return pgSql;
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: cs, max: 5 });
  pool.on('error', function (err) { console.error('pg pool:', err.message); });
  pgSql = async function (strings, ...values) {
    let text = '';
    strings.forEach(function (s, i) {
      text += s;
      if (i < values.length) text += '$' + (i + 1);
    });
    const params = values.map(function (v) { return v === undefined ? null : v; });
    const r = await pool.query(text, params);
    return r.rows;
  };
  return pgSql;
}

/* ---------- selección del motor ---------- */

let neonSql = null;

function isNeon(cs) {
  const driver = (process.env.DB_DRIVER || '').toLowerCase();
  if (driver === 'neon') return true;
  if (driver === 'pg') return false;
  return /neon\.tech/.test(cs);
}

function getSql() {
  const cs = connectionString();
  if (cs) {
    if (isNeon(cs)) {
      if (!neonSql) {
        const { neon } = require('@neondatabase/serverless');
        neonSql = neon(cs);
      }
      return neonSql;
    }
    return getPgSql(cs);
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
  await sql`alter table clients add column if not exists sede text`;
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
    create table if not exists budget_days (
      id        serial primary key,
      client_id integer not null references clients(id) on delete cascade,
      person_id integer not null references people(id) on delete cascade,
      day       date not null,
      hours     double precision,
      phase     text,
      note      text,
      unique (client_id, person_id, day)
    )`;
  await sql`create index if not exists ix_budget_days_person_day on budget_days (person_id, day)`;
  await sql`
    create table if not exists meta (
      key   text primary key,
      value text
    )`;

  // Comparar nombres sin acentos ni dobles espacios (p. ej. "Pérez" = "Perez").
  await sql`
    create or replace function unaccent_simple(t text) returns text
    language sql immutable as $$
      select trim(regexp_replace(translate(coalesce(t, ''), 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '\\s+', ' ', 'g'))
    $$`;

  await migrateWeeklyToDays(sql);
  schemaReady = true;
}

/* ---------- semanas y días ---------- */

function isoDate(d) {
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
function parseDate(s) {
  const p = String(s).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
}
function addDays(iso, n) {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

/* Días hábiles (lunes a viernes, sin festivos) de la semana que empieza en `weekStart`. */
function workingDays(weekStart) {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const iso = addDays(weekStart, i);
    if (!calendario.esFestivo(parseDate(iso))) out.push(iso);
  }
  if (!out.length) for (let i = 0; i < 5; i++) out.push(addDays(weekStart, i));
  return out;
}

/* Reparte `total` horas entre `n` días en partes iguales (dos decimales);
   el último día absorbe el redondeo para que la suma sea exacta. */
function splitHours(total, n) {
  if (!n) return [];
  const each = Math.round((total / n) * 100) / 100;
  const out = [];
  let acc = 0;
  for (let i = 0; i < n - 1; i++) { out.push(each); acc += each; }
  out.push(Math.round((total - acc) * 100) / 100);
  return out;
}

/* Una celda semanal (cliente, persona, semana) convertida en celdas por día. */
function weekCellToDays(weekStart, hours, phase, note) {
  const days = workingDays(weekStart);
  if (hours == null) {
    // Semana marcada sin horas (p. ej. vacaciones): se marcan los días hábiles.
    return phase || note ? days.map(function (d) { return { day: d, hours: null, phase: phase || null, note: note || null }; }) : [];
  }
  const parts = splitHours(Number(hours), days.length);
  return days.map(function (d, i) { return { day: d, hours: parts[i], phase: phase || null, note: note || null }; });
}

/* Migración única: las celdas por semana que ya existían se convierten en
   días hábiles de esa semana con las horas repartidas. Después, todas las
   semanas quedan con la cargabilidad de 42 h. */
async function migrateWeeklyToDays(sql) {
  const done = await sql`select value from meta where key = 'budget_days_migrated'`;
  if (done.length) return;
  const rows = await sql`
    select b.client_id, b.person_id, b.hours, b.phase, b.note, to_char(w.week_start, 'YYYY-MM-DD') as week_start
      from budget b join weeks w on w.idx = b.week_idx`;
  for (const r of rows) {
    for (const d of weekCellToDays(r.week_start, r.hours, r.phase, r.note)) {
      await sql`
        insert into budget_days (client_id, person_id, day, hours, phase, note)
        values (${r.client_id}, ${r.person_id}, ${d.day}, ${d.hours}, ${d.phase}, ${d.note})
        on conflict (client_id, person_id, day) do nothing`;
    }
  }
  await sql`update weeks set capacity = ${CAPACIDAD_SEMANAL}`;
  await sql`insert into meta (key, value) values ('budget_days_migrated', ${new Date().toISOString()}) on conflict (key) do nothing`;
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
      values (${w.index}, ${w.start}, ${w.label}, ${w.month}, ${CAPACIDAD_SEMANAL})
      on conflict (idx) do update
        set week_start = excluded.week_start, label = excluded.label, month = excluded.month`;
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

  const weekStart = {};
  data.weeks.forEach(function (w) { weekStart[w.index] = w.start; });
  for (const b of data.budget) {
    const cid = clientIds[b.client];
    const pid = personIds[b.person];
    const ws = weekStart[b.week];
    if (!cid || !pid || !ws) continue;
    for (const d of weekCellToDays(ws, b.hours == null ? null : Number(b.hours), b.phase || null, null)) {
      await sql`
        insert into budget_days (client_id, person_id, day, hours, phase, note)
        values (${cid}, ${pid}, ${d.day}, ${d.hours}, ${d.phase}, ${d.note})
        on conflict (client_id, person_id, day) do update
          set hours = excluded.hours, phase = excluded.phase`;
    }
    created.budget++;
  }
  // El archivo ya fue aplicado: la migración desde la tabla semanal no debe repetirlo.
  await sql`insert into meta (key, value) values ('budget_days_migrated', ${new Date().toISOString()}) on conflict (key) do nothing`;
  return created;
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
  SEDES,
  CAPACIDAD_SEMANAL,
  PHASES,
  isoDate,
  parseDate,
  addDays,
  workingDays,
  splitHours,
  MISSING_DB_MESSAGE,
  connectionString,
  getSql,
  ensureSchema,
  loadBudgetFile,
  seedBudget,
  readBody,
  queryOf,
  str,
  numOrNull,
  dateOrNull,
  fail
};
