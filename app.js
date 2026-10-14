"use strict";
/* =========================================================================
   Russell — gestión de tareas y presupuesto de horas del equipo.

   Roles:
     gerente  ve todo, asigna tareas, administra personas, clientes, correo.
     senior   ve todo el equipo, crea y asigna tareas, edita el presupuesto.
     junior   solo ve sus tareas y su presupuesto; registra avances y horas.

   La visibilidad la impone el servidor (api/*.js); aquí solo se decide qué
   pantallas mostrar. Todo el estado vive en S; la interfaz se vuelve a
   dibujar con render() tras cada cambio.
   ========================================================================= */

const S = {
  user: null, setupRequired: false, mailConfigured: false,
  people: [], clients: [], tasks: [], weeks: [], budget: [], mail: null, loaded: false
};
const UI = {
  view: null,
  taskMode: 'kanban',
  filters: { assignee: 'all', client: 'all', phase: 'all', priority: 'all', status: 'all' },
  search: '',
  modal: null,
  budgetFilter: { person: 'all', client: 'all' },
  extraRows: [],
  busy: false,
  authError: null
};

const STATUS_DEFS = [
  { id: 'pendiente',   label: 'Pendiente',   color: 'var(--ink-faint)' },
  { id: 'en_progreso', label: 'En progreso', color: 'var(--cat-1)' },
  { id: 'en_revision', label: 'En revisión', color: 'var(--warning)' },
  { id: 'terminada',   label: 'Terminada',   color: 'var(--good)' }
];
const PRIORITY_DEFS = [
  { id: 'alta',  label: 'Alta',  cls: 'prio-alta' },
  { id: 'media', label: 'Media', cls: 'prio-media' },
  { id: 'baja',  label: 'Baja',  cls: 'prio-baja' }
];
const PHASE_DEFS = [
  { id: 'previas',       label: 'Actividades previas' },
  { id: 'planeacion',    label: 'Planeación' },
  { id: 'ejecucion',     label: 'Ejecución' },
  { id: 'cierre',        label: 'Cierre' },
  { id: 'informe',       label: 'Informe mensual' },
  { id: 'vacaciones',    label: 'Vacaciones' },
  { id: 'compensatorio', label: 'Compensatorio' },
  { id: 'especiales',    label: 'Proyectos especiales' }
];
const ROLE_LABELS = { gerente: 'Gerente', senior: 'Senior', junior: 'Junior' };
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const ICON = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  panel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  team: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.6"/><path d="M16 15.5a5 5 0 0 1 5.5 4.5"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/></svg>',
  client: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-5h6v5"/><path d="M9 10h.01M15 10h.01M9 14h.01M15 14h.01"/></svg>',
  person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/></svg>',
  kanban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="5" height="13" rx="1"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M15 8l3 3M18 5l3 3"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17l5-5-5-5M15 12H3"/><path d="M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2.5 17.5A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h10M4 17h7"/><path d="M17 15l2 2 4-4"/></svg>'
};

/* ============================ utilidades ============================ */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function fmtDate(iso) {
  if (!iso) return '';
  const p = String(iso).slice(0, 10).split('-');
  if (p.length !== 3) return iso;
  return parseInt(p[2], 10) + ' ' + (MONTHS_ES[parseInt(p[1], 10) - 1] || p[1]) + ' ' + p[0];
}
function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.getDate() + ' ' + MONTHS_ES[d.getMonth()] + ' ' + d.getFullYear() + ', ' +
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function fmtH(n) {
  if (n == null || isNaN(n)) return '';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}
function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function isOverdue(t) { return t.dueDate && t.status !== 'terminada' && t.dueDate < todayISO(); }
function isManager() { return S.user && (S.user.role === 'gerente' || S.user.role === 'senior'); }
function isGerente() { return S.user && S.user.role === 'gerente'; }
function personById(id) { return S.people.find(function (p) { return p.id === id; }) || null; }
function clientById(id) { return S.clients.find(function (c) { return c.id === id; }) || null; }
function taskById(id) { return S.tasks.find(function (t) { return t.id === id; }) || null; }
function statusDef(id) { return STATUS_DEFS.find(function (s) { return s.id === id; }) || STATUS_DEFS[0]; }
function priorityDef(id) { return PRIORITY_DEFS.find(function (p) { return p.id === id; }) || PRIORITY_DEFS[1]; }
function phaseLabel(id) { const d = PHASE_DEFS.find(function (p) { return p.id === id; }); return d ? d.label : ''; }
function roleOrder(r) { return r === 'gerente' ? 0 : r === 'senior' ? 1 : 2; }
function activePeople() {
  return S.people.filter(function (p) { return p.active !== false; })
    .sort(function (a, b) { return roleOrder(a.role) - roleOrder(b.role) || a.name.localeCompare(b.name); });
}
function currentWeekIdx() {
  const t = todayISO();
  let cur = null;
  S.weeks.forEach(function (w) { if (w.start <= t) cur = w; });
  if (!cur || t >= addDays(cur.start, 7)) return -1;
  return cur.idx;
}
function weekByIdx(i) { return S.weeks.find(function (w) { return w.idx === i; }) || null; }
function budgetMap() {
  const m = {};
  S.budget.forEach(function (r) { m[r.clientId + '|' + r.personId + '|' + r.weekIdx] = r; });
  return m;
}
function randomPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out.slice(0, 4) + '-' + out.slice(4, 8) + '-' + out.slice(8, 12);
}

function toast(msg, kind) {
  const stack = document.getElementById('toast-stack');
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'err' ? ' err' : kind === 'ok' ? ' ok' : '');
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(function () { el.remove(); }, kind === 'err' ? 6000 : 3600);
}

/* ============================ API ============================ */

async function api(method, url, body) {
  const r = await fetch(url, {
    method: method,
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await r.json(); } catch (e) { payload = null; }
  if (r.status === 401 && S.user) {
    S.user = null; S.loaded = false; UI.modal = null;
    render();
    throw new Error('Tu sesión terminó. Vuelve a iniciar sesión.');
  }
  if (!r.ok) {
    const err = new Error((payload && payload.error) || ('Error HTTP ' + r.status));
    err.status = r.status;
    err.code = payload && payload.code;
    throw err;
  }
  return payload;
}

async function loadAll() {
  const results = await Promise.all([
    api('GET', '/api/people'), api('GET', '/api/clients'), api('GET', '/api/tasks'), api('GET', '/api/budget')
  ]);
  S.people = results[0].people;
  S.clients = results[1].clients;
  S.tasks = results[2].tasks;
  S.weeks = results[3].weeks;
  S.budget = results[3].rows;
  S.mail = null;
  if (isManager()) {
    try { S.mail = await api('GET', '/api/mail'); } catch (e) { S.mail = null; }
  }
  S.loaded = true;
}

async function reloadTasks() {
  const r = await api('GET', '/api/tasks');
  S.tasks = r.tasks;
}

async function boot() {
  try {
    const a = await api('GET', '/api/auth');
    S.setupRequired = a.setupRequired;
    S.user = a.user;
    S.mailConfigured = a.mailConfigured;
    if (S.user) await loadAll();
  } catch (err) {
    UI.authError = err.message;
  }
  handleOAuthReturn();
  if (S.user && S.user.mustChangePassword) UI.modal = { type: 'password', forced: true };
  render();
}

function handleOAuthReturn() {
  const params = new URLSearchParams(location.search);
  if (!params.has('correo')) return;
  const status = params.get('correo');
  const reasons = {
    access_denied: 'cancelaste la autorización en Google.',
    respuesta_incompleta: 'Google no devolvió el código de autorización.',
    state_invalido: 'la verificación de seguridad del flujo falló. Inténtalo de nuevo.',
    sin_base_de_datos: 'falta la conexión con la base de datos.',
    sin_correo: 'Google no entregó el correo de la cuenta.',
    sin_refresh_token: 'Google no entregó un permiso permanente. Retira el acceso en myaccount.google.com/permissions y vuelve a conectar.',
    sin_permiso_envio: 'no se otorgó el permiso de envío. Marca la casilla de "enviar correo en tu nombre".',
    sin_permiso: 'solo el gerente puede conectar la cuenta de correo.',
    redirect_uri_mismatch: 'la URI de redirección no coincide con la registrada en Google Cloud.',
    fallo_al_canjear: 'no se pudo canjear el código de Google.'
  };
  if (status === 'conectado') {
    toast('Cuenta de Google conectada: ' + (params.get('cuenta') || ''), 'ok');
  } else {
    const motivo = params.get('motivo') || '';
    toast('No se conectó la cuenta: ' + (reasons[motivo] || motivo), 'err');
  }
  if (S.user) UI.view = 'ajustes';
  history.replaceState(null, '', location.pathname + '#/ajustes');
}

/* ============================ navegación ============================ */

function navItems() {
  if (!S.user) return [];
  if (isManager()) {
    const items = [
      { id: 'panel', label: 'Panel', icon: ICON.panel },
      { id: 'tareas', label: 'Tareas', icon: ICON.tasks, count: S.tasks.filter(function (t) { return t.status !== 'terminada'; }).length },
      { id: 'equipo', label: 'Equipo', icon: ICON.team },
      { id: 'presupuesto', label: 'Presupuesto', icon: ICON.grid },
      { id: 'clientes', label: 'Clientes', icon: ICON.client }
    ];
    if (isGerente()) items.push({ id: 'personas', label: 'Personas', icon: ICON.person });
    items.push({ id: 'ajustes', label: 'Ajustes', icon: ICON.settings });
    return items;
  }
  return [
    { id: 'mistareas', label: 'Mis tareas', icon: ICON.tasks, count: S.tasks.filter(function (t) { return t.status !== 'terminada'; }).length },
    { id: 'misemana', label: 'Mi semana', icon: ICON.grid },
    { id: 'ajustes', label: 'Ajustes', icon: ICON.settings }
  ];
}

function defaultView() { return isManager() ? 'panel' : 'mistareas'; }

function setView(id) {
  const allowed = navItems().some(function (n) { return n.id === id; });
  UI.view = allowed ? id : defaultView();
  if (location.hash !== '#/' + UI.view) history.replaceState(null, '', location.pathname + '#/' + UI.view);
  render();
  const body = document.querySelector('.view-body');
  if (body) body.scrollTop = 0;
}

window.addEventListener('hashchange', function () {
  const id = location.hash.replace(/^#\/?/, '');
  if (S.user && id && id !== UI.view) setView(id);
});

/* ============================ render raíz ============================ */

function render() {
  const root = document.getElementById('root');
  if (!S.user) {
    root.innerHTML = S.setupRequired ? renderSetup() : renderLogin();
    const first = root.querySelector('input');
    if (first && !UI.busy) first.focus();
    return;
  }
  if (!UI.view) {
    const fromHash = location.hash.replace(/^#\/?/, '');
    UI.view = navItems().some(function (n) { return n.id === fromHash; }) ? fromHash : defaultView();
  }
  root.innerHTML = renderRail() + '<div class="main">' + renderView() + '</div>' + renderModal();
}

/* ============================ acceso ============================ */

function brandHtml() {
  return '<div class="brand"><div class="brand-mark">' + ICON.logo + '</div>' +
    '<div><div class="brand-name">Russell</div><div class="brand-sub">Tareas y horas del equipo</div></div></div>';
}

function renderLogin() {
  return '<div class="auth-wrap"><div class="auth-card">' + brandHtml() +
    '<h1>Iniciar sesión</h1><p class="lead">Entra con el correo y la contraseña que te entregó el gerente.</p>' +
    (UI.authError ? '<div class="auth-error">' + esc(UI.authError) + '</div>' : '') +
    '<form id="form-login">' +
    '<div class="form-row"><label class="field-label" for="login-email">Correo</label><input id="login-email" type="email" name="email" autocomplete="username" required></div>' +
    '<div class="form-row"><label class="field-label" for="login-password">Contraseña</label><input id="login-password" type="password" name="password" autocomplete="current-password" required></div>' +
    '<button class="btn btn-accent" type="submit"' + (UI.busy ? ' disabled' : '') + '>' + (UI.busy ? 'Entrando…' : 'Entrar') + '</button>' +
    '</form>' +
    '<p class="auth-foot">¿Olvidaste tu contraseña? Pídele al gerente que te asigne una nueva desde Personas.</p>' +
    '</div></div>';
}

function renderSetup() {
  return '<div class="auth-wrap"><div class="auth-card">' + brandHtml() +
    '<h1>Primera configuración</h1><p class="lead">Aún no hay cuentas. Crea la cuenta del gerente para empezar; después podrás dar acceso al resto del equipo.</p>' +
    (UI.authError ? '<div class="auth-error">' + esc(UI.authError) + '</div>' : '') +
    '<form id="form-setup">' +
    '<div class="form-row"><label class="field-label" for="setup-name">Nombre</label><input id="setup-name" type="text" name="name" required maxlength="120"></div>' +
    '<div class="form-row"><label class="field-label" for="setup-email">Correo</label><input id="setup-email" type="email" name="email" autocomplete="username" required></div>' +
    '<div class="form-row"><label class="field-label" for="setup-password">Contraseña (mínimo 8 caracteres)</label><input id="setup-password" type="password" name="password" autocomplete="new-password" minlength="8" required></div>' +
    '<div class="form-row"><label class="checkbox-row"><input type="checkbox" name="seed" checked> Cargar el presupuesto de horas 2026 (clientes, equipo y semanas del Excel)</label></div>' +
    '<button class="btn btn-accent" type="submit"' + (UI.busy ? ' disabled' : '') + '>' + (UI.busy ? 'Creando…' : 'Crear cuenta de gerente') + '</button>' +
    '</form></div></div>';
}

/* ============================ shell ============================ */

function renderRail() {
  const items = navItems().map(function (n) {
    return '<button class="nav-item' + (UI.view === n.id ? ' active' : '') + '" data-act="nav" data-view="' + n.id + '">' +
      n.icon + '<span>' + esc(n.label) + '</span>' +
      (n.count ? '<span class="nav-count">' + n.count + '</span>' : '') + '</button>';
  }).join('');
  const newBtn = isManager()
    ? '<button class="btn-new" data-act="new-task">' + ICON.plus + '<span>Nueva tarea</span></button>'
    : '';
  const mailBadge = isManager() && S.mail
    ? '<div class="rail-badge"><span class="dot' + (S.mail.connected && !S.mail.lastError ? '' : ' off') + '"></span>' +
      (S.mail.connected ? (S.mail.lastError ? 'Correo: requiere atención' : 'Correo conectado') : 'Correo sin conectar') + '</div>'
    : '';
  return '<aside class="rail">' + brandHtml() + newBtn + '<nav class="rail-nav">' + items + '</nav>' +
    '<div class="rail-foot">' + mailBadge +
    '<div class="rail-user"><div class="avatar">' + esc(initials(S.user.name)) + '</div>' +
    '<div class="rail-user-info"><div class="rail-user-name" title="' + esc(S.user.email || '') + '">' + esc(S.user.name) + '</div>' +
    '<div class="rail-user-role">' + esc(ROLE_LABELS[S.user.role] || S.user.role) + '</div></div>' +
    '<button class="icon-btn" data-act="logout" title="Cerrar sesión">' + ICON.logout + '</button></div>' +
    '</div></aside>';
}

function topbar(title, sub, actionsHtml) {
  return '<div class="topbar"><div><h1>' + esc(title) + '</h1>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>' +
    '<div class="topbar-actions">' + (actionsHtml || '') + '</div></div>';
}

function renderView() {
  switch (UI.view) {
    case 'panel': return renderPanel();
    case 'tareas': return renderTasks(false);
    case 'mistareas': return renderTasks(true);
    case 'equipo': return renderTeam();
    case 'presupuesto': return renderBudget(false);
    case 'misemana': return renderBudget(true);
    case 'clientes': return renderClients();
    case 'personas': return renderPeople();
    case 'ajustes': return renderSettings();
    default: return '';
  }
}

/* ============================ Panel ============================ */

function renderPanel() {
  const today = todayISO();
  const open = S.tasks.filter(function (t) { return t.status !== 'terminada'; });
  const overdue = open.filter(isOverdue);
  const review = open.filter(function (t) { return t.status === 'en_revision'; });
  const unassigned = open.filter(function (t) { return !t.assigneeId; });
  const doneWeek = S.tasks.filter(function (t) { return t.status === 'terminada' && t.completedAt && String(t.completedAt).slice(0, 10) >= addDays(today, -7); });
  const cur = currentWeekIdx();
  const week = weekByIdx(cur);

  const tiles = [
    { label: 'Tareas abiertas', value: open.length, status: 'all' },
    { label: 'Vencidas', value: overdue.length, crit: overdue.length > 0, status: 'vencidas' },
    { label: 'En revisión', value: review.length, status: 'en_revision' },
    { label: 'Sin asignar', value: unassigned.length, status: 'sin_asignar' },
    { label: 'Terminadas (7 días)', value: doneWeek.length, status: 'terminada' }
  ].map(function (t) {
    return '<div class="stat-tile" data-act="panel-filter" data-status="' + t.status + '"><div class="stat-label">' + t.label + '</div>' +
      '<div class="stat-value' + (t.crit ? ' crit' : '') + '">' + t.value + '</div></div>';
  }).join('');

  // Carga de la semana actual: horas presupuestadas por persona frente a la cargabilidad.
  const people = activePeople().filter(function (p) { return p.role !== 'gerente' || S.budget.some(function (r) { return r.personId === p.id; }); });
  let loadHtml;
  if (!week) {
    loadHtml = '<p class="muted small">Hoy está fuera del periodo presupuestado (' + fmtDate(S.weeks[0] ? S.weeks[0].start : '') + ' a ' + fmtDate(S.weeks.length ? addDays(S.weeks[S.weeks.length - 1].start, 5) : '') + ').</p>';
  } else {
    loadHtml = people.map(function (p) {
      const rows = S.budget.filter(function (r) { return r.personId === p.id && r.weekIdx === cur; });
      const hours = rows.reduce(function (a, r) { return a + (r.hours || 0); }, 0);
      const vac = rows.some(function (r) { return r.phase === 'vacaciones'; });
      const pct = week.capacity ? Math.min(100, Math.round(hours / week.capacity * 100)) : 0;
      const over = week.capacity && hours > week.capacity;
      const openCount = open.filter(function (t) { return t.assigneeId === p.id; }).length;
      return '<div class="bar-row" data-act="goto-person" data-id="' + p.id + '" style="cursor:pointer" title="' + openCount + ' tareas abiertas">' +
        '<div class="bar-label">' + esc(p.name) + '</div>' +
        '<div class="bar-track"><div class="bar-fill' + (over ? ' over' : '') + '" style="width:' + pct + '%"></div></div>' +
        '<div class="bar-value">' + (vac && !hours ? 'Vac.' : fmtH(hours) + ' / ' + fmtH(week.capacity) + ' h') + '</div></div>';
    }).join('') || '<p class="muted small">No hay personas con presupuesto.</p>';
  }

  // Próximas a vencer (y vencidas).
  const upcoming = open.filter(function (t) { return t.dueDate; })
    .sort(function (a, b) { return a.dueDate.localeCompare(b.dueDate); })
    .filter(function (t) { return t.dueDate <= addDays(today, 14); })
    .slice(0, 10);
  const upcomingHtml = upcoming.length ? upcoming.map(function (t) {
    return '<div class="upcoming-row" data-act="open-task" data-id="' + t.id + '">' +
      '<div class="upcoming-date' + (isOverdue(t) ? ' overdue' : '') + '">' + fmtDate(t.dueDate) + '</div>' +
      '<div style="min-width:0;flex:1"><div class="card-title">' + esc(t.title) + '</div>' +
      '<div class="small muted">' + esc(t.assigneeName || 'Sin asignar') + (t.clientName ? ' · ' + esc(t.clientName) : '') + '</div></div>' +
      '<span class="chip ' + priorityDef(t.priority).cls + '">' + priorityDef(t.priority).label + '</span></div>';
  }).join('') : '<p class="muted small">Nada vence en los próximos 14 días.</p>';

  // Tareas abiertas por persona.
  const maxOpen = Math.max(1, Math.max.apply(null, people.map(function (p) { return open.filter(function (t) { return t.assigneeId === p.id; }).length; }).concat([0])));
  const byPerson = people.map(function (p) {
    const n = open.filter(function (t) { return t.assigneeId === p.id; }).length;
    const od = open.filter(function (t) { return t.assigneeId === p.id && isOverdue(t); }).length;
    return '<div class="bar-row" data-act="goto-person" data-id="' + p.id + '" style="cursor:pointer"><div class="bar-label">' + esc(p.name) + '</div>' +
      '<div class="bar-track"><div class="bar-fill' + (od ? ' over' : '') + '" style="width:' + Math.round(n / maxOpen * 100) + '%"></div></div>' +
      '<div class="bar-value">' + n + (od ? ' (' + od + ' venc.)' : '') + '</div></div>';
  }).join('');

  return topbar('Panel', week ? 'Semana ' + esc(week.label.toLowerCase()) + ' de ' + esc(week.month.toLowerCase()) + ' · cargabilidad ' + fmtH(week.capacity) + ' h' : 'Resumen del equipo') +
    '<div class="view-body"><div class="stat-grid">' + tiles + '</div>' +
    '<div class="panel-grid">' +
    '<div style="display:flex;flex-direction:column;gap:16px">' +
    '<div class="chart-card"><h3>Carga de esta semana</h3><div class="hint">Horas presupuestadas por persona frente a la cargabilidad de la semana.</div>' + loadHtml + '</div>' +
    '<div class="chart-card"><h3>Tareas abiertas por persona</h3><div class="hint">En rojo cuando alguna está vencida.</div>' + (byPerson || '<p class="muted small">Sin personas.</p>') + '</div>' +
    '</div>' +
    '<div class="chart-card"><h3>Próximas a vencer</h3><div class="hint">Tareas abiertas con fecha límite en los próximos 14 días.</div>' + upcomingHtml + '</div>' +
    '</div></div>';
}

/* ============================ Tareas ============================ */

function filteredTasks() {
  const f = UI.filters;
  const q = UI.search.trim().toLowerCase();
  return S.tasks.filter(function (t) {
    if (f.assignee !== 'all') {
      if (f.assignee === 'none' ? t.assigneeId : String(t.assigneeId) !== f.assignee) return false;
    }
    if (f.client !== 'all' && String(t.clientId) !== f.client) return false;
    if (f.phase !== 'all' && (t.phase || '') !== f.phase) return false;
    if (f.priority !== 'all' && t.priority !== f.priority) return false;
    if (f.status === 'vencidas') { if (!isOverdue(t)) return false; }
    else if (f.status === 'sin_asignar') { if (t.assigneeId || t.status === 'terminada') return false; }
    else if (f.status !== 'all' && t.status !== f.status) return false;
    if (q) {
      const hay = (t.title + ' ' + t.description + ' ' + (t.clientName || '') + ' ' + (t.assigneeName || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

function selectHtml(name, value, options, allLabel) {
  return '<select data-filter="' + name + '">' +
    (allLabel ? '<option value="all"' + (value === 'all' ? ' selected' : '') + '>' + esc(allLabel) + '</option>' : '') +
    options.map(function (o) { return '<option value="' + esc(o.value) + '"' + (String(value) === String(o.value) ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') +
    '</select>';
}

function renderTasks(mine) {
  const f = UI.filters;
  const list = filteredTasks();
  const hasFilter = Object.keys(f).some(function (k) { return f[k] !== 'all'; }) || UI.search;

  const filters = '<div class="filters-row">' +
    (mine ? '' : selectHtml('assignee', f.assignee, activePeople().map(function (p) { return { value: p.id, label: p.name }; }).concat([{ value: 'none', label: 'Sin asignar' }]), 'Todas las personas')) +
    selectHtml('client', f.client, S.clients.filter(function (c) { return c.active !== false; }).map(function (c) { return { value: c.id, label: c.name }; }), 'Todos los clientes') +
    selectHtml('phase', f.phase, PHASE_DEFS.map(function (p) { return { value: p.id, label: p.label }; }), 'Todas las fases') +
    selectHtml('priority', f.priority, PRIORITY_DEFS.map(function (p) { return { value: p.id, label: p.label }; }), 'Toda prioridad') +
    (UI.taskMode === 'list' ? selectHtml('status', f.status, STATUS_DEFS.map(function (s) { return { value: s.id, label: s.label }; }).concat([{ value: 'vencidas', label: 'Vencidas' }]), 'Todo estado') : '') +
    (hasFilter ? '<button class="filters-clear" data-act="clear-filters">Limpiar filtros</button>' : '') +
    '</div>';

  const toggle = '<div class="view-toggle">' +
    '<button class="' + (UI.taskMode === 'kanban' ? 'active' : '') + '" data-act="task-mode" data-mode="kanban">' + ICON.kanban + 'Tablero</button>' +
    '<button class="' + (UI.taskMode === 'list' ? 'active' : '') + '" data-act="task-mode" data-mode="list">' + ICON.list + 'Lista</button></div>';
  const search = '<div class="search-wrap">' + ICON.search + '<input type="search" placeholder="Buscar tarea…" value="' + esc(UI.search) + '" data-search></div>';

  let body;
  if (!S.tasks.length) {
    body = '<div class="empty-state">' + ICON.tasks + '<h3>' + (mine ? 'No tienes tareas asignadas' : 'Todavía no hay tareas') + '</h3>' +
      '<p>' + (mine ? 'Cuando un senior o el gerente te asigne una, aparecerá aquí y recibirás un aviso por correo.' : 'Crea la primera tarea y asígnala a alguien del equipo.') + '</p>' +
      (mine ? '' : '<button class="btn-new" data-act="new-task">' + ICON.plus + '<span>Nueva tarea</span></button>') + '</div>';
  } else if (UI.taskMode === 'kanban') {
    body = renderKanban(list);
  } else {
    body = renderTaskTable(list, mine);
  }

  return topbar(mine ? 'Mis tareas' : 'Tareas', mine ? 'Solo ves las tareas asignadas a ti. Arrastra para cambiar el estado.' : list.length + ' de ' + S.tasks.length + ' tareas', search + toggle) +
    '<div class="view-body">' + filters + body + '</div>';
}

function renderKanban(list) {
  const cols = STATUS_DEFS.map(function (s) {
    const items = list.filter(function (t) { return t.status === s.id; })
      .sort(function (a, b) { return (a.dueDate || '9999').localeCompare(b.dueDate || '9999'); });
    return '<div class="col"><div class="col-head"><span class="col-dot" style="background:' + s.color + '"></span>' +
      '<span class="col-name">' + s.label + '</span><span class="col-count">' + items.length + '</span></div>' +
      '<div class="col-cards" data-status="' + s.id + '">' +
      (items.length ? items.map(renderCard).join('') : '<div class="col-empty">Sin tareas</div>') +
      '</div></div>';
  }).join('');
  return '<div class="board">' + cols + '</div>';
}

function renderCard(t) {
  const pr = priorityDef(t.priority);
  const assignee = t.assigneeId
    ? '<div class="assignee"><div class="avatar">' + esc(initials(t.assigneeName)) + '</div>' + esc(t.assigneeName) + '</div>'
    : '<div class="assignee unassigned">Sin asignar</div>';
  return '<div class="card" draggable="true" data-act="open-task" data-id="' + t.id + '">' +
    '<div class="card-row">' + (t.clientName ? '<span class="chip chip-client" title="' + esc(t.clientName) + '">' + esc(t.clientName) + '</span>' : '') +
    (t.phase ? '<span class="chip ph-' + t.phase + '">' + esc(phaseLabel(t.phase)) + '</span>' : '') + '</div>' +
    '<div class="card-title">' + esc(t.title) + '</div>' +
    '<div class="card-meta">' +
    (t.dueDate ? '<span class="item due' + (isOverdue(t) ? ' overdue' : '') + '">' + ICON.calendar + fmtDate(t.dueDate) + '</span>' : '') +
    (t.hoursBudget != null ? '<span class="item">' + ICON.clock + fmtH(t.hoursSpent) + '/' + fmtH(t.hoursBudget) + ' h</span>' : (t.hoursSpent ? '<span class="item">' + ICON.clock + fmtH(t.hoursSpent) + ' h</span>' : '')) +
    (t.commentsCount ? '<span class="item">' + ICON.comment + t.commentsCount + '</span>' : '') +
    '</div>' +
    '<div class="card-foot">' + assignee + '<span class="chip ' + pr.cls + '">' + pr.label + '</span></div></div>';
}

function renderTaskTable(list, mine) {
  const sorted = list.slice().sort(function (a, b) {
    const sa = a.status === 'terminada' ? 1 : 0, sb = b.status === 'terminada' ? 1 : 0;
    return sa - sb || (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
  });
  const rows = sorted.map(function (t) {
    const pr = priorityDef(t.priority);
    return '<tr class="clickable" data-act="open-task" data-id="' + t.id + '">' +
      '<td><div class="card-title">' + esc(t.title) + '</div>' + (t.phase ? '<span class="chip ph-' + t.phase + '" style="margin-top:4px">' + esc(phaseLabel(t.phase)) + '</span>' : '') + '</td>' +
      '<td>' + esc(t.clientName || '—') + '</td>' +
      (mine ? '' : '<td>' + (t.assigneeName ? '<div class="assignee"><div class="avatar">' + esc(initials(t.assigneeName)) + '</div>' + esc(t.assigneeName) + '</div>' : '<span class="muted">Sin asignar</span>') + '</td>') +
      '<td><span class="status-pill">' + statusDef(t.status).label + '</span></td>' +
      '<td><span class="chip ' + pr.cls + '">' + pr.label + '</span></td>' +
      '<td class="' + (isOverdue(t) ? 'due overdue' : '') + '">' + (t.dueDate ? fmtDate(t.dueDate) : '—') + '</td>' +
      '<td class="num">' + fmtH(t.hoursSpent) + (t.hoursBudget != null ? ' / ' + fmtH(t.hoursBudget) : '') + '</td>' +
      '</tr>';
  }).join('');
  return '<div class="table-wrap"><table class="data"><thead><tr><th>Tarea</th><th>Cliente</th>' + (mine ? '' : '<th>Asignada a</th>') +
    '<th>Estado</th><th>Prioridad</th><th>Fecha límite</th><th class="num">Horas</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="7" class="muted" style="text-align:center;padding:30px">Ninguna tarea coincide con los filtros.</td></tr>') +
    '</tbody></table></div>';
}

/* ============================ Equipo ============================ */

function renderTeam() {
  const open = S.tasks.filter(function (t) { return t.status !== 'terminada'; });
  const cur = currentWeekIdx();
  const week = weekByIdx(cur);
  const people = S.people.slice().sort(function (a, b) { return (a.active === false) - (b.active === false) || roleOrder(a.role) - roleOrder(b.role) || a.name.localeCompare(b.name); });

  const cards = people.map(function (p) {
    const mine = open.filter(function (t) { return t.assigneeId === p.id; });
    const od = mine.filter(isOverdue).length;
    const hours = week ? S.budget.filter(function (r) { return r.personId === p.id && r.weekIdx === cur; }).reduce(function (a, r) { return a + (r.hours || 0); }, 0) : 0;
    const clients = {};
    S.budget.forEach(function (r) { if (r.personId === p.id) clients[r.clientId] = true; });
    return '<div class="person-card' + (p.active === false ? ' inactive' : '') + '" data-act="goto-person" data-id="' + p.id + '">' +
      '<div class="avatar lg">' + esc(initials(p.name)) + '</div><div class="person-info">' +
      '<div class="person-name">' + esc(p.name) + '<span class="role-pill ' + p.role + '">' + ROLE_LABELS[p.role] + '</span></div>' +
      '<div class="person-email">' + esc(p.email || 'Sin correo registrado') + '</div>' +
      '<div class="person-stats"><span>' + mine.length + ' abiertas' + (od ? ' · <b style="color:var(--critical)">' + od + ' vencidas</b>' : '') + '</span>' +
      (week ? '<span>' + fmtH(hours) + ' h esta semana</span>' : '') +
      '<span>' + Object.keys(clients).length + ' clientes</span></div>' +
      '</div></div>';
  }).join('');

  return topbar('Equipo', 'Carga semanal de cada persona según el presupuesto. Haz clic en alguien para ver sus tareas.') +
    '<div class="view-body"><div class="people-grid">' + cards + '</div>' +
    '<h3 style="font-size:15px;margin-bottom:4px">Carga semanal</h3>' +
    '<p class="small muted" style="margin-bottom:12px">Suma de horas presupuestadas por semana frente a la cargabilidad (horas disponibles). En rojo, semanas por encima de la capacidad.</p>' +
    renderLoadGrid(people.filter(function (p) { return p.active !== false && S.budget.some(function (r) { return r.personId === p.id; }); })) +
    '<div class="legend-row">' +
    [['load-1', 'Menos del 50 %'], ['load-2', '50 a 80 %'], ['load-3', '80 a 100 %'], ['load-over', 'Sobrecarga']].map(function (l) {
      return '<span class="legend-item"><span class="sw ' + l[0] + '"></span>' + l[1] + '</span>';
    }).join('') + '<span class="legend-item"><span class="sw ph-vacaciones"></span>Vacaciones</span></div>' +
    '</div>';
}

function weekHeaderRows(fixedCols, extraRight) {
  const cur = currentWeekIdx();
  const months = [];
  S.weeks.forEach(function (w) {
    const last = months[months.length - 1];
    if (last && last.name === w.month) last.span++; else months.push({ name: w.month, span: 1 });
  });
  const r1 = '<tr>' + fixedCols.map(function (c, i) { return '<th class="' + (i === 0 ? 'fixed' : 'fixed2') + '" rowspan="3" style="vertical-align:bottom">' + c + '</th>'; }).join('') +
    months.map(function (m) { return '<th colspan="' + m.span + '">' + esc(m.name) + '</th>'; }).join('') +
    (extraRight ? '<th class="total" rowspan="3" style="vertical-align:bottom">' + extraRight + '</th>' : '') + '</tr>';
  const r2 = '<tr>' + S.weeks.map(function (w) { return '<th class="' + (w.idx === cur ? 'cur-head' : '') + '" title="Semana del ' + fmtDate(w.start) + '">' + esc(w.label.replace(/^Del\s+/i, '')) + '</th>'; }).join('') + '</tr>';
  const r3 = '<tr>' + S.weeks.map(function (w) { return '<th class="' + (w.idx === cur ? 'cur-head' : '') + '" title="Cargabilidad: horas disponibles">' + fmtH(w.capacity) + '</th>'; }).join('') + '</tr>';
  return '<thead>' + r1 + r2 + r3 + '</thead>';
}

function renderLoadGrid(people) {
  if (!S.weeks.length) return '<p class="muted small">No hay semanas cargadas. El gerente puede cargar el presupuesto base desde Ajustes.</p>';
  const cur = currentWeekIdx();
  const rows = people.map(function (p) {
    let total = 0;
    const cells = S.weeks.map(function (w) {
      const rows = S.budget.filter(function (r) { return r.personId === p.id && r.weekIdx === w.idx; });
      const h = rows.reduce(function (a, r) { return a + (r.hours || 0); }, 0);
      const vac = rows.some(function (r) { return r.phase === 'vacaciones'; });
      total += h;
      let cls = 'load-0';
      if (h > 0 && w.capacity) {
        const ratio = h / w.capacity;
        cls = ratio > 1.0001 ? 'load-over' : ratio >= 0.8 ? 'load-3' : ratio >= 0.5 ? 'load-2' : 'load-1';
      } else if (h > 0) cls = 'load-2';
      if (vac && !h) cls = 'ph-vacaciones';
      return '<td class="cell ' + cls + (w.idx === cur ? ' cur' : '') + '" title="' + esc(p.name) + ' · ' + esc(w.month + ' ' + w.label.toLowerCase()) + ': ' + fmtH(h) + ' de ' + fmtH(w.capacity) + ' h"><span class="v">' + (h ? fmtH(h) : (vac ? 'Vac.' : '')) + '</span></td>';
    }).join('');
    return '<tr><td class="fixed2" style="left:0;border-right:2px solid var(--line-strong)"><div class="assignee"><div class="avatar">' + esc(initials(p.name)) + '</div>' + esc(p.name) + ' <span class="muted small">' + ROLE_LABELS[p.role] + '</span></div></td>' + cells + '<td class="total">' + fmtH(total) + '</td></tr>';
  }).join('');
  return '<div class="grid-wrap"><table class="wgrid" style="--fixed-w:0px">' + weekHeaderRows(['Persona'], 'Total') + '<tbody>' + rows + '</tbody></table></div>';
}

/* ============================ Presupuesto ============================ */

function budgetRows(mine) {
  const seen = {};
  const rows = [];
  function add(c, p) {
    const k = c + '|' + p;
    if (seen[k]) return;
    seen[k] = true;
    rows.push({ clientId: c, personId: p });
  }
  S.budget.forEach(function (r) { add(r.clientId, r.personId); });
  if (!mine) UI.extraRows.forEach(function (r) { add(r.clientId, r.personId); });
  return rows.map(function (r) {
    return { clientId: r.clientId, personId: r.personId, client: clientById(r.clientId), person: personById(r.personId) };
  }).filter(function (r) { return r.client && r.person; })
    .sort(function (a, b) {
      return a.client.name.localeCompare(b.client.name) || roleOrder(a.person.role) - roleOrder(b.person.role) || a.person.name.localeCompare(b.person.name);
    });
}

function renderBudget(mine) {
  const cur = currentWeekIdx();
  const week = weekByIdx(cur);
  const editable = !mine && isManager();
  const bf = UI.budgetFilter;
  let rows = budgetRows(mine);
  if (!mine) {
    if (bf.person !== 'all') rows = rows.filter(function (r) { return String(r.personId) === bf.person; });
    if (bf.client !== 'all') rows = rows.filter(function (r) { return String(r.clientId) === bf.client; });
  }
  const map = budgetMap();

  const legend = '<div class="legend-row" style="margin-top:12px">' + PHASE_DEFS.map(function (p) {
    return '<span class="legend-item"><span class="sw ph-' + p.id + '"></span>' + esc(p.label) + '</span>';
  }).join('') + '</div>';

  let weekSummary = '';
  if (mine) {
    const myRows = week ? S.budget.filter(function (r) { return r.weekIdx === cur; }) : [];
    const total = myRows.reduce(function (a, r) { return a + (r.hours || 0); }, 0);
    const open = S.tasks.filter(function (t) { return t.status !== 'terminada'; });
    weekSummary = '<div class="week-summary">' +
      '<div class="week-card"><div class="t">' + (week ? 'Semana ' + esc(week.label.toLowerCase()) + ' de ' + esc(week.month.toLowerCase()) : 'Fuera del periodo presupuestado') + '</div>' +
      '<div class="h">' + fmtH(total) + ' <small>de ' + (week ? fmtH(week.capacity) : '—') + ' h presupuestadas</small></div>' +
      (myRows.length ? '<ul>' + myRows.map(function (r) {
        const c = clientById(r.clientId);
        return '<li><span>' + esc(c ? c.name : '') + '</span><span class="chip ph-' + (r.phase || '') + '">' + (r.hours != null ? fmtH(r.hours) + ' h' : '') + (r.phase ? ' · ' + esc(phaseLabel(r.phase)) : '') + '</span></li>';
      }).join('') + '</ul>' : '<p class="small muted" style="margin-top:6px">Sin horas presupuestadas esta semana.</p>') + '</div>' +
      '<div class="week-card"><div class="t">Tareas abiertas</div><div class="h">' + open.length + ' <small>' + open.filter(isOverdue).length + ' vencidas</small></div>' +
      '<p class="small muted" style="margin-top:6px">Ve a <b>Mis tareas</b> para registrar avances y horas.</p></div>' +
      '</div>';
  }

  const filters = mine ? '' : '<div class="filters-row">' +
    selectHtml('b-person', bf.person, activePeople().map(function (p) { return { value: p.id, label: p.name }; }), 'Todas las personas') +
    selectHtml('b-client', bf.client, S.clients.map(function (c) { return { value: c.id, label: c.name }; }), 'Todos los clientes') +
    (editable ? '<button class="btn btn-sm" data-act="budget-add-row">' + ICON.plus + 'Agregar fila</button>' : '') +
    '<span class="small muted" style="margin-left:auto">' + (editable ? 'Haz clic en una celda para editar horas y fase.' : 'Solo lectura.') + '</span></div>';

  let grid;
  if (!S.weeks.length) {
    grid = '<div class="empty-state">' + ICON.grid + '<h3>No hay presupuesto cargado</h3><p>' + (isGerente() ? 'Carga el presupuesto base desde Ajustes.' : 'El gerente aún no ha cargado el presupuesto de horas.') + '</p></div>';
  } else if (!rows.length) {
    grid = '<div class="empty-state">' + ICON.grid + '<h3>' + (mine ? 'No tienes horas presupuestadas' : 'Sin filas para mostrar') + '</h3><p>' + (mine ? 'Cuando el gerente o un senior te presupuesten horas, aparecerán aquí.' : 'Cambia los filtros o agrega una fila.') + '</p></div>';
  } else {
    let lastClient = null;
    const body = rows.map(function (r) {
      let total = 0;
      const cells = S.weeks.map(function (w) {
        const cell = map[r.clientId + '|' + r.personId + '|' + w.idx];
        let txt = '';
        let cls = 'cell';
        let title = esc(r.client.name) + ' · ' + esc(r.person.name) + ' · ' + esc(w.month + ' ' + w.label.toLowerCase());
        if (cell) {
          if (cell.hours != null) { txt = fmtH(cell.hours); total += cell.hours; }
          else if (cell.phase === 'vacaciones') txt = 'Vac.';
          else if (cell.note) txt = '…';
          cls += cell.phase ? ' ph-' + cell.phase : ' ph';
          title += (cell.hours != null ? ': ' + fmtH(cell.hours) + ' h' : '') + (cell.phase ? ' · ' + esc(phaseLabel(cell.phase)) : '') + (cell.note ? ' · ' + esc(cell.note) : '');
        }
        if (w.idx === cur) cls += ' cur';
        if (editable) cls += ' editable';
        return '<td class="' + cls + '" title="' + title + '"' + (editable ? ' data-act="budget-cell" data-c="' + r.clientId + '" data-p="' + r.personId + '" data-w="' + w.idx + '"' : '') + '><span class="v">' + txt + '</span></td>';
      }).join('');
      const clientCell = mine
        ? '<td class="fixed" title="' + esc(r.client.name) + '">' + esc(r.client.name) + '</td>'
        : '<td class="fixed" title="' + esc(r.client.name) + '">' + (r.clientId === lastClient ? '' : esc(r.client.name)) + '</td>';
      lastClient = r.clientId;
      const personCell = mine ? '' : '<td class="fixed2"><div class="assignee"><div class="avatar">' + esc(initials(r.person.name)) + '</div>' + esc(r.person.name) + ' <span class="muted small">' + ROLE_LABELS[r.person.role] + '</span></div></td>';
      return '<tr>' + clientCell + personCell + cells + '<td class="total">' + fmtH(total) + '</td></tr>';
    }).join('');
    grid = '<div class="grid-wrap"><table class="wgrid" style="--fixed-w:' + (mine ? '0px' : '200px') + '">' + weekHeaderRows(mine ? ['Cliente'] : ['Cliente', 'Funcionario'], 'Total') + '<tbody>' + body + '</tbody></table></div>';
  }

  const title = mine ? 'Mi semana' : 'Presupuesto de horas';
  const sub = mine ? 'Tus horas presupuestadas por cliente y semana.' : 'Horas por cliente, funcionario y semana. ' + (week ? 'Semana actual: ' + esc(week.label.toLowerCase()) + ' de ' + esc(week.month.toLowerCase()) + '.' : '');
  return topbar(title, sub) + '<div class="view-body">' + weekSummary + filters + grid + legend + '</div>';
}

/* ============================ Clientes ============================ */

function renderClients() {
  const open = S.tasks.filter(function (t) { return t.status !== 'terminada'; });
  const rows = S.clients.slice().sort(function (a, b) { return (a.active === false) - (b.active === false) || a.name.localeCompare(b.name); }).map(function (c) {
    const team = {};
    let hours = 0;
    S.budget.forEach(function (r) { if (r.clientId === c.id) { team[r.personId] = true; hours += r.hours || 0; } });
    const names = Object.keys(team).map(function (id) { return personById(Number(id)); }).filter(Boolean)
      .sort(function (a, b) { return roleOrder(a.role) - roleOrder(b.role) || a.name.localeCompare(b.name); });
    const n = open.filter(function (t) { return t.clientId === c.id; }).length;
    return '<tr' + (c.active === false ? ' style="opacity:.55"' : '') + '>' +
      '<td><div class="card-title">' + esc(c.name) + (c.active === false ? ' <span class="status-pill">Inactivo</span>' : '') + '</div></td>' +
      '<td>' + (names.length ? names.map(function (p) { return '<span class="assignee" style="display:inline-flex;margin:2px 8px 2px 0"><span class="avatar">' + esc(initials(p.name)) + '</span>' + esc(p.name) + '</span>'; }).join('') : '<span class="muted small">Sin equipo presupuestado</span>') + '</td>' +
      '<td class="num">' + n + '</td><td class="num">' + fmtH(hours) + '</td>' +
      '<td style="text-align:right;white-space:nowrap">' +
      '<button class="btn btn-sm" data-act="client-tasks" data-id="' + c.id + '">Tareas</button> ' +
      (isManager() ? '<button class="icon-btn" style="display:inline-flex" data-act="edit-client" data-id="' + c.id + '" title="Editar">' + ICON.edit + '</button>' : '') +
      '</td></tr>';
  }).join('');
  return topbar('Clientes', S.clients.length + ' clientes', isManager() ? '<button class="btn btn-accent btn-sm" data-act="new-client">' + ICON.plus + 'Nuevo cliente</button>' : '') +
    '<div class="view-body"><div class="table-wrap"><table class="data"><thead><tr><th>Cliente</th><th>Equipo (según presupuesto)</th><th class="num">Tareas abiertas</th><th class="num">Horas presup.</th><th></th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="5" class="muted" style="text-align:center;padding:30px">Sin clientes.</td></tr>') + '</tbody></table></div></div>';
}

/* ============================ Personas (gerente) ============================ */

function renderPeople() {
  const rows = S.people.slice().sort(function (a, b) { return (a.active === false) - (b.active === false) || roleOrder(a.role) - roleOrder(b.role) || a.name.localeCompare(b.name); }).map(function (p) {
    const access = p.active === false ? '<span class="status-pill">Inactiva</span>'
      : !p.email || !p.hasPassword ? '<span class="status-pill" style="color:var(--warning);border-color:var(--warning)">Sin acceso</span>'
      : p.mustChangePassword ? '<span class="status-pill">Debe cambiar clave</span>'
      : '<span class="status-pill" style="color:var(--good);border-color:var(--good)">Activa</span>';
    return '<tr' + (p.active === false ? ' style="opacity:.55"' : '') + '>' +
      '<td><div class="assignee"><div class="avatar">' + esc(initials(p.name)) + '</div><b>' + esc(p.name) + '</b>' + (p.id === S.user.id ? ' <span class="muted small">(tú)</span>' : '') + '</div></td>' +
      '<td>' + esc(p.email || '—') + '</td>' +
      '<td><span class="role-pill ' + p.role + '">' + ROLE_LABELS[p.role] + '</span></td>' +
      '<td>' + access + '</td>' +
      '<td class="num">' + (p.openTasks || 0) + '</td>' +
      '<td style="text-align:right;white-space:nowrap">' +
      '<button class="icon-btn" style="display:inline-flex" data-act="edit-person" data-id="' + p.id + '" title="Editar">' + ICON.edit + '</button>' +
      '<button class="icon-btn" style="display:inline-flex" data-act="person-password" data-id="' + p.id + '" title="Asignar contraseña">' + ICON.key + '</button>' +
      '</td></tr>';
  }).join('');
  return topbar('Personas', 'Cuentas y roles del equipo. Para dar acceso, registra correo y asigna una contraseña temporal.', '<button class="btn btn-accent btn-sm" data-act="new-person">' + ICON.plus + 'Nueva persona</button>') +
    '<div class="view-body"><div class="table-wrap"><table class="data"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Acceso</th><th class="num">Tareas abiertas</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<p class="small muted" style="margin-top:12px"><b>Gerente:</b> todo, incluida esta pantalla. <b>Senior:</b> ve todas las tareas y el presupuesto, crea y asigna tareas. <b>Junior:</b> solo ve sus tareas y su semana.</p></div>';
}

/* ============================ Ajustes ============================ */

function renderSettings() {
  let mailHtml = '';
  if (isManager()) {
    const m = S.mail || {};
    let status;
    if (!S.mailConfigured) {
      status = '<p class="small">El envío de correo no está configurado: faltan <code>GOOGLE_CLIENT_ID</code> y <code>GOOGLE_CLIENT_SECRET</code> en Vercel. Consulta <code>CONFIGURACION.md</code>.</p>';
    } else if (m.connected) {
      status = '<div class="sender-account"><div class="avatar lg">' + esc(initials(m.name || m.email)) + '</div><div style="flex:1;min-width:0"><div class="notify-status ok">' + ICON.check + 'Conectada</div>' +
        '<div style="font-weight:600">' + esc(m.email) + '</div><div class="small muted">Desde ' + fmtDateTime(m.connectedAt) + '</div></div></div>' +
        (m.lastError ? '<div class="notify-status err">' + ICON.warn + esc(m.lastError) + '</div>' : '');
    } else {
      status = '<div class="notify-status pending">Sin cuenta conectada. Las tareas no envían aviso hasta conectar una.</div>';
    }
    const actions = isGerente() && S.mailConfigured
      ? '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<a class="btn btn-accent btn-sm" href="/api/auth/google/start" style="text-decoration:none">' + ICON.mail + (m.connected ? 'Cambiar de cuenta' : 'Conectar cuenta de Google') + '</a>' +
        (m.connected ? '<button class="btn btn-sm btn-ghost-danger" data-act="mail-disconnect">Desconectar</button>' : '') + '</div>'
      : (isGerente() ? '' : '<p class="small muted">Solo el gerente conecta o cambia la cuenta.</p>');
    mailHtml = '<div class="panel-form settings-panel"><h3>Avisos por correo</h3><div class="hint">Cuando se asigna una tarea, la persona recibe un correo enviado desde esta cuenta de Google.</div>' +
      '<div class="notify-box">' + status + actions + '</div></div>';
  }

  const seedHtml = isGerente()
    ? '<div class="panel-form"><h3>Datos base</h3><div class="hint">Vuelve a cargar el presupuesto de horas 2026 desde el archivo base (<code>data/presupuesto-2026.json</code>). Actualiza semanas, clientes y celdas; no borra tareas ni cuentas.</div>' +
      '<button class="btn btn-sm" data-act="seed">Recargar presupuesto base</button></div>'
    : '';

  return topbar('Ajustes') + '<div class="view-body">' +
    '<div class="panel-form"><h3>Tu cuenta</h3><div class="hint">' + esc(S.user.name) + ' · ' + esc(S.user.email || '') + ' · ' + ROLE_LABELS[S.user.role] + '</div>' +
    '<button class="btn btn-sm" data-act="change-password">' + ICON.key + 'Cambiar contraseña</button></div>' +
    mailHtml + seedHtml + '</div>';
}

/* ============================ Modales ============================ */

function renderModal() {
  const m = UI.modal;
  if (!m) return '';
  let inner = '';
  switch (m.type) {
    case 'task': inner = modalTask(m); break;
    case 'cell': inner = modalCell(m); break;
    case 'addrow': inner = modalAddRow(m); break;
    case 'person': inner = modalPerson(m); break;
    case 'setpw': inner = modalSetPassword(m); break;
    case 'pwshow': inner = modalShowPassword(m); break;
    case 'client': inner = modalClient(m); break;
    case 'password': inner = modalPassword(m); break;
    case 'confirm': inner = modalConfirm(m); break;
    default: return '';
  }
  return '<div class="overlay" data-overlay>' + inner + '</div>';
}

function modalShell(title, body, foot, opts) {
  opts = opts || {};
  return '<div class="modal' + (opts.narrow ? ' narrow' : '') + '" role="dialog" aria-modal="true"><div class="modal-head"><h2>' + esc(title) + '</h2>' +
    (opts.noClose ? '' : '<button class="modal-close" data-act="close-modal" title="Cerrar">' + ICON.close + '</button>') + '</div>' +
    '<div class="modal-body">' + body + '</div>' + (foot ? '<div class="modal-foot">' + foot + '</div>' : '') + '</div>';
}

function segmented(name, defs, value, colorKey) {
  return '<div class="segmented" data-seg="' + name + '" data-value="' + esc(value) + '">' + defs.map(function (d) {
    return '<button type="button" class="seg-btn' + (d.id === value ? ' active' : '') + '" data-seg-value="' + d.id + '">' +
      (colorKey ? '<span class="dot" style="background:' + d[colorKey] + '"></span>' : '') + esc(d.label) + '</button>';
  }).join('') + '</div>';
}

function optionList(options, value, emptyLabel) {
  return (emptyLabel !== undefined ? '<option value="">' + esc(emptyLabel) + '</option>' : '') +
    options.map(function (o) { return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(value == null ? '' : value) ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('');
}

function commentsHtml(comments) {
  if (!comments || !comments.length) return '<div class="comment-empty">Aún no hay avances registrados.</div>';
  return comments.map(function (c) {
    return '<div class="comment"><div class="avatar">' + esc(initials(c.personName || '?')) + '</div><div class="comment-body">' +
      '<div class="comment-head"><span class="comment-author">' + esc(c.personName || 'Alguien') + '</span><span class="comment-time">' + fmtDateTime(c.createdAt) + '</span></div>' +
      '<div class="comment-text">' + esc(c.body) + '</div></div></div>';
  }).join('');
}

function modalTask(m) {
  const t = m.task || { title: '', description: '', clientId: m.clientId || null, phase: null, assigneeId: m.assigneeId || null, status: 'pendiente', priority: 'media', startDate: null, dueDate: null, hoursBudget: null, hoursSpent: 0 };
  const isNew = !m.task;
  const manager = isManager();
  const clients = S.clients.filter(function (c) { return c.active !== false || c.id === t.clientId; }).map(function (c) { return { value: c.id, label: c.name }; });
  const people = activePeople().filter(function (p) { return p.role !== 'gerente' || p.id === t.assigneeId || p.id === S.user.id; }).map(function (p) { return { value: p.id, label: p.name + ' · ' + ROLE_LABELS[p.role] }; });

  let body;
  if (manager) {
    body = '<form id="form-task" data-id="' + (t.id || '') + '">' +
      '<div class="form-row"><label class="field-label" for="t-title">Título</label><input id="t-title" type="text" name="title" required maxlength="200" value="' + esc(t.title) + '" placeholder="Ej. Conciliación bancaria de septiembre"></div>' +
      '<div class="form-row"><label class="field-label" for="t-desc">Descripción</label><textarea id="t-desc" name="description" placeholder="Alcance, documentos, criterios de entrega…">' + esc(t.description) + '</textarea></div>' +
      '<div class="form-row inline">' +
      '<div class="form-row"><label class="field-label" for="t-client">Cliente</label><select id="t-client" class="field" name="clientId">' + optionList(clients, t.clientId, 'Sin cliente') + '</select></div>' +
      '<div class="form-row"><label class="field-label" for="t-phase">Fase</label><select id="t-phase" class="field" name="phase">' + optionList(PHASE_DEFS.map(function (p) { return { value: p.id, label: p.label }; }), t.phase, 'Sin fase') + '</select></div>' +
      '</div>' +
      '<div class="form-row"><label class="field-label" for="t-assignee">Asignar a</label><select id="t-assignee" class="field" name="assigneeId">' + optionList(people, t.assigneeId, 'Sin asignar') + '</select></div>' +
      '<div class="form-row"><span class="field-label">Prioridad</span>' + segmented('priority', PRIORITY_DEFS, t.priority) + '</div>' +
      '<div class="form-row"><span class="field-label">Estado</span>' + segmented('status', STATUS_DEFS, t.status, 'color') + '</div>' +
      '<div class="form-row inline">' +
      '<div class="form-row"><label class="field-label" for="t-start">Inicio</label><input id="t-start" type="date" name="startDate" value="' + esc(t.startDate || '') + '"></div>' +
      '<div class="form-row"><label class="field-label" for="t-due">Fecha límite</label><input id="t-due" type="date" name="dueDate" value="' + esc(t.dueDate || '') + '"></div>' +
      '</div>' +
      '<div class="form-row inline">' +
      '<div class="form-row"><label class="field-label" for="t-hb">Horas presupuestadas</label><input id="t-hb" type="number" name="hoursBudget" min="0" step="0.5" value="' + (t.hoursBudget == null ? '' : t.hoursBudget) + '"></div>' +
      '<div class="form-row"><label class="field-label" for="t-hs">Horas invertidas</label><input id="t-hs" type="number" name="hoursSpent" min="0" step="0.5" value="' + (t.hoursSpent || 0) + '"></div>' +
      '</div>' +
      '</form>';
    if (!isNew) body += notifyBox(t);
  } else {
    body = '<dl class="kv">' +
      '<dt>Cliente</dt><dd>' + esc(t.clientName || 'Sin cliente') + '</dd>' +
      '<dt>Fase</dt><dd>' + (t.phase ? '<span class="chip ph-' + t.phase + '">' + esc(phaseLabel(t.phase)) + '</span>' : '—') + '</dd>' +
      '<dt>Prioridad</dt><dd><span class="chip ' + priorityDef(t.priority).cls + '">' + priorityDef(t.priority).label + '</span></dd>' +
      '<dt>Asignada por</dt><dd>' + esc(t.creatorName || '—') + '</dd>' +
      '<dt>Inicio</dt><dd>' + (t.startDate ? fmtDate(t.startDate) : '—') + '</dd>' +
      '<dt>Fecha límite</dt><dd' + (isOverdue(t) ? ' style="color:var(--critical);font-weight:600"' : '') + '>' + (t.dueDate ? fmtDate(t.dueDate) : '—') + '</dd>' +
      '<dt>Horas presupuestadas</dt><dd>' + (t.hoursBudget != null ? fmtH(t.hoursBudget) + ' h' : '—') + '</dd>' +
      '</dl>' +
      (t.description ? '<div class="section-label">Descripción</div><div class="comment-text" style="color:var(--ink)">' + esc(t.description) + '</div>' : '') +
      '<form id="form-task" data-id="' + t.id + '">' +
      '<div class="section-label">Tu avance</div>' +
      '<div class="form-row"><span class="field-label">Estado</span>' + segmented('status', STATUS_DEFS, t.status, 'color') + '</div>' +
      '<div class="form-row" style="max-width:220px"><label class="field-label" for="t-hs">Horas invertidas</label><input id="t-hs" type="number" name="hoursSpent" min="0" step="0.5" value="' + (t.hoursSpent || 0) + '"></div>' +
      (t.hoursBudget ? '<div class="hours-bar"><i class="' + (t.hoursSpent > t.hoursBudget ? 'over' : '') + '" style="width:' + Math.min(100, Math.round((t.hoursSpent || 0) / t.hoursBudget * 100)) + '%"></i></div>' : '') +
      '</form>';
  }

  if (!isNew) {
    body += '<div class="section-label">Avances y comentarios</div><div id="comments">' + (m.comments ? commentsHtml(m.comments) : '<div class="comment-empty">Cargando…</div>') + '</div>' +
      '<form id="form-comment" class="add-row" data-id="' + t.id + '"><textarea name="body" placeholder="Registra un avance o una nota…" required maxlength="4000"></textarea><button class="btn btn-sm" type="submit">Agregar</button></form>';
  }

  const foot = (manager && !isNew ? '<button class="btn btn-ghost-danger" data-act="delete-task" data-id="' + t.id + '">Eliminar</button>' : '') +
    (manager && !isNew && t.assigneeId ? '<button class="btn" data-act="send-mail" data-id="' + t.id + '">' + ICON.mail + 'Enviar correo</button>' : '') +
    '<span class="spacer"></span>' +
    (!isNew ? '<span class="muted-note">Creada ' + fmtDateTime(t.createdAt) + (t.creatorName ? ' por ' + esc(t.creatorName) : '') + '</span>' : '') +
    '<button class="btn" data-act="close-modal">Cancelar</button>' +
    '<button class="btn btn-accent" type="submit" form="form-task"' + (UI.busy ? ' disabled' : '') + '>' + (isNew ? 'Crear tarea' : 'Guardar') + '</button>';

  return modalShell(isNew ? 'Nueva tarea' : (manager ? 'Editar tarea' : t.title), body, foot);
}

function notifyBox(t) {
  const p = personById(t.assigneeId);
  if (!p) return '<div class="notify-box"><span class="muted-note">Sin persona asignada: no se envía aviso.</span></div>';
  let line;
  if (!p.email) line = '<span class="notify-status err">' + ICON.warn + esc(p.name) + ' no tiene correo registrado' + (isGerente() ? ' (agrégalo en Personas)' : '') + '.</span>';
  else if (t.notifiedAt) line = '<span class="notify-status ok">' + ICON.check + 'Aviso enviado a ' + esc(p.email) + ' el ' + fmtDateTime(t.notifiedAt) + '</span>';
  else line = '<span class="notify-status pending">Aún no se ha enviado aviso a ' + esc(p.email) + '.</span>';
  const sender = S.mail && S.mail.connected ? '<span class="muted-note">Se envía desde ' + esc(S.mail.email) + '.</span>' : '<span class="muted-note">No hay cuenta de Google conectada; el aviso no saldrá hasta que el gerente la conecte en Ajustes.</span>';
  return '<div class="notify-box">' + line + sender + '</div>';
}

function modalCell(m) {
  const c = clientById(m.clientId), p = personById(m.personId), w = weekByIdx(m.weekIdx);
  const cell = budgetMap()[m.clientId + '|' + m.personId + '|' + m.weekIdx] || {};
  const body = '<p class="small muted" style="margin-bottom:12px"><b>' + esc(c ? c.name : '') + '</b> · ' + esc(p ? p.name : '') + ' · ' + esc(w ? w.month + ', ' + w.label.toLowerCase() : '') + ' (cargabilidad ' + (w ? fmtH(w.capacity) : '') + ' h)</p>' +
    '<form id="form-cell" data-c="' + m.clientId + '" data-p="' + m.personId + '" data-w="' + m.weekIdx + '">' +
    '<div class="form-row inline">' +
    '<div class="form-row"><label class="field-label" for="c-hours">Horas</label><input id="c-hours" type="number" name="hours" min="0" step="0.5" value="' + (cell.hours == null ? '' : cell.hours) + '"></div>' +
    '<div class="form-row"><label class="field-label" for="c-phase">Fase</label><select id="c-phase" class="field" name="phase">' + optionList(PHASE_DEFS.map(function (x) { return { value: x.id, label: x.label }; }), cell.phase, 'Sin fase') + '</select></div></div>' +
    '<div class="form-row"><label class="field-label" for="c-note">Nota</label><input id="c-note" type="text" name="note" maxlength="300" value="' + esc(cell.note || '') + '" placeholder="Opcional"></div>' +
    '</form>';
  const foot = (cell.hours != null || cell.phase || cell.note ? '<button class="btn btn-ghost-danger" data-act="cell-clear">Vaciar celda</button>' : '') +
    '<span class="spacer"></span><button class="btn" data-act="close-modal">Cancelar</button><button class="btn btn-accent" type="submit" form="form-cell">Guardar</button>';
  return modalShell('Celda del presupuesto', body, foot, { narrow: true });
}

function modalAddRow(m) {
  const body = '<form id="form-addrow">' +
    '<div class="form-row"><label class="field-label" for="r-client">Cliente</label><select id="r-client" class="field" name="clientId" required>' + optionList(S.clients.filter(function (c) { return c.active !== false; }).map(function (c) { return { value: c.id, label: c.name }; }), '', 'Elige un cliente') + '</select></div>' +
    '<div class="form-row"><label class="field-label" for="r-person">Funcionario</label><select id="r-person" class="field" name="personId" required>' + optionList(activePeople().map(function (p) { return { value: p.id, label: p.name + ' · ' + ROLE_LABELS[p.role] }; }), '', 'Elige una persona') + '</select></div>' +
    '<p class="small muted">La fila aparece en la cuadrícula; se guarda en cuanto registres horas en alguna semana.</p></form>';
  return modalShell('Agregar fila', body, '<span class="spacer"></span><button class="btn" data-act="close-modal">Cancelar</button><button class="btn btn-accent" type="submit" form="form-addrow">Agregar</button>', { narrow: true });
}

function modalPerson(m) {
  const p = m.person || { name: '', email: '', role: 'junior', active: true };
  const isNew = !m.person;
  const body = '<form id="form-person" data-id="' + (p.id || '') + '">' +
    '<div class="form-row"><label class="field-label" for="p-name">Nombre</label><input id="p-name" type="text" name="name" required maxlength="120" value="' + esc(p.name) + '"></div>' +
    '<div class="form-row"><label class="field-label" for="p-email">Correo (para entrar y recibir avisos)</label><input id="p-email" type="email" name="email" value="' + esc(p.email || '') + '"></div>' +
    '<div class="form-row"><span class="field-label">Rol</span>' + segmented('role', [{ id: 'gerente', label: 'Gerente' }, { id: 'senior', label: 'Senior' }, { id: 'junior', label: 'Junior' }], p.role) + '</div>' +
    (isNew ? '<div class="form-row"><label class="checkbox-row"><input type="checkbox" name="withPassword" checked> Generar una contraseña temporal para que pueda entrar</label></div>'
      : (p.id !== S.user.id ? '<div class="form-row"><label class="checkbox-row"><input type="checkbox" name="active"' + (p.active !== false ? ' checked' : '') + '> Cuenta activa (si se desactiva, no puede entrar ni recibe tareas nuevas)</label></div>' : '')) +
    '</form>';
  return modalShell(isNew ? 'Nueva persona' : 'Editar persona', body, '<span class="spacer"></span><button class="btn" data-act="close-modal">Cancelar</button><button class="btn btn-accent" type="submit" form="form-person">' + (isNew ? 'Crear' : 'Guardar') + '</button>', { narrow: true });
}

function modalSetPassword(m) {
  const p = personById(m.personId);
  const body = '<p class="small" style="margin-bottom:12px">Se asignará una contraseña temporal a <b>' + esc(p.name) + '</b>. Deberá cambiarla al entrar. Sus sesiones abiertas se cerrarán.</p>' +
    (!p.email ? '<div class="auth-error">Esta persona no tiene correo registrado: sin correo no puede iniciar sesión. Edítala primero.</div>' : '') +
    '<form id="form-setpw" data-id="' + p.id + '"><div class="form-row"><label class="field-label" for="sp-pw">Contraseña temporal</label><input id="sp-pw" type="text" name="password" minlength="8" required value="' + esc(randomPassword()) + '" autocomplete="off"></div></form>';
  return modalShell('Asignar contraseña', body, '<span class="spacer"></span><button class="btn" data-act="close-modal">Cancelar</button><button class="btn btn-accent" type="submit" form="form-setpw"' + (!p.email ? ' disabled' : '') + '>Asignar</button>', { narrow: true });
}

function modalShowPassword(m) {
  const body = '<div class="pw-box">Contraseña temporal de <b>' + esc(m.name) + '</b> (' + esc(m.email || 'sin correo') + '):<div class="pw">' + esc(m.password) + '</div>' +
    'Compártela por un canal seguro. No volverá a mostrarse; si se pierde, asigna otra desde Personas.</div>';
  return modalShell('Acceso creado', body, '<span class="spacer"></span><button class="btn btn-accent" data-act="close-modal">Entendido</button>', { narrow: true });
}

function modalClient(m) {
  const c = m.client || { name: '', active: true };
  const isNew = !m.client;
  const body = '<form id="form-client" data-id="' + (c.id || '') + '">' +
    '<div class="form-row"><label class="field-label" for="cl-name">Nombre</label><input id="cl-name" type="text" name="name" required maxlength="160" value="' + esc(c.name) + '"></div>' +
    (isNew ? '' : '<div class="form-row"><label class="checkbox-row"><input type="checkbox" name="active"' + (c.active !== false ? ' checked' : '') + '> Cliente activo</label></div>') + '</form>';
  return modalShell(isNew ? 'Nuevo cliente' : 'Editar cliente', body, '<span class="spacer"></span><button class="btn" data-act="close-modal">Cancelar</button><button class="btn btn-accent" type="submit" form="form-client">' + (isNew ? 'Crear' : 'Guardar') + '</button>', { narrow: true });
}

function modalPassword(m) {
  const body = (m.forced ? '<p class="small" style="margin-bottom:12px">Tu contraseña es temporal. Elige una nueva para continuar.</p>' : '') +
    '<form id="form-password">' +
    '<div class="form-row"><label class="field-label" for="pw-cur">Contraseña actual</label><input id="pw-cur" type="password" name="current" autocomplete="current-password" required></div>' +
    '<div class="form-row"><label class="field-label" for="pw-new">Nueva contraseña (mínimo 8 caracteres)</label><input id="pw-new" type="password" name="password" autocomplete="new-password" minlength="8" required></div>' +
    '<div class="form-row"><label class="field-label" for="pw-rep">Repite la nueva contraseña</label><input id="pw-rep" type="password" name="repeat" autocomplete="new-password" minlength="8" required></div>' +
    '</form>';
  return modalShell('Cambiar contraseña', body, '<span class="spacer"></span>' + (m.forced ? '<button class="btn" data-act="logout">Salir</button>' : '<button class="btn" data-act="close-modal">Cancelar</button>') + '<button class="btn btn-accent" type="submit" form="form-password">Guardar</button>', { narrow: true, noClose: m.forced });
}

function modalConfirm(m) {
  return modalShell(m.title, '<p style="font-size:14px">' + esc(m.text) + '</p>',
    '<span class="spacer"></span><button class="btn" data-act="close-modal">Cancelar</button><button class="btn ' + (m.danger ? 'btn-ghost-danger' : 'btn-accent') + '" data-act="confirm-ok">' + esc(m.okLabel || 'Confirmar') + '</button>', { narrow: true });
}

function confirmDialog(opts) {
  UI.modal = Object.assign({ type: 'confirm' }, opts);
  render();
}

function closeModal() {
  if (UI.modal && UI.modal.forced) return;
  UI.modal = null;
  render();
}

/* ============================ acciones ============================ */

async function openTask(id) {
  const t = taskById(id);
  if (!t) return;
  UI.modal = { type: 'task', task: t, comments: null };
  render();
  try {
    const r = await api('GET', '/api/tasks?id=' + id);
    if (UI.modal && UI.modal.type === 'task' && UI.modal.task && UI.modal.task.id === id) {
      UI.modal.task = r.task;
      UI.modal.comments = r.task.comments || [];
      const el = document.getElementById('comments');
      if (el) el.innerHTML = commentsHtml(UI.modal.comments);
    }
  } catch (err) { toast(err.message, 'err'); }
}

function readForm(form) {
  const out = {};
  Array.prototype.forEach.call(form.elements, function (el) {
    if (!el.name) return;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else out[el.name] = el.value;
  });
  form.querySelectorAll('[data-seg]').forEach(function (seg) { out[seg.dataset.seg] = seg.dataset.value; });
  return out;
}

async function withBusy(fn) {
  if (UI.busy) return;
  UI.busy = true;
  try { await fn(); }
  catch (err) { toast(err.message || String(err), 'err'); }
  finally { UI.busy = false; }
}

async function notifyAssignee(task, silent) {
  if (!task.assigneeId) return;
  const p = personById(task.assigneeId);
  if (!p || !p.email) { if (!silent) toast(p ? p.name + ' no tiene correo registrado.' : 'Sin persona asignada.', 'err'); return; }
  if (!S.mail || !S.mail.connected) { if (!silent) toast('No hay cuenta de Google conectada para enviar el aviso.', 'err'); return; }
  try {
    const r = await api('POST', '/api/mail', { taskId: task.id });
    toast('Aviso enviado a ' + r.to, 'ok');
    const t = taskById(task.id);
    if (t) t.notifiedAt = r.sentAt;
    if (UI.modal && UI.modal.type === 'task' && UI.modal.task && UI.modal.task.id === task.id) { UI.modal.task.notifiedAt = r.sentAt; render(); }
    if (S.mail) S.mail.lastError = null;
  } catch (err) {
    if (S.mail && (err.code === 'needs_reauth' || err.code === 'refresh_failed' || err.code === 'send_failed')) S.mail.lastError = err.message;
    toast('No se envió el aviso: ' + err.message, 'err');
  }
}

async function submitTask(form) {
  const data = readForm(form);
  const id = form.dataset.id ? Number(form.dataset.id) : null;
  await withBusy(async function () {
    let payload;
    if (isManager()) {
      payload = {
        title: data.title, description: data.description,
        clientId: data.clientId ? Number(data.clientId) : null,
        phase: data.phase || null,
        assigneeId: data.assigneeId ? Number(data.assigneeId) : null,
        status: data.status, priority: data.priority,
        startDate: data.startDate || null, dueDate: data.dueDate || null,
        hoursBudget: data.hoursBudget === '' ? null : Number(data.hoursBudget),
        hoursSpent: data.hoursSpent === '' ? 0 : Number(data.hoursSpent)
      };
    } else {
      payload = { status: data.status, hoursSpent: data.hoursSpent === '' ? 0 : Number(data.hoursSpent) };
    }
    const before = id ? taskById(id) : null;
    const r = id ? await api('PATCH', '/api/tasks?id=' + id, payload) : await api('POST', '/api/tasks', payload);
    const task = r.task;
    if (id) S.tasks = S.tasks.map(function (t) { return t.id === id ? task : t; });
    else S.tasks.unshift(task);
    UI.modal = null;
    render();
    toast(id ? 'Tarea guardada.' : 'Tarea creada.', 'ok');
    // Aviso automático cuando la tarea cambia de manos.
    if (isManager() && task.assigneeId && (!before || before.assigneeId !== task.assigneeId)) {
      await notifyAssignee(task, true);
    }
  });
}

async function submitComment(form) {
  const id = Number(form.dataset.id);
  const text = form.elements.body.value.trim();
  if (!text) return;
  await withBusy(async function () {
    const r = await api('POST', '/api/tasks?id=' + id + '&action=comment', { body: text });
    if (UI.modal && UI.modal.type === 'task') UI.modal.comments = r.comments;
    const t = taskById(id);
    if (t) t.commentsCount = r.comments.length;
    const el = document.getElementById('comments');
    if (el) el.innerHTML = commentsHtml(r.comments);
    form.elements.body.value = '';
  });
}

async function changeStatus(id, status) {
  const t = taskById(id);
  if (!t || t.status === status) return;
  const prev = t.status;
  t.status = status;
  render();
  try {
    const r = await api('PATCH', '/api/tasks?id=' + id, { status: status });
    S.tasks = S.tasks.map(function (x) { return x.id === id ? r.task : x; });
    render();
  } catch (err) {
    t.status = prev;
    render();
    toast(err.message, 'err');
  }
}

async function saveCell(clientId, personId, weekIdx, hours, phase, note) {
  await withBusy(async function () {
    const r = await api('PUT', '/api/budget', { rows: [{ clientId: clientId, personId: personId, weekIdx: weekIdx, hours: hours, phase: phase, note: note }] });
    const saved = r.rows[0];
    S.budget = S.budget.filter(function (x) { return !(x.clientId === clientId && x.personId === personId && x.weekIdx === weekIdx); });
    if (!saved.deleted) S.budget.push(saved);
    UI.modal = null;
    render();
  });
}

async function submitPerson(form) {
  const data = readForm(form);
  const id = form.dataset.id ? Number(form.dataset.id) : null;
  await withBusy(async function () {
    const payload = { name: data.name, email: data.email || null, role: data.role };
    let tempPassword = null;
    if (id) {
      if (data.active !== undefined) payload.active = data.active;
      const r = await api('PATCH', '/api/people?id=' + id, payload);
      S.people = S.people.map(function (p) { return p.id === id ? Object.assign({}, p, r.person) : p; });
      if (id === S.user.id) S.user = Object.assign({}, S.user, { name: r.person.name, email: r.person.email });
      UI.modal = null;
      toast('Persona guardada.', 'ok');
    } else {
      if (data.withPassword && data.email) { tempPassword = randomPassword(); payload.password = tempPassword; }
      const r = await api('POST', '/api/people', payload);
      S.people.push(Object.assign({ openTasks: 0 }, r.person));
      UI.modal = tempPassword ? { type: 'pwshow', name: r.person.name, email: r.person.email, password: tempPassword } : null;
      toast('Persona creada.' + (data.withPassword && !data.email ? ' Sin correo no se generó contraseña.' : ''), 'ok');
    }
    render();
  });
}

async function submitSetPassword(form) {
  const id = Number(form.dataset.id);
  const password = form.elements.password.value;
  await withBusy(async function () {
    const r = await api('PATCH', '/api/people?id=' + id, { password: password });
    S.people = S.people.map(function (p) { return p.id === id ? Object.assign({}, p, r.person) : p; });
    UI.modal = { type: 'pwshow', name: r.person.name, email: r.person.email, password: password };
    render();
  });
}

async function submitClient(form) {
  const data = readForm(form);
  const id = form.dataset.id ? Number(form.dataset.id) : null;
  await withBusy(async function () {
    if (id) {
      const r = await api('PATCH', '/api/clients?id=' + id, { name: data.name, active: data.active });
      S.clients = S.clients.map(function (c) { return c.id === id ? r.client : c; });
      S.tasks.forEach(function (t) { if (t.clientId === id) t.clientName = r.client.name; });
    } else {
      const r = await api('POST', '/api/clients', { name: data.name });
      S.clients.push(r.client);
    }
    UI.modal = null;
    render();
    toast('Cliente guardado.', 'ok');
  });
}

async function submitPassword(form) {
  const data = readForm(form);
  if (data.password !== data.repeat) { toast('Las contraseñas nuevas no coinciden.', 'err'); return; }
  await withBusy(async function () {
    await api('POST', '/api/auth?action=password', { current: data.current, password: data.password });
    S.user.mustChangePassword = false;
    UI.modal = null;
    render();
    toast('Contraseña actualizada.', 'ok');
  });
}

async function submitLogin(form) {
  const data = readForm(form);
  UI.authError = null;
  UI.busy = true; render();
  try {
    const r = await api('POST', '/api/auth?action=login', { email: data.email, password: data.password });
    S.user = r.user;
    UI.view = null;
    await loadAll();
    if (S.user.mustChangePassword) UI.modal = { type: 'password', forced: true };
  } catch (err) {
    UI.authError = err.message;
    S.user = null;
  } finally {
    UI.busy = false;
    render();
  }
}

async function submitSetup(form) {
  const data = readForm(form);
  UI.authError = null;
  UI.busy = true; render();
  try {
    const r = await api('POST', '/api/auth?action=setup', { name: data.name, email: data.email, password: data.password, seed: data.seed });
    S.user = r.user;
    S.setupRequired = false;
    UI.view = null;
    await loadAll();
    if (r.seeded) toast('Presupuesto cargado: ' + r.seeded.clients + ' clientes, ' + r.seeded.people + ' personas, ' + r.seeded.budget + ' celdas.', 'ok');
  } catch (err) {
    UI.authError = err.message;
  } finally {
    UI.busy = false;
    render();
  }
}

async function logout() {
  try { await api('POST', '/api/auth?action=logout'); } catch (e) { /* igual salimos */ }
  S.user = null; S.loaded = false; UI.modal = null; UI.view = null; UI.authError = null;
  history.replaceState(null, '', location.pathname);
  render();
}

/* ============================ eventos ============================ */

document.addEventListener('click', function (ev) {
  const segBtn = ev.target.closest('[data-seg-value]');
  if (segBtn) {
    const seg = segBtn.closest('[data-seg]');
    seg.dataset.value = segBtn.dataset.segValue;
    seg.querySelectorAll('.seg-btn').forEach(function (b) { b.classList.toggle('active', b === segBtn); });
    return;
  }
  if (ev.target.hasAttribute('data-overlay')) { closeModal(); return; }

  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id ? Number(el.dataset.id) : null;

  switch (act) {
    case 'nav': setView(el.dataset.view); break;
    case 'logout': logout(); break;
    case 'close-modal': closeModal(); break;
    case 'new-task': UI.modal = { type: 'task', task: null }; render(); break;
    case 'open-task': openTask(id); break;
    case 'task-mode': UI.taskMode = el.dataset.mode; render(); break;
    case 'clear-filters':
      UI.filters = { assignee: 'all', client: 'all', phase: 'all', priority: 'all', status: 'all' }; UI.search = ''; render(); break;
    case 'panel-filter':
      UI.filters = { assignee: 'all', client: 'all', phase: 'all', priority: 'all', status: el.dataset.status };
      UI.taskMode = 'list'; setView('tareas'); break;
    case 'goto-person':
      UI.filters = { assignee: String(id), client: 'all', phase: 'all', priority: 'all', status: 'all' }; setView('tareas'); break;
    case 'client-tasks':
      UI.filters = { assignee: 'all', client: String(id), phase: 'all', priority: 'all', status: 'all' }; setView('tareas'); break;
    case 'delete-task':
      confirmDialog({ title: 'Eliminar tarea', text: 'Se eliminará la tarea y sus avances. Esta acción no se puede deshacer.', okLabel: 'Eliminar', danger: true,
        onOk: async function () {
          await api('DELETE', '/api/tasks?id=' + id);
          S.tasks = S.tasks.filter(function (t) { return t.id !== id; });
          UI.modal = null; render(); toast('Tarea eliminada.', 'ok');
        } });
      break;
    case 'send-mail': { const t = taskById(id); if (t) notifyAssignee(t, false); break; }
    case 'budget-cell':
      UI.modal = { type: 'cell', clientId: Number(el.dataset.c), personId: Number(el.dataset.p), weekIdx: Number(el.dataset.w) }; render(); break;
    case 'budget-add-row': UI.modal = { type: 'addrow' }; render(); break;
    case 'cell-clear': { const m = UI.modal; saveCell(m.clientId, m.personId, m.weekIdx, null, null, null); break; }
    case 'new-person': UI.modal = { type: 'person', person: null }; render(); break;
    case 'edit-person': UI.modal = { type: 'person', person: personById(id) }; render(); break;
    case 'person-password': UI.modal = { type: 'setpw', personId: id }; render(); break;
    case 'new-client': UI.modal = { type: 'client', client: null }; render(); break;
    case 'edit-client': UI.modal = { type: 'client', client: clientById(id) }; render(); break;
    case 'change-password': UI.modal = { type: 'password', forced: false }; render(); break;
    case 'mail-disconnect':
      confirmDialog({ title: 'Desconectar cuenta', text: 'Las tareas dejarán de enviar avisos por correo hasta conectar otra cuenta.', okLabel: 'Desconectar', danger: true,
        onOk: async function () { S.mail = await api('DELETE', '/api/mail'); UI.modal = null; render(); toast('Cuenta desconectada.', 'ok'); } });
      break;
    case 'seed':
      confirmDialog({ title: 'Recargar presupuesto base', text: 'Se cargarán de nuevo semanas, clientes, funcionarios y celdas del archivo base. Las celdas que coincidan volverán al valor del Excel; las demás se conservan.', okLabel: 'Recargar',
        onOk: async function () { const r = await api('POST', '/api/budget?action=seed'); await loadAll(); UI.modal = null; render(); toast('Presupuesto recargado: ' + r.seeded.budget + ' celdas.', 'ok'); } });
      break;
    case 'confirm-ok': {
      const m = UI.modal;
      if (m && m.onOk) withBusy(m.onOk);
      break;
    }
  }
});

document.addEventListener('submit', function (ev) {
  const form = ev.target;
  ev.preventDefault();
  switch (form.id) {
    case 'form-login': submitLogin(form); break;
    case 'form-setup': submitSetup(form); break;
    case 'form-task': submitTask(form); break;
    case 'form-comment': submitComment(form); break;
    case 'form-cell': {
      const d = readForm(form);
      saveCell(Number(form.dataset.c), Number(form.dataset.p), Number(form.dataset.w), d.hours === '' ? null : Number(d.hours), d.phase || null, d.note || null);
      break;
    }
    case 'form-addrow': {
      const d = readForm(form);
      if (!d.clientId || !d.personId) return;
      UI.extraRows.push({ clientId: Number(d.clientId), personId: Number(d.personId) });
      UI.budgetFilter = { person: 'all', client: 'all' };
      UI.modal = null; render();
      break;
    }
    case 'form-person': submitPerson(form); break;
    case 'form-setpw': submitSetPassword(form); break;
    case 'form-client': submitClient(form); break;
    case 'form-password': submitPassword(form); break;
  }
});

document.addEventListener('change', function (ev) {
  const el = ev.target;
  if (el.dataset.filter) {
    const f = el.dataset.filter;
    if (f === 'b-person') UI.budgetFilter.person = el.value;
    else if (f === 'b-client') UI.budgetFilter.client = el.value;
    else UI.filters[f] = el.value;
    render();
  }
});

let searchTimer = null;
document.addEventListener('input', function (ev) {
  const el = ev.target;
  if (el.hasAttribute('data-search')) {
    clearTimeout(searchTimer);
    const v = el.value;
    searchTimer = setTimeout(function () {
      UI.search = v;
      const pos = el.selectionStart;
      render();
      const again = document.querySelector('[data-search]');
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) { /* nada */ } }
    }, 180);
  }
});

document.addEventListener('keydown', function (ev) {
  if (ev.key === 'Escape' && UI.modal) closeModal();
});

/* arrastrar y soltar en el tablero */
let dragId = null;
document.addEventListener('dragstart', function (ev) {
  const card = ev.target.closest && ev.target.closest('.card[draggable]');
  if (!card) return;
  dragId = Number(card.dataset.id);
  card.classList.add('dragging');
  ev.dataTransfer.effectAllowed = 'move';
  try { ev.dataTransfer.setData('text/plain', String(dragId)); } catch (e) { /* nada */ }
});
document.addEventListener('dragend', function (ev) {
  const card = ev.target.closest && ev.target.closest('.card');
  if (card) card.classList.remove('dragging');
  document.querySelectorAll('.col-cards.drag-over').forEach(function (c) { c.classList.remove('drag-over'); });
});
document.addEventListener('dragover', function (ev) {
  const col = ev.target.closest && ev.target.closest('.col-cards');
  if (!col || dragId === null) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';
  col.classList.add('drag-over');
});
document.addEventListener('dragleave', function (ev) {
  const col = ev.target.closest && ev.target.closest('.col-cards');
  if (col && !col.contains(ev.relatedTarget)) col.classList.remove('drag-over');
});
document.addEventListener('drop', function (ev) {
  const col = ev.target.closest && ev.target.closest('.col-cards');
  if (!col || dragId === null) return;
  ev.preventDefault();
  const id = dragId;
  dragId = null;
  changeStatus(id, col.dataset.status);
});

boot();
