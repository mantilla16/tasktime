"use strict";
/* =========================================================================
   Russell Bedford — asignación de horas por cliente.

   Roles:
     gerente  ve y asigna horas a todo el equipo, administra personas y clientes.
     senior   ve y asigna horas a todo el equipo.
     junior   solo ve sus propias horas.

   La visibilidad la impone el servidor (api/*.js); aquí solo se decide qué
   pantallas mostrar. Todo el estado vive en S; la interfaz se vuelve a
   dibujar con render() tras cada cambio.
   ========================================================================= */

const S = { user: null, setupRequired: false, dominio: 'rbcol.co', msClientId: null, msTenantId: null, people: [], clients: [], sedes: ['Barranquilla', 'Santa Marta'], weeks: [], holidays: {}, capacity: 42, budget: [], loaded: false };
const UI = {
  view: null,
  weekIdx: null,
  filtro: { persona: 'all', cliente: 'all', mes: 'all', sede: 'all' },
  filasExtra: [],
  modal: null,
  busy: false,
  authError: null,
  msConectando: false
};

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
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M15 8l3 3M18 5l3 3"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17l5-5-5-5M15 12H3"/><path d="M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2.5 17.5A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  merge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v6a4 4 0 0 0 4 4h4"/><path d="M18 4v16"/><path d="M11 11l3 3-3 3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>'
};
const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DIAS_LARGO = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

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
function msMode() { return Boolean(S.msClientId && S.msTenantId); }
function isManager() { return S.user && (S.user.role === 'gerente' || S.user.role === 'senior'); }
function isGerente() { return S.user && S.user.role === 'gerente'; }
function personById(id) { return S.people.find(function (p) { return p.id === id; }) || null; }
function clientById(id) { return S.clients.find(function (c) { return c.id === id; }) || null; }
function phaseLabel(id) { const d = PHASE_DEFS.find(function (p) { return p.id === id; }); return d ? d.label : ''; }
function roleOrder(r) { return r === 'gerente' ? 0 : r === 'senior' ? 1 : 2; }
function sortPeople(list) {
  return list.slice().sort(function (a, b) {
    return (a.active === false) - (b.active === false) || roleOrder(a.role) - roleOrder(b.role) || a.name.localeCompare(b.name);
  });
}
function activePeople() { return sortPeople(S.people.filter(function (p) { return p.active !== false; })); }
function teamPeople() {
  // Quienes reciben horas: todo el equipo activo salvo gerentes sin presupuesto.
  return activePeople().filter(function (p) { return p.role !== 'gerente' || S.budget.some(function (r) { return r.personId === p.id; }); });
}
function currentWeekIdx() {
  const t = todayISO();
  let cur = null;
  S.weeks.forEach(function (w) { if (w.start <= t) cur = w; });
  if (!cur || t >= addDays(cur.start, 7)) return -1;
  return cur.idx;
}
function weekByIdx(i) { return S.weeks.find(function (w) { return w.idx === i; }) || null; }
function weekMonthKey(w) { return w.month + ' ' + String(w.start).slice(0, 4); }
function monthOptions() {
  const seen = {}, out = [];
  S.weeks.forEach(function (w) { const k = weekMonthKey(w); if (!seen[k]) { seen[k] = true; out.push(k); } });
  return out;
}
function visibleWeeks() {
  if (UI.filtro.mes === 'all') return S.weeks;
  const v = S.weeks.filter(function (w) { return weekMonthKey(w) === UI.filtro.mes; });
  return v.length ? v : S.weeks;
}
function selectorMes() {
  return '<select class="rb-select" data-filtro="mes" title="Mostrar un mes o todo el calendario"><option value="all">Todo el calendario</option>' +
    monthOptions().map(function (k) { return '<option value="' + esc(k) + '"' + (UI.filtro.mes === k ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select>';
}
function rangoCalendario() {
  if (!S.weeks.length) return 'Sin semanas cargadas';
  const a = S.weeks[0], b = S.weeks[S.weeks.length - 1];
  return S.weeks.length + ' semanas, del ' + fmtDate(a.start) + ' al ' + fmtDate(addDays(b.start, 5));
}
function weekTitle(w) { return w ? w.month + ', ' + w.label.toLowerCase() : ''; }
function weekTag(w) { return w ? 'Sem ' + isoWeekNumber(w.start) : ''; }

/* ---- días ---- */
function dow(iso) { return (new Date(iso + 'T00:00:00').getDay() + 6) % 7; }   // 0 = lunes … 6 = domingo
function mondayOf(iso) { return addDays(iso, -dow(iso)); }
function isWeekend(iso) { return dow(iso) >= 5; }
function isHoliday(iso) { return Boolean(S.holidays[iso]); }
function isoWeekNumber(iso) {
  const p = iso.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
}
function weekDays(w) { const out = []; for (let i = 0; i < 7; i++) out.push(addDays(w.start, i)); return out; }
function diaClases(iso) {
  return (isWeekend(iso) ? ' fin' : '') + (isHoliday(iso) ? ' fest' : '') + (iso === todayISO() ? ' hoy' : '');
}
function diaTitulo(iso) {
  return DIAS_LARGO[dow(iso)] + ' ' + fmtDate(iso) + (isHoliday(iso) ? ' · festivo' : '');
}

/* ---- índices del presupuesto (se recalculan al cargar y al guardar) ---- */
let IDX = { byKey: {}, byWeek: {}, weekOfMonday: {} };
function indexBudget() {
  IDX = { byKey: {}, byWeek: {}, weekOfMonday: {} };
  S.weeks.forEach(function (w) { IDX.weekOfMonday[w.start] = w.idx; });
  S.budget.forEach(function (r) {
    IDX.byKey[r.clientId + '|' + r.personId + '|' + r.day] = r;
    const wi = IDX.weekOfMonday[mondayOf(r.day)];
    if (wi === undefined) return;
    (IDX.byWeek[wi] = IDX.byWeek[wi] || []).push(r);
  });
}
function weekOfDay(iso) { const wi = IDX.weekOfMonday[mondayOf(iso)]; return wi === undefined ? null : wi; }
function rowsWeek(weekIdx) { return IDX.byWeek[weekIdx] || []; }
function cellOf(clientId, personId, day) { return IDX.byKey[clientId + '|' + personId + '|' + day] || null; }
function hoursOf(personId, weekIdx) {
  return rowsWeek(weekIdx).reduce(function (a, r) { return a + (r.personId === personId ? (r.hours || 0) : 0); }, 0);
}
function weekCells(clientId, personId, w) {
  return weekDays(w).map(function (d) { return cellOf(clientId, personId, d); });
}
function sobrecargados(weekIdx, people) {
  const w = weekByIdx(weekIdx);
  if (!w) return [];
  return people.filter(function (p) { return hoursOf(p.id, weekIdx) > w.capacity; });
}
function sedeLabel(sede) { return sede || 'Sin sede'; }
function cargaClass(hours, capacity) {
  if (!hours) return 'carga-0';
  if (!capacity) return 'carga-2';
  const ratio = hours / capacity;
  return ratio > 1.0001 ? 'carga-sobre' : ratio >= 0.9 ? 'carga-4' : ratio >= 0.7 ? 'carga-3' : ratio >= 0.4 ? 'carga-2' : 'carga-1';
}
function barraClass(hours, capacity) {
  if (!capacity) return '';
  const ratio = hours / capacity;
  return ratio > 1.0001 ? 'sobre' : ratio >= 0.9 ? 'alto' : ratio >= 0.6 ? 'medio' : '';
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
  el.className = 'rb-alerta rb-alerta--' + (kind === 'err' ? 'error' : kind === 'ok' ? 'exito' : 'info');
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(function () { el.remove(); }, kind === 'err' ? 6000 : 3600);
}

/* ============================ API ============================ */

/* La app puede vivir en la raíz (https://host/) o bajo una ruta
   (https://host/tasktime/): las llamadas al API se hacen relativas a la
   carpeta de la página, nunca a la raíz del dominio. */
const BASE = location.pathname.replace(/\/[^/]*$/, '');

async function api(method, url, body) {
  const r = await fetch(BASE + url, {
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
    throw err;
  }
  return payload;
}

async function loadAll() {
  const results = await Promise.all([api('GET', '/api/people'), api('GET', '/api/clients'), api('GET', '/api/budget')]);
  S.people = results[0].people;
  S.clients = results[1].clients;
  S.sedes = results[1].sedes || S.sedes;
  S.weeks = results[2].weeks;
  S.capacity = results[2].capacity || 42;
  S.holidays = {};
  (results[2].holidays || []).forEach(function (d) { S.holidays[d] = true; });
  S.budget = results[2].rows;
  indexBudget();
  S.loaded = true;
  const cur = currentWeekIdx();
  if (UI.weekIdx === null || !weekByIdx(UI.weekIdx)) {
    UI.weekIdx = cur >= 0 ? cur : (S.weeks.length ? S.weeks[0].idx : null);
  }
  // El tablero por días se abre en el mes actual; "todo el calendario" sigue disponible.
  if (UI.filtro.mes === 'all' && S.weeks.length) {
    const w = weekByIdx(cur >= 0 ? cur : S.weeks[0].idx);
    if (w) UI.filtro.mes = weekMonthKey(w);
  }
}

async function boot() {
  try {
    const a = await api('GET', '/api/auth');
    S.setupRequired = a.setupRequired;
    S.user = a.user;
    S.dominio = a.dominio || S.dominio;
    S.msClientId = a.msClientId || null;
    S.msTenantId = a.msTenantId || null;
    if (S.user) await loadAll();
  } catch (err) {
    UI.authError = err.message;
  }
  if (S.user && S.user.mustChangePassword) UI.modal = { type: 'password', forced: true };
  // Vuelta de Microsoft: la URL trae el código en el fragmento; se canjea
  // por una sesión antes de dibujar nada más.
  if (!S.user && msMode() && MS_RETURN) {
    UI.msConectando = true;
    render();
    await completarMicrosoft();
    return;
  }
  render();
}

/* ============================ Microsoft (MSAL) ============================ */

/* Se mira el fragmento UNA vez al cargar: después, el enrutador por hash lo
   reemplaza y MSAL ya no podría leerlo. */
const MS_RETURN = /[#&](code|error|id_token|state)=/.test(location.hash);
let msalApp = null;
let msalRedirect = null;   // resultado de handleRedirectPromise en esta carga
let msalRedirectError = null;

function cargarMsal() {
  if (window.msal) return Promise.resolve(window.msal);
  return new Promise(function (resolve, reject) {
    const s = document.createElement('script');
    s.src = 'assets/msal-browser.min.js';
    s.onload = function () { resolve(window.msal); };
    s.onerror = function () { reject(new Error('No se pudo cargar la librería de Microsoft.')); };
    document.head.appendChild(s);
  });
}

async function msalInstance() {
  if (msalApp) return msalApp;
  const msal = await cargarMsal();
  const app = new msal.PublicClientApplication({
    auth: {
      clientId: S.msClientId,
      authority: 'https://login.microsoftonline.com/' + S.msTenantId,
      redirectUri: location.origin + BASE + '/'
    },
    cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: false }
  });
  await app.initialize();
  // MSAL exige llamar handleRedirectPromise en CADA carga: además de
  // terminar el ingreso al volver de Microsoft, limpia el estado de un
  // intento anterior que quedó a medias (si no, el siguiente clic falla
  // con "interaction_in_progress").
  try { msalRedirect = await app.handleRedirectPromise(); }
  catch (err) { msalRedirectError = err; }
  msalApp = app;
  return app;
}

function limpiarEstadoMsal() {
  [localStorage, sessionStorage].forEach(function (st) {
    try {
      Object.keys(st).forEach(function (k) {
        if (k.indexOf('msal.') === 0 || k.indexOf('interaction.status') !== -1 || k.indexOf('login.microsoftonline.com') !== -1) st.removeItem(k);
      });
    } catch (e) { /* almacenamiento bloqueado */ }
  });
}

function describirErrorMs(err) {
  const code = (err && err.errorCode) || '';
  const msg = (err && err.message) || '';
  if (code === 'user_cancelled') return 'Cancelaste el inicio de sesión.';
  if (code === 'interaction_in_progress') return 'Ya hay un inicio de sesión en curso. Espera un momento o recarga la página.';
  if (/AADSTS50011/.test(msg)) return 'La dirección de esta página no está registrada como URI de redirección en Azure (plataforma SPA): ' + location.origin + BASE + '/';
  if (/AADSTS700016|AADSTS90002/.test(msg)) return 'El registro de la aplicación no existe en este inquilino. Revisa MS_CLIENT_ID y MS_TENANT_ID en el servidor.';
  return msg || 'No se pudo iniciar sesión con Microsoft.';
}

function limpiarFragmento() {
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* nada */ }
}

async function entrarConMicrosoft() {
  UI.authError = null;
  UI.msConectando = true;
  render();
  const request = { scopes: ['openid', 'profile', 'email'], prompt: 'select_account', domainHint: S.dominio };
  try {
    const app = await msalInstance();
    try {
      await app.loginRedirect(request);
    } catch (err) {
      // Estado viejo de un intento a medias: se limpia y se reintenta una vez.
      if (err && err.errorCode === 'interaction_in_progress') {
        limpiarEstadoMsal();
        await app.loginRedirect(request);
      } else {
        throw err;
      }
    }
  } catch (err) {
    UI.authError = describirErrorMs(err);
    UI.msConectando = false;
    render();
  }
}

async function completarMicrosoft() {
  try {
    await msalInstance();
    limpiarFragmento();
    if (msalRedirectError) throw msalRedirectError;
    const result = msalRedirect;
    if (!result || !result.idToken) { UI.msConectando = false; render(); return; }
    const r = await api('POST', '/api/auth?action=microsoft', { idToken: result.idToken });
    S.user = r.user;
    S.setupRequired = false;
    UI.view = null;
    await loadAll();
    if (r.seeded) toast('Presupuesto cargado: ' + r.seeded.clients + ' clientes, ' + r.seeded.people + ' personas, ' + r.seeded.budget + ' celdas.', 'ok');
  } catch (err) {
    limpiarFragmento();
    UI.authError = describirErrorMs(err);
    S.user = null;
  } finally {
    UI.msConectando = false;
    render();
  }
}

async function salirDeMicrosoft() {
  try { if (msalApp) await msalApp.clearCache(); } catch (e) { /* que falle la limpieza no impide salir */ }
  limpiarEstadoMsal();
}

/* ============================ navegación ============================ */

function navItems() {
  if (!S.user) return [];
  if (isManager()) {
    const items = [
      { id: 'semana', label: 'Semana' },
      { id: 'presupuesto', label: 'Presupuesto' },
      { id: 'equipo', label: 'Equipo' },
      { id: 'clientes', label: 'Clientes' }
    ];
    if (isGerente()) items.push({ id: 'personas', label: 'Personas' });
    items.push({ id: 'ajustes', label: 'Ajustes' });
    return items;
  }
  return [
    { id: 'misemana', label: 'Mi semana' },
    { id: 'mipresupuesto', label: 'Mi presupuesto' },
    { id: 'ajustes', label: 'Ajustes' }
  ];
}
function defaultView() { return isManager() ? 'semana' : 'misemana'; }
function setView(id) {
  const allowed = navItems().some(function (n) { return n.id === id; });
  UI.view = allowed ? id : defaultView();
  if (location.hash !== '#/' + UI.view) history.replaceState(null, '', location.pathname + '#/' + UI.view);
  render();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', function () {
  if (/[#&](code|error|id_token|state)=/.test(location.hash)) return;
  const id = location.hash.replace(/^#\/?/, '');
  if (S.user && id && id !== UI.view) setView(id);
});

/* ============================ render raíz ============================ */

function render() {
  const root = document.getElementById('root');
  if (!S.user) {
    root.innerHTML = '<div class="app">' + (msMode() ? renderLoginMicrosoft() : (S.setupRequired ? renderSetup() : renderLogin())) + franja() + '</div>';
    const first = root.querySelector('input');
    if (first && !UI.busy) first.focus();
    return;
  }
  if (!UI.view) {
    const fromHash = location.hash.replace(/^#\/?/, '');
    UI.view = navItems().some(function (n) { return n.id === fromHash; }) ? fromHash : defaultView();
  }
  root.innerHTML = '<div class="app">' + renderHeader() + '<main class="contenido">' + renderView() + '</main>' +
    '<footer class="rb-pie"><span>www.russellbedford.com.co</span><span>Russell Bedford Colombia</span></footer>' + franja() + '</div>' + renderModal();
}

function franja() {
  return '<div class="rb-franja"><span></span><span></span><span></span><span></span><span></span></div>';
}
function logo() {
  return '<a class="rb-logo" href="#" data-act="nav" data-view="' + (S.user ? defaultView() : '') + '" aria-label="Russell Bedford"><img src="assets/logo-rb-azul.png" alt="Russell Bedford · taking you further"></a>';
}

/* ============================ acceso ============================ */

function renderLogin() {
  return '<div class="acceso"><div class="rb-tarjeta">' + logo() +
    '<h1>Horas por <b>cliente</b></h1><p class="lead sec">Entra con el correo y la contraseña que te entregó el gerente.</p>' +
    (UI.authError ? '<div class="rb-alerta rb-alerta--error" style="margin-bottom:14px">' + esc(UI.authError) + '</div>' : '') +
    '<form id="form-login">' +
    '<div class="campo"><label class="rb-etiqueta" for="login-email">Correo</label><input class="rb-input" id="login-email" type="email" name="email" autocomplete="username" required></div>' +
    '<div class="campo"><label class="rb-etiqueta" for="login-password">Contraseña</label><input class="rb-input" id="login-password" type="password" name="password" autocomplete="current-password" required></div>' +
    '<button class="rb-btn rb-btn--primario" type="submit"' + (UI.busy ? ' disabled' : '') + '>' + (UI.busy ? 'Entrando…' : 'Entrar') + '</button>' +
    '</form>' +
    '<p class="sec" style="margin-top:16px">¿Olvidaste tu contraseña? Pídele al gerente una nueva desde Personas.</p>' +
    '</div></div>';
}

function renderLoginMicrosoft() {
  const ms = '<svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>';
  return '<div class="acceso"><div class="rb-tarjeta">' + logo() +
    '<h1>Horas por <b>cliente</b></h1><p class="lead sec">Entra con tu cuenta institucional <b class="az">@' + esc(S.dominio) + '</b> de Microsoft 365.</p>' +
    (UI.authError ? '<div class="rb-alerta rb-alerta--error" style="margin-bottom:14px">' + esc(UI.authError) + '</div>' : '') +
    (S.setupRequired ? '<div class="rb-alerta rb-alerta--info" style="margin-bottom:14px">Aún no hay cuentas: la primera persona que entre quedará como gerente y se cargará el presupuesto 2026.</div>' : '') +
    '<button class="rb-btn rb-btn--primario" data-act="ms-login"' + (UI.msConectando ? ' disabled' : '') + '>' + ms + (UI.msConectando ? 'Conectando…' : 'Entrar con Microsoft') + '</button>' +
    '<p class="sec" style="margin-top:16px">La sesión queda en este navegador. No la dejes abierta en equipos compartidos.</p>' +
    '</div></div>';
}

function renderSetup() {
  return '<div class="acceso"><div class="rb-tarjeta">' + logo() +
    '<h1>Primera <b>configuración</b></h1><p class="lead sec">Aún no hay cuentas. Crea la cuenta del gerente; después podrás dar acceso al resto del equipo.</p>' +
    (UI.authError ? '<div class="rb-alerta rb-alerta--error" style="margin-bottom:14px">' + esc(UI.authError) + '</div>' : '') +
    '<form id="form-setup">' +
    '<div class="campo"><label class="rb-etiqueta" for="setup-name">Nombre</label><input class="rb-input" id="setup-name" type="text" name="name" required maxlength="120"></div>' +
    '<div class="campo"><label class="rb-etiqueta" for="setup-email">Correo</label><input class="rb-input" id="setup-email" type="email" name="email" autocomplete="username" required></div>' +
    '<div class="campo"><label class="rb-etiqueta" for="setup-password">Contraseña (mínimo 8 caracteres)</label><input class="rb-input" id="setup-password" type="password" name="password" autocomplete="new-password" minlength="8" required></div>' +
    '<div class="campo"><label class="check"><input type="checkbox" name="seed" checked> Cargar el presupuesto de horas 2026 (clientes, equipo y semanas del Excel)</label></div>' +
    '<button class="rb-btn rb-btn--primario" type="submit"' + (UI.busy ? ' disabled' : '') + '>' + (UI.busy ? 'Creando…' : 'Crear cuenta de gerente') + '</button>' +
    '</form></div></div>';
}

/* ============================ cabecera ============================ */

function renderHeader() {
  const nav = navItems().map(function (n) {
    return '<button class="' + (UI.view === n.id ? 'activo' : '') + '" data-act="nav" data-view="' + n.id + '">' + esc(n.label) + '</button>';
  }).join('');
  return '<header class="rb-header">' + logo() + '<nav class="nav">' + nav + '</nav>' +
    '<div class="usuario"><div class="avatar">' + esc(initials(S.user.name)) + '</div>' +
    '<div><div class="nombre">' + esc(S.user.name) + '</div><div class="rol">' + ROLE_LABELS[S.user.role] + '</div></div>' +
    '<button class="icono-btn" data-act="logout" title="Cerrar sesión">' + ICON.logout + '</button></div></header>';
}

function titulo(html, sub, acciones) {
  return '<div class="titulo-fila"><div><h1>' + html + '</h1>' + (sub ? '<p class="sub sec">' + sub + '</p>' : '') + '</div>' +
    (acciones ? '<div class="acciones">' + acciones + '</div>' : '') + '</div>';
}

function renderView() {
  switch (UI.view) {
    case 'semana': return renderSemana(false);
    case 'misemana': return renderSemana(true);
    case 'presupuesto': return renderPresupuesto(false);
    case 'mipresupuesto': return renderPresupuesto(true);
    case 'equipo': return renderEquipo();
    case 'clientes': return renderClientes();
    case 'personas': return renderPersonas();
    case 'ajustes': return renderAjustes();
    default: return '';
  }
}

/* ============================ Semana ============================ */

function selectorSemana() {
  const cur = currentWeekIdx();
  const opts = S.weeks.map(function (w) {
    return '<option value="' + w.idx + '"' + (w.idx === UI.weekIdx ? ' selected' : '') + '>' + esc(weekTag(w) + ' · ' + w.month + ' ' + w.label.toLowerCase()) + (w.idx === cur ? ' (actual)' : '') + '</option>';
  }).join('');
  const first = S.weeks.length ? S.weeks[0].idx : 0, last = S.weeks.length ? S.weeks[S.weeks.length - 1].idx : 0;
  return '<div class="semana-sel">' +
    '<button class="icono-btn" data-act="semana-prev" title="Semana anterior"' + (UI.weekIdx <= first ? ' disabled' : '') + '>' + ICON.left + '</button>' +
    '<select class="rb-select" data-act-change="semana">' + opts + '</select>' +
    '<button class="icono-btn" data-act="semana-next" title="Semana siguiente"' + (UI.weekIdx >= last ? ' disabled' : '') + '>' + ICON.right + '</button>' +
    (cur >= 0 && cur !== UI.weekIdx ? '<button class="rb-btn rb-btn--texto rb-btn--sm" data-act="semana-hoy">Ir a la actual</button>' : '') +
    '</div>';
}

/* Los siete días de una semana para un cliente y una persona, en miniatura. */
function diasMini(clientId, personId, w) {
  return '<div class="dias-mini">' + weekDays(w).map(function (d, i) {
    const c = cellOf(clientId, personId, d);
    const con = c && (c.hours != null || c.phase);
    const txt = c && c.hours != null ? fmtH(c.hours) : (c && c.phase === 'vacaciones' ? 'V' : '');
    return '<span class="dm' + diaClases(d) + (con ? ' con ph-' + (c.phase || 'none') : '') + '" title="' + esc(diaTitulo(d)) + (c && c.hours != null ? ': ' + fmtH(c.hours) + ' h' : '') + '"><i>' + DIAS[i] + '</i><b>' + txt + '</b></span>';
  }).join('') + '</div>';
}

function renderSemana(mine) {
  if (!S.weeks.length) {
    return titulo(mine ? 'Mi <b>semana</b>' : 'Asignación <b>semanal</b>') +
      '<div class="vacio"><h3>No hay semanas cargadas</h3><p>' + (isGerente() ? 'Carga el presupuesto base desde Ajustes.' : 'El gerente aún no ha cargado el presupuesto.') + '</p></div>';
  }
  const w = weekByIdx(UI.weekIdx) || S.weeks[0];
  const editable = !mine && isManager();
  const people = mine ? [S.user].map(function (u) { return personById(u.id) || u; }) : teamPeople();
  const filas = rowsWeek(w.idx);
  const total = filas.reduce(function (a, r) { return a + (r.hours || 0); }, 0);
  const sobre = sobrecargados(w.idx, people);
  const sinHoras = people.filter(function (p) { return !filas.some(function (r) { return r.personId === p.id; }); }).length;
  const clientesSemana = {};
  filas.forEach(function (r) { clientesSemana[r.clientId] = true; });
  const dias = weekDays(w);
  const festivos = dias.filter(isHoliday);

  const kpis = mine
    ? '<div class="kpis">' +
      '<div class="rb-kpi ' + (hoursOf(S.user.id, w.idx) > w.capacity ? 'aviso' : 'ok') + '"><div class="valor num">' + fmtH(hoursOf(S.user.id, w.idx)) + ' <small>de ' + fmtH(w.capacity) + ' h</small></div><div class="etiqueta">Horas asignadas esta semana</div></div>' +
      '<div class="rb-kpi"><div class="valor num">' + Object.keys(clientesSemana).length + '</div><div class="etiqueta">Clientes</div></div>' +
      '<div class="rb-kpi"><div class="valor num">' + fmtH(w.capacity) + ' <small>h</small></div><div class="etiqueta">Cargabilidad de la semana</div></div>' +
      '</div>'
    : '<div class="kpis">' +
      '<div class="rb-kpi"><div class="valor num">' + fmtH(total) + ' <small>de ' + fmtH(w.capacity * people.length) + ' h</small></div><div class="etiqueta">Horas asignadas al equipo</div></div>' +
      '<div class="rb-kpi"><div class="valor num">' + Object.keys(clientesSemana).length + '</div><div class="etiqueta">Clientes con horas</div></div>' +
      '<div class="rb-kpi ' + (sobre.length ? 'aviso' : 'ok') + '"><div class="valor num">' + sobre.length + '</div><div class="etiqueta">Personas sobre las ' + fmtH(w.capacity) + ' h</div></div>' +
      '<div class="rb-kpi ' + (sinHoras ? 'aviso' : '') + '"><div class="valor num">' + sinHoras + '</div><div class="etiqueta">Personas sin horas asignadas</div></div>' +
      '</div>';

  const alerta = sobre.length
    ? '<div class="rb-alerta rb-alerta--aviso" style="margin-bottom:18px"><b>Sobrecarga en la ' + esc(weekTag(w).toLowerCase()) + ':</b> ' +
      sobre.map(function (p) { return esc(p.name) + ' (' + fmtH(hoursOf(p.id, w.idx)) + ' h)'; }).join(', ') + ' supera' + (sobre.length === 1 ? '' : 'n') + ' las ' + fmtH(w.capacity) + ' h.</div>'
    : '';

  const cards = people.map(function (p) {
    const mias = {};
    filas.forEach(function (r) { if (r.personId === p.id) mias[r.clientId] = (mias[r.clientId] || 0) + (r.hours || 0); });
    const clientes = Object.keys(mias).map(Number).sort(function (a, b) { return mias[b] - mias[a]; });
    const h = hoursOf(p.id, w.idx);
    const pct = w.capacity ? Math.min(100, Math.round(h / w.capacity * 100)) : 0;
    const lineas = clientes.length ? clientes.map(function (cid) {
      const c = clientById(cid);
      const celdas = weekCells(cid, p.id, w).filter(Boolean);
      const fases = {}; celdas.forEach(function (x) { if (x.phase) fases[x.phase] = true; });
      const nota = (celdas.find(function (x) { return x.note; }) || {}).note;
      const vac = celdas.some(function (x) { return x.phase === 'vacaciones'; }) && !mias[cid];
      return '<div class="linea' + (editable ? ' editable' : '') + '"' + (editable ? ' data-act="editar-dias" data-c="' + cid + '" data-p="' + p.id + '" data-w="' + w.idx + '"' : '') + '>' +
        '<div class="cli">' + esc(c ? c.name : '') + (c && c.sede ? ' <span class="sec">· ' + esc(c.sede) + '</span>' : '') + (nota ? '<span class="nota">' + esc(nota) + '</span>' : '') + '</div>' +
        diasMini(cid, p.id, w) +
        '<span class="ph ph-' + (Object.keys(fases)[0] || '') + '">' + esc(Object.keys(fases).length ? Object.keys(fases).map(phaseLabel).join(' / ') : 'Sin fase') + '</span>' +
        '<span class="hrs num">' + (vac ? 'Vac.' : fmtH(mias[cid]) + ' h') + '</span></div>';
    }).join('') : '<div class="linea-vacia">Sin horas asignadas esta semana.</div>';
    const sobreP = h > w.capacity;
    return '<div class="rb-tarjeta persona-card' + (sobreP ? ' sobre' : '') + '">' +
      '<div class="persona-head"><div class="avatar ' + (p.role === 'junior' ? 'gris' : p.role === 'gerente' ? 'azul' : '') + '">' + esc(initials(p.name)) + '</div>' +
      '<div><div class="nombre">' + esc(p.name) + '</div><div class="meta">' + ROLE_LABELS[p.role] + ' · ' + clientes.length + ' cliente' + (clientes.length === 1 ? '' : 's') + '</div></div>' +
      '<div class="total"><div class="h num' + (sobreP ? ' sobre' : '') + '">' + fmtH(h) + ' h</div><div class="c">de ' + fmtH(w.capacity) + '</div></div></div>' +
      '<div class="barra"><i class="' + barraClass(h, w.capacity) + '" style="width:' + pct + '%"></i></div>' +
      (sobreP ? '<div class="aviso-sobre">' + ICON.warn + 'Sobrecarga: ' + fmtH(h - w.capacity) + ' h por encima de la cargabilidad.</div>' : '') +
      '<div class="lineas">' + lineas + '</div>' +
      (editable ? '<button class="rb-btn rb-btn--secundario rb-btn--sm" data-act="agregar" data-p="' + p.id + '" data-w="' + w.idx + '">' + ICON.plus + 'Asignar cliente</button>' : '') +
      '</div>';
  }).join('');

  const sub = esc(weekTag(w)) + ' · ' + esc(w.label.toLowerCase()) + ' de ' + esc(w.month.toLowerCase()) + ' · cargabilidad ' + fmtH(w.capacity) + ' h por persona' +
    (festivos.length ? ' · festivo: ' + festivos.map(function (d) { return esc(DIAS_LARGO[dow(d)].toLowerCase() + ' ' + fmtDate(d)); }).join(', ') : '') +
    (editable ? '. Haz clic en una línea para repartir las horas por día.' : '.');
  return titulo(mine ? 'Mi <b>semana</b>' : 'Asignación <b>semanal</b>', sub, selectorSemana()) + kpis + alerta +
    '<div class="personas-semana">' + cards + '</div>' + leyendaFases();
}

function leyendaFases() {
  return '<div class="leyenda">' + PHASE_DEFS.map(function (p) {
    return '<span><i class="ph-' + p.id + '" style="background:var(--ph-' + p.id + ')"></i>' + esc(p.label) + '</span>';
  }).join('') + '<span><i class="lg-fin"></i>Sábado y domingo</span><span><i class="lg-fest"></i>Festivo</span></div>';
}

/* ============================ Presupuesto anual ============================ */

function cabeceraSemanas(fijas, derecha) {
  const cur = currentWeekIdx();
  const semanas = visibleWeeks();
  const editable = isGerente();
  const meses = [];
  semanas.forEach(function (w) {
    const last = meses[meses.length - 1];
    if (last && last.name === w.month) last.span++; else meses.push({ name: w.month, span: 1 });
  });
  const r1 = '<tr>' + fijas.map(function (c, i) { return '<th class="' + (i === 0 ? 'fijo' : 'fijo2') + '" rowspan="3" style="vertical-align:bottom">' + c + '</th>'; }).join('') +
    meses.map(function (m) { return '<th colspan="' + m.span + '">' + esc(m.name) + '</th>'; }).join('') +
    (derecha ? '<th class="total" rowspan="3" style="vertical-align:bottom">' + derecha + '</th>' : '') + '</tr>';
  const r2 = '<tr>' + semanas.map(function (w) { return '<th class="' + (w.idx === cur ? 'actual-h' : '') + (editable ? ' editable-h' : '') + '"' + (editable ? ' data-act="editar-semana" data-w="' + w.idx + '"' : '') + ' title="Semana del ' + fmtDate(w.start) + (editable ? ' · clic para ajustar' : '') + '">' + esc(w.label.replace(/^Del\s+/i, '')) + '</th>'; }).join('') + '</tr>';
  const r3 = '<tr>' + semanas.map(function (w) { return '<th class="' + (w.idx === cur ? 'actual-h' : '') + (editable ? ' editable-h' : '') + '"' + (editable ? ' data-act="editar-semana" data-w="' + w.idx + '"' : '') + ' title="Cargabilidad: horas disponibles">' + fmtH(w.capacity) + '</th>'; }).join('') + '</tr>';
  return '<thead>' + r1 + r2 + r3 + '</thead>';
}

function filasPresupuesto(mine) {
  const seen = {};
  const rows = [];
  function add(c, p) { const k = c + '|' + p; if (seen[k]) return; seen[k] = true; rows.push({ clientId: c, personId: p }); }
  S.budget.forEach(function (r) { add(r.clientId, r.personId); });
  if (!mine) UI.filasExtra.forEach(function (r) { add(r.clientId, r.personId); });
  return rows.map(function (r) { return { clientId: r.clientId, personId: r.personId, client: clientById(r.clientId), person: personById(r.personId) }; })
    .filter(function (r) { return r.client && r.person; })
    .sort(function (a, b) {
      return sedeOrden(a.client.sede) - sedeOrden(b.client.sede) || a.client.name.localeCompare(b.client.name) ||
        roleOrder(a.person.role) - roleOrder(b.person.role) || a.person.name.localeCompare(b.person.name);
    });
}
function sedeOrden(sede) { const i = S.sedes.indexOf(sede); return i === -1 ? 99 : i; }

/* Cabecera del tablero por días: mes · semana (número ISO + etiqueta) · día. */
function cabeceraDias(fijas, derecha, personasParaAlerta) {
  const semanas = visibleWeeks();
  const editable = isGerente();
  const meses = [];
  semanas.forEach(function (w) {
    const last = meses[meses.length - 1];
    if (last && last.name === w.month) last.span += 8; else meses.push({ name: w.month, span: 8 });
  });
  const r1 = '<tr>' + fijas.map(function (c, i) { return '<th class="' + (i === 0 ? 'fijo' : 'fijo2') + '" rowspan="3" style="vertical-align:bottom">' + c + '</th>'; }).join('') +
    meses.map(function (m) { return '<th colspan="' + m.span + '">' + esc(m.name) + '</th>'; }).join('') +
    (derecha ? '<th class="total" rowspan="3" style="vertical-align:bottom">' + derecha + '</th>' : '') + '</tr>';
  const cur = currentWeekIdx();
  const r2 = '<tr>' + semanas.map(function (w) {
    const sobre = sobrecargados(w.idx, personasParaAlerta || []);
    return '<th colspan="8" class="sem' + (w.idx === cur ? ' actual-h' : '') + (editable ? ' editable-h' : '') + (sobre.length ? ' sobre-h' : '') + '"' +
      (editable ? ' data-act="editar-semana" data-w="' + w.idx + '"' : '') +
      ' title="' + esc(weekTag(w) + ' · ' + w.label + ' · cargabilidad ' + fmtH(w.capacity) + ' h') + (sobre.length ? ' · sobrecarga: ' + esc(sobre.map(function (p) { return p.name + ' (' + fmtH(hoursOf(p.id, w.idx)) + ' h)'; }).join(', ')) : '') + (editable ? ' · clic para ajustar' : '') + '">' +
      (sobre.length ? ICON.warn : '') + esc(weekTag(w)) + ' <span class="sec-h">' + esc(w.label.replace(/^Del\s+/i, '')) + ' · ' + fmtH(w.capacity) + ' h</span></th>';
  }).join('') + '</tr>';
  const r3 = '<tr>' + semanas.map(function (w) {
    return weekDays(w).map(function (d, i) {
      return '<th class="dia' + diaClases(d) + '" title="' + esc(diaTitulo(d)) + '">' + DIAS[i] + '<small>' + Number(d.slice(8, 10)) + '</small></th>';
    }).join('') + '<th class="sigma" title="Total de la semana">Σ</th>';
  }).join('') + '</tr>';
  return '<thead>' + r1 + r2 + r3 + '</thead>';
}

function renderPresupuesto(mine) {
  const editable = !mine && isManager();
  let rows = filasPresupuesto(mine);
  if (!mine) {
    if (UI.filtro.persona !== 'all') rows = rows.filter(function (r) { return String(r.personId) === UI.filtro.persona; });
    if (UI.filtro.cliente !== 'all') rows = rows.filter(function (r) { return String(r.clientId) === UI.filtro.cliente; });
  }
  if (UI.filtro.sede !== 'all') rows = rows.filter(function (r) { return UI.filtro.sede === 'none' ? !r.client.sede : r.client.sede === UI.filtro.sede; });
  const semanas = visibleWeeks();
  const personas = mine ? [personById(S.user.id) || S.user] : teamPeople();
  const filtros = '<div class="filtros">' + selectorMes() +
    '<select class="rb-select" data-filtro="sede"><option value="all">Todas las sedes</option>' + S.sedes.map(function (x) { return '<option value="' + esc(x) + '"' + (UI.filtro.sede === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '<option value="none"' + (UI.filtro.sede === 'none' ? ' selected' : '') + '>Sin sede</option></select>' +
    (mine ? '' :
    '<select class="rb-select" data-filtro="persona"><option value="all">Todas las personas</option>' + activePeople().map(function (p) { return '<option value="' + p.id + '"' + (UI.filtro.persona === String(p.id) ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select>' +
    '<select class="rb-select" data-filtro="cliente"><option value="all">Todos los clientes</option>' + S.clients.map(function (c) { return '<option value="' + c.id + '"' + (UI.filtro.cliente === String(c.id) ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select>' +
    (editable ? '<button class="rb-btn rb-btn--secundario rb-btn--sm" data-act="agregar-fila">' + ICON.plus + 'Agregar fila</button>' : '')) +
    '</div>';

  let grid;
  if (!S.weeks.length) {
    grid = '<div class="vacio"><h3>No hay presupuesto cargado</h3><p>' + (isGerente() ? 'Carga el presupuesto base desde Ajustes.' : 'El gerente aún no ha cargado el presupuesto.') + '</p></div>';
  } else if (!rows.length) {
    grid = '<div class="vacio"><h3>' + (mine ? 'No tienes horas presupuestadas' : 'Sin filas para mostrar') + '</h3><p>' + (mine ? 'Cuando te asignen horas aparecerán aquí.' : 'Cambia los filtros o agrega una fila.') + '</p></div>';
  } else {
    const nCols = 2 + semanas.length * 8;
    let lastSede = '__', lastClient = null;
    const body = rows.map(function (r) {
      let out = '';
      const sede = r.client.sede || null;
      if (sede !== lastSede) {
        out += '<tr class="grupo"><td colspan="' + nCols + '">' + esc(sedeLabel(sede)) + '</td></tr>';
        lastSede = sede; lastClient = null;
      }
      let total = 0;
      const cells = semanas.map(function (w) {
        let semTotal = 0;
        const dias = weekDays(w).map(function (d) {
          const cell = cellOf(r.clientId, r.personId, d);
          let txt = '', cls = 'celda' + diaClases(d);
          let title = esc(r.client.name) + ' · ' + esc(r.person.name) + ' · ' + esc(diaTitulo(d));
          if (cell) {
            if (cell.hours != null) { txt = fmtH(cell.hours); semTotal += cell.hours; }
            else if (cell.phase === 'vacaciones') txt = 'V';
            else if (cell.note) txt = '…';
            cls += ' ph-' + (cell.phase || 'none');
            title += (cell.hours != null ? ': ' + fmtH(cell.hours) + ' h' : '') + (cell.phase ? ' · ' + esc(phaseLabel(cell.phase)) : '') + (cell.note ? ' · ' + esc(cell.note) : '');
          }
          if (editable) cls += ' editable';
          return '<td class="' + cls + '" title="' + title + '"' + (editable ? ' data-act="editar-dias" data-c="' + r.clientId + '" data-p="' + r.personId + '" data-w="' + w.idx + '"' : '') + '><span>' + txt + '</span></td>';
        }).join('');
        total += semTotal;
        const hp = hoursOf(r.personId, w.idx);
        const sobre = hp > w.capacity;
        return dias + '<td class="sigma num' + (sobre ? ' sobre' : '') + '" title="' + esc(r.person.name) + ' en la ' + esc(weekTag(w).toLowerCase()) + ': ' + fmtH(hp) + ' de ' + fmtH(w.capacity) + ' h en todos los clientes' + (sobre ? ' · SOBRECARGA' : '') + '"><span>' + (semTotal ? fmtH(semTotal) : '') + '</span></td>';
      }).join('');
      const cliente = '<td class="fijo" title="' + esc(r.client.name) + '">' + (!mine && r.clientId === lastClient ? '' : esc(r.client.name)) + '</td>';
      lastClient = r.clientId;
      const persona = mine ? '' : '<td class="fijo2"><span class="persona"><span class="avatar sm ' + (r.person.role === 'junior' ? 'gris' : '') + '">' + esc(initials(r.person.name)) + '</span> ' + esc(r.person.name) + ' <span class="sec">' + ROLE_LABELS[r.person.role] + '</span></span></td>';
      return out + '<tr>' + cliente + persona + cells + '<td class="total num">' + fmtH(total) + '</td></tr>';
    }).join('');
    grid = '<div class="cuadricula"><table class="wgrid dias" style="--fijo-w:' + (mine ? '0px' : '210px') + '">' + cabeceraDias(mine ? ['Cliente'] : ['Cliente', 'Funcionario'], 'Total', personas) + '<tbody>' + body + '</tbody></table></div>';
  }
  const sub = (mine ? 'Tus horas por cliente y día. ' : 'Horas por cliente, funcionario y día, agrupadas por sede. ') + esc(rangoCalendario()) + '.' +
    (editable ? ' Haz clic en un día para repartir la semana' + (isGerente() ? ' o en el encabezado de una semana para ajustar su cargabilidad.' : '.') : '');
  return titulo(mine ? 'Mi <b>presupuesto</b>' : 'Presupuesto <b>por días</b>', sub) + filtros + grid + leyendaFases();
}

/* ============================ Equipo ============================ */

function renderEquipo() {
  const cur = currentWeekIdx();
  const w = weekByIdx(cur);
  // El equipo que recibe horas: gerentes solo si tienen presupuesto.
  const people = sortPeople(S.people).filter(function (p) { return p.role !== 'gerente' || S.budget.some(function (r) { return r.personId === p.id; }); });
  const cards = people.map(function (p) {
    const clientes = {};
    let total = 0;
    S.budget.forEach(function (r) { if (r.personId === p.id) { clientes[r.clientId] = true; total += r.hours || 0; } });
    const h = w ? hoursOf(p.id, cur) : 0;
    return '<div class="rb-tarjeta equipo-card' + (p.active === false ? ' inactivo' : '') + '" data-act="ver-persona" data-id="' + p.id + '">' +
      '<div class="avatar ' + (p.role === 'junior' ? 'gris' : p.role === 'gerente' ? 'azul' : '') + '">' + esc(initials(p.name)) + '</div><div style="min-width:0;flex:1">' +
      '<div class="nombre">' + esc(p.name) + '<span class="rol ' + p.role + '">' + ROLE_LABELS[p.role] + '</span></div>' +
      '<div class="correo">' + esc(p.email || 'Sin correo registrado') + '</div>' +
      '<div class="stats">' + (w ? '<span class="num"><b class="az">' + fmtH(h) + '</b> / ' + fmtH(w.capacity) + ' h esta semana</span>' : '') +
      '<span>' + Object.keys(clientes).length + ' clientes</span><span class="num">' + fmtH(total) + ' h en el periodo</span></div></div></div>';
  }).join('');
  const conPresupuesto = people.filter(function (p) { return p.active !== false && S.budget.some(function (r) { return r.personId === p.id; }); });
  return titulo('Carga del <b>equipo</b>', 'Horas asignadas por semana frente a la cargabilidad. Haz clic en una persona para ver su semana.') +
    '<div class="equipo-grid">' + cards + '</div>' +
    '<h2 style="margin-bottom:4px">Mapa de carga semanal</h2><p class="sec" style="margin-bottom:12px">Suma de horas por semana. Naranja: por encima de las ' + fmtH(S.capacity) + ' h de cargabilidad.</p>' +
    '<div class="filtros">' + selectorMes() + '</div>' +
    renderMapaCarga(conPresupuesto) +
    '<div class="leyenda"><span><i class="carga-1"></i>Menos del 40 %</span><span><i class="carga-2"></i>40 a 70 %</span><span><i class="carga-3"></i>70 a 90 %</span><span><i class="carga-4"></i>90 a 100 %</span><span><i class="carga-sobre"></i>Sobre la cargabilidad</span><span><i style="background:var(--ph-vacaciones)"></i>Vacaciones</span></div>';
}

function renderMapaCarga(people) {
  if (!S.weeks.length) return '<p class="sec">No hay semanas cargadas.</p>';
  const cur = currentWeekIdx();
  const rows = people.map(function (p) {
    let total = 0;
    const cells = visibleWeeks().map(function (w) {
      const mias = rowsWeek(w.idx).filter(function (r) { return r.personId === p.id; });
      const h = mias.reduce(function (a, r) { return a + (r.hours || 0); }, 0);
      const vac = mias.some(function (r) { return r.phase === 'vacaciones'; });
      total += h;
      let cls = cargaClass(h, w.capacity);
      if (vac && !h) cls = 'ph-vacaciones';
      return '<td class="celda ' + cls + (w.idx === cur ? ' actual' : '') + '" title="' + esc(p.name) + ' · ' + esc(weekTitle(w)) + ': ' + fmtH(h) + ' de ' + fmtH(w.capacity) + ' h"><span>' + (h ? fmtH(h) : (vac ? 'Vac.' : '')) + '</span></td>';
    }).join('');
    return '<tr><td class="fijo2" style="left:0"><span class="persona"><span class="avatar sm ' + (p.role === 'junior' ? 'gris' : '') + '">' + esc(initials(p.name)) + '</span> ' + esc(p.name) + ' <span class="sec">' + ROLE_LABELS[p.role] + '</span></span></td>' + cells + '<td class="total num">' + fmtH(total) + '</td></tr>';
  }).join('');
  return '<div class="cuadricula"><table class="wgrid" style="--fijo-w:0px">' + cabeceraSemanas(['Persona'], 'Total') + '<tbody>' + rows + '</tbody></table></div>';
}

/* ============================ Clientes ============================ */

function renderClientes() {
  const cur = currentWeekIdx();
  let lista = S.clients.slice().sort(function (a, b) { return (a.active === false) - (b.active === false) || sedeOrden(a.sede) - sedeOrden(b.sede) || a.name.localeCompare(b.name); });
  if (UI.filtro.sede !== 'all') lista = lista.filter(function (c) { return UI.filtro.sede === 'none' ? !c.sede : c.sede === UI.filtro.sede; });
  const rows = lista.map(function (c) {
    const team = {};
    let total = 0, semana = 0;
    S.budget.forEach(function (r) { if (r.clientId === c.id) { team[r.personId] = true; total += r.hours || 0; } });
    rowsWeek(cur).forEach(function (r) { if (r.clientId === c.id) semana += r.hours || 0; });
    const names = sortPeople(Object.keys(team).map(function (id) { return personById(Number(id)); }).filter(Boolean));
    return '<tr' + (c.active === false ? ' class="inactivo"' : '') + '>' +
      '<td><b class="az">' + esc(c.name) + '</b>' + (c.active === false ? ' <span class="estado gris">Inactivo</span>' : '') + '</td>' +
      '<td>' + (c.sede ? '<span class="sede ' + (S.sedes.indexOf(c.sede) === 0 ? 'a' : 'b') + '">' + esc(c.sede) + '</span>' : '<span class="estado aviso">Sin sede</span>') + '</td>' +
      '<td>' + (names.length ? names.map(function (p) { return '<span class="persona"><span class="avatar sm ' + (p.role === 'junior' ? 'gris' : '') + '">' + esc(initials(p.name)) + '</span>' + esc(p.name) + '</span>'; }).join('') : '<span class="sec">Sin equipo asignado</span>') + '</td>' +
      '<td class="num">' + (cur >= 0 ? fmtH(semana) : '—') + '</td><td class="num">' + fmtH(total) + '</td>' +
      '<td style="text-align:right;white-space:nowrap">' +
      '<button class="rb-btn rb-btn--texto rb-btn--sm" data-act="ver-cliente" data-id="' + c.id + '">Ver horas</button>' +
      (isManager() ? '<button class="icono-btn" data-act="editar-cliente" data-id="' + c.id + '" title="Editar nombre y sede" style="margin-left:6px">' + ICON.edit + '</button>' : '') +
      '</td></tr>';
  }).join('');
  const filtros = '<div class="filtros"><select class="rb-select" data-filtro="sede"><option value="all">Todas las sedes</option>' +
    S.sedes.map(function (x) { return '<option value="' + esc(x) + '"' + (UI.filtro.sede === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') +
    '<option value="none"' + (UI.filtro.sede === 'none' ? ' selected' : '') + '>Sin sede</option></select></div>';
  const sinSede = S.clients.filter(function (c) { return !c.sede && c.active !== false; }).length;
  return titulo('<b>Clientes</b>', S.clients.length + ' clientes · ' + S.sedes.join(' y ') + (sinSede ? ' · ' + sinSede + ' sin sede asignada' : ''), isManager() ? '<button class="rb-btn rb-btn--primario rb-btn--sm" data-act="nuevo-cliente">' + ICON.plus + 'Nuevo cliente</button>' : '') +
    filtros +
    '<div class="tabla-wrap"><table class="rb-tabla"><thead><tr><th>Cliente</th><th>Sede</th><th>Equipo asignado</th><th class="num">Horas esta semana</th><th class="num">Horas del periodo</th><th></th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="6" class="sec" style="text-align:center;padding:30px">Sin clientes.</td></tr>') + '</tbody></table></div>';
}

/* ============================ Personas (gerente) ============================ */

function renderPersonas() {
  const rows = sortPeople(S.people).map(function (p) {
    const acceso = p.active === false ? '<span class="estado gris">Inactiva</span>'
      : msMode() ? (p.email ? '<span class="estado ok">Con correo</span>' : '<span class="estado aviso">Sin correo</span>')
      : !p.email || !p.hasPassword ? '<span class="estado aviso">Sin acceso</span>'
      : p.mustChangePassword ? '<span class="estado gris">Debe cambiar clave</span>'
      : '<span class="estado ok">Activa</span>';
    const clientes = {};
    S.budget.forEach(function (r) { if (r.personId === p.id) clientes[r.clientId] = true; });
    return '<tr' + (p.active === false ? ' class="inactivo"' : '') + '>' +
      '<td><span class="persona"><span class="avatar sm ' + (p.role === 'junior' ? 'gris' : p.role === 'gerente' ? 'azul' : '') + '">' + esc(initials(p.name)) + '</span><b class="az">' + esc(p.name) + '</b>' + (p.id === S.user.id ? ' <span class="sec">(tú)</span>' : '') + '</span></td>' +
      '<td>' + esc(p.email || '—') + '</td>' +
      '<td><span class="rol ' + p.role + '">' + ROLE_LABELS[p.role] + '</span></td>' +
      '<td>' + acceso + '</td>' +
      '<td class="num">' + Object.keys(clientes).length + '</td>' +
      '<td style="text-align:right;white-space:nowrap">' +
      '<button class="icono-btn" data-act="editar-persona" data-id="' + p.id + '" title="Editar">' + ICON.edit + '</button> ' +
      (msMode() ? '' : '<button class="icono-btn" data-act="clave-persona" data-id="' + p.id + '" title="Asignar contraseña">' + ICON.key + '</button> ') +
      (p.id === S.user.id ? '' :
        '<button class="icono-btn" data-act="fusionar-persona" data-id="' + p.id + '" title="Fusionar con otra persona (traspasa sus horas y la elimina)">' + ICON.merge + '</button> ' +
        '<button class="icono-btn peligro" data-act="eliminar-persona" data-id="' + p.id + '" title="Eliminar">' + ICON.trash + '</button>') +
      '</td></tr>';
  }).join('');
  return titulo('<b>Personas</b>', msMode() ? 'Cada persona entra con su cuenta de Microsoft @' + esc(S.dominio) + '. Registra aquí su correo para que al entrar se reconozca con su rol; quien entre sin estar registrada queda como junior.' : 'Cuentas y roles del equipo. Para dar acceso, registra el correo y asigna una contraseña temporal.', '<button class="rb-btn rb-btn--primario rb-btn--sm" data-act="nueva-persona">' + ICON.plus + 'Nueva persona</button>') +
    '<div class="tabla-wrap"><table class="rb-tabla"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Acceso</th><th class="num">Clientes</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<p class="sec" style="margin-top:14px"><b>Gerente:</b> todo, incluida esta pantalla. <b>Senior:</b> ve y asigna horas a todo el equipo. <b>Junior:</b> solo ve sus propias horas.</p>' +
    '<p class="sec" style="margin-top:6px">¿Una persona quedó repetida (una con las horas del Excel y otra creada al entrar con Microsoft)? Usa <b>Fusionar</b> en la repetida y elige a cuál cuenta traspasar sus horas; la repetida se elimina y la que queda conserva correo y horas.</p>';
}

/* ============================ Ajustes ============================ */

function renderAjustes() {
  const seed = isGerente()
    ? '<div class="rb-tarjeta" style="max-width:560px;margin-top:16px"><h2>Datos base</h2><p class="sec" style="margin:4px 0 14px">Vuelve a cargar el presupuesto de horas 2026 desde el archivo base. Actualiza semanas, clientes y celdas; no borra cuentas ni horas asignadas en otras celdas.</p>' +
      '<button class="rb-btn rb-btn--secundario rb-btn--sm" data-act="seed">Recargar presupuesto base</button></div>'
    : '';
  const calendarioHtml = isGerente()
    ? '<div class="rb-tarjeta" style="max-width:560px;margin-top:16px"><h2>Calendario</h2><p class="sec" style="margin:4px 0 14px">' + esc(rangoCalendario()) + '. Cada semana tiene ' + fmtH(S.capacity) + ' h de cargabilidad; al ampliar, las semanas nuevas la toman igual y los festivos de Colombia se marcan en el tablero. Puedes ajustar una semana desde su encabezado en el presupuesto.</p>' +
      '<form id="form-ampliar" class="campo inline" style="align-items:flex-end"><div><label class="rb-etiqueta" for="amp-until">Ampliar hasta</label><input class="rb-input" id="amp-until" type="date" name="until" required value="' + esc(S.weeks.length ? addDays(S.weeks[S.weeks.length - 1].start, 7 * 13) : todayISO()) + '"></div>' +
      '<div style="flex:0 0 auto"><button class="rb-btn rb-btn--primario rb-btn--sm" type="submit">Ampliar calendario</button></div></form></div>'
    : '';
  return titulo('<b>Ajustes</b>') +
    '<div class="rb-tarjeta" style="max-width:560px"><h2>Tu cuenta</h2><p class="sec" style="margin:4px 0 14px">' + esc(S.user.name) + ' · ' + esc(S.user.email || '') + ' · ' + ROLE_LABELS[S.user.role] + '</p>' +
    (msMode() ? '<p class="sec">Entras con tu cuenta de Microsoft; no hay contraseña que cambiar.</p>' : '<button class="rb-btn rb-btn--secundario rb-btn--sm" data-act="cambiar-clave">' + ICON.key + 'Cambiar contraseña</button>') + '</div>' + calendarioHtml + seed;
}

/* ============================ Modales ============================ */

function renderModal() {
  const m = UI.modal;
  if (!m) return '';
  let inner = '';
  switch (m.type) {
    case 'celda': inner = modalCelda(m); break;
    case 'agregar': inner = modalAgregar(m); break;
    case 'fila': inner = modalFila(m); break;
    case 'persona': inner = modalPersona(m); break;
    case 'setpw': inner = modalSetPassword(m); break;
    case 'pwshow': inner = modalShowPassword(m); break;
    case 'cliente': inner = modalCliente(m); break;
    case 'password': inner = modalPassword(m); break;
    case 'semana': inner = modalSemana(m); break;
    case 'fusionar': inner = modalFusionar(m); break;
    case 'confirm': inner = modalConfirm(m); break;
    default: return '';
  }
  return '<div class="overlay" data-overlay>' + inner + '</div>';
}

function modalShell(title, body, foot, opts) {
  opts = opts || {};
  return '<div class="rb-tarjeta modal' + (opts.ancho ? ' ancho' : '') + '" role="dialog" aria-modal="true"><div class="modal-head"><h2>' + title + '</h2>' +
    (opts.noClose ? '' : '<button class="cerrar" data-act="cerrar-modal" title="Cerrar">' + ICON.close + '</button>') + '</div>' +
    '<div class="modal-body">' + body + '</div>' + (foot ? '<div class="modal-foot">' + foot + '</div>' : '') + '</div>';
}
function segmentos(name, defs, value) {
  return '<div class="segmentos" data-seg="' + name + '" data-value="' + esc(value) + '">' + defs.map(function (d) {
    return '<button type="button" class="seg' + (d.id === value ? ' activo' : '') + '" data-seg-value="' + d.id + '">' + esc(d.label) + '</button>';
  }).join('') + '</div>';
}
function opciones(list, value, vacio) {
  return (vacio !== undefined ? '<option value="">' + esc(vacio) + '</option>' : '') +
    list.map(function (o) { return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(value == null ? '' : value) ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('');
}
/* Editor de una semana para un cliente y una persona: horas por día. */
function tablaDias(clientId, personId, w) {
  return '<div class="dias-ed">' + weekDays(w).map(function (d, i) {
    const c = clientId ? cellOf(clientId, personId, d) : null;
    return '<label class="dia-ed' + diaClases(d) + '" title="' + esc(diaTitulo(d)) + '"><span class="n">' + DIAS_LARGO[i].slice(0, 3) + ' <small>' + Number(d.slice(8, 10)) + '</small>' + (isHoliday(d) ? '<em>festivo</em>' : '') + '</span>' +
      '<input class="rb-input" type="number" name="h' + i + '" min="0" max="24" step="0.5" value="' + (c && c.hours != null ? c.hours : '') + '" placeholder="–"></label>';
  }).join('') + '</div>';
}
function camposFaseNota(cell) {
  return '<div class="campo inline" style="margin-top:12px"><div><label class="rb-etiqueta" for="c-phase">Fase</label><select class="rb-select" id="c-phase" name="phase">' + opciones(PHASE_DEFS.map(function (x) { return { value: x.id, label: x.label }; }), cell.phase, 'Sin fase') + '</select></div>' +
    '<div><label class="rb-etiqueta" for="c-note">Nota</label><input class="rb-input" id="c-note" type="text" name="note" maxlength="300" value="' + esc(cell.note || '') + '" placeholder="Opcional"></div></div>' +
    '<p class="sec" style="margin-top:8px">Deja vacío un día para no asignarle horas. Elige <b>Vacaciones</b> sin horas para marcar la semana como vacaciones.</p>';
}

function modalCelda(m) {
  const c = clientById(m.clientId), p = personById(m.personId), w = weekByIdx(m.weekIdx);
  const celdas = weekCells(m.clientId, m.personId, w).filter(Boolean);
  const ref = celdas.find(function (x) { return x.phase || x.note; }) || {};
  const propias = celdas.reduce(function (a, x) { return a + (x.hours || 0); }, 0);
  const otras = hoursOf(m.personId, m.weekIdx) - propias;
  const body = '<p class="sec" style="margin-bottom:14px"><b class="az">' + esc(c ? c.name : '') + '</b> · ' + esc(p ? p.name : '') + ' · ' + esc(weekTag(w) + ', ' + weekTitle(w)) +
    '<br>Tiene ' + fmtH(otras) + ' h en otros clientes esta semana; cargabilidad ' + (w ? fmtH(w.capacity) : '') + ' h.</p>' +
    '<form id="form-dias" data-c="' + m.clientId + '" data-p="' + m.personId + '" data-w="' + m.weekIdx + '">' + tablaDias(m.clientId, m.personId, w) + camposFaseNota(ref) + '</form>';
  const foot = (celdas.length ? '<button class="rb-btn rb-btn--peligro rb-btn--sm" data-act="dias-vaciar">Quitar la semana</button>' : '') +
    '<span class="esp"></span><button class="rb-btn rb-btn--secundario rb-btn--sm" data-act="cerrar-modal">Cancelar</button><button class="rb-btn rb-btn--primario rb-btn--sm" type="submit" form="form-dias">Guardar</button>';
  return modalShell('Horas por <b>día</b>', body, foot, { ancho: true });
}

function modalAgregar(m) {
  const p = personById(m.personId), w = weekByIdx(m.weekIdx);
  const ya = {};
  rowsWeek(m.weekIdx).forEach(function (r) { if (r.personId === m.personId) ya[r.clientId] = true; });
  const clientes = S.clients.filter(function (c) { return c.active !== false && !ya[c.id]; })
    .sort(function (a, b) { return sedeOrden(a.sede) - sedeOrden(b.sede) || a.name.localeCompare(b.name); })
    .map(function (c) { return { value: c.id, label: (c.sede ? c.sede + ' · ' : '') + c.name }; });
  const body = '<p class="sec" style="margin-bottom:14px"><b class="az">' + esc(p ? p.name : '') + '</b> · ' + esc(weekTag(w) + ', ' + weekTitle(w)) + ' · ya tiene ' + fmtH(hoursOf(m.personId, m.weekIdx)) + ' de ' + (w ? fmtH(w.capacity) : '') + ' h.</p>' +
    '<form id="form-dias" data-p="' + m.personId + '" data-w="' + m.weekIdx + '">' +
    '<div class="campo"><label class="rb-etiqueta" for="a-client">Cliente</label><select class="rb-select" id="a-client" name="clientId" required>' + opciones(clientes, '', 'Elige un cliente') + '</select></div>' +
    tablaDias(null, m.personId, w) + camposFaseNota({}) + '</form>';
  return modalShell('Asignar <b>cliente</b>', body, '<span class="esp"></span><button class="rb-btn rb-btn--secundario rb-btn--sm" data-act="cerrar-modal">Cancelar</button><button class="rb-btn rb-btn--primario rb-btn--sm" type="submit" form="form-dias">Asignar</button>', { ancho: true });
}

function modalFila() {
  const body = '<form id="form-fila">' +
    '<div class="campo"><label class="rb-etiqueta" for="r-client">Cliente</label><select class="rb-select" id="r-client" name="clientId" required>' + opciones(S.clients.filter(function (c) { return c.active !== false; }).map(function (c) { return { value: c.id, label: c.name }; }), '', 'Elige un cliente') + '</select></div>' +
    '<div class="campo"><label class="rb-etiqueta" for="r-person">Funcionario</label><select class="rb-select" id="r-person" name="personId" required>' + opciones(activePeople().map(function (p) { return { value: p.id, label: p.name + ' · ' + ROLE_LABELS[p.role] }; }), '', 'Elige una persona') + '</select></div>' +
    '<p class="sec">La fila aparece en la cuadrícula; se guarda en cuanto registres horas en alguna semana.</p></form>';
  return modalShell('Agregar <b>fila</b>', body, '<span class="esp"></span><button class="rb-btn rb-btn--secundario rb-btn--sm" data-act="cerrar-modal">Cancelar</button><button class="rb-btn rb-btn--primario rb-btn--sm" type="submit" form="form-fila">Agregar</button>');
}

function modalPersona(m) {
  const p = m.person || { name: '', email: '', role: 'junior', active: true };
  const isNew = !m.person;
  const body = '<form id="form-persona" data-id="' + (p.id || '') + '">' +
    '<div class="campo"><label class="rb-etiqueta" for="p-name">Nombre</label><input class="rb-input" id="p-name" type="text" name="name" required maxlength="120" value="' + esc(p.name) + '"></div>' +
    '<div class="campo"><label class="rb-etiqueta" for="p-email">Correo (para entrar)</label><input class="rb-input" id="p-email" type="email" name="email" value="' + esc(p.email || '') + '"></div>' +
    '<div class="campo"><span class="rb-etiqueta">Rol</span>' + segmentos('role', [{ id: 'gerente', label: 'Gerente' }, { id: 'senior', label: 'Senior' }, { id: 'junior', label: 'Junior' }], p.role) + '</div>' +
    (isNew ? (msMode() ? '' : '<div class="campo"><label class="check"><input type="checkbox" name="withPassword" checked> Generar una contraseña temporal para que pueda entrar</label></div>')
      : (p.id !== S.user.id ? '<div class="campo"><label class="check"><input type="checkbox" name="active"' + (p.active !== false ? ' checked' : '') + '> Cuenta activa (si se desactiva, no puede entrar)</label></div>' : '')) +
    '</form>';
  return modalShell(isNew ? 'Nueva <b>persona</b>' : 'Editar <b>persona</b>', body, '<span class="esp"></span><button class="rb-btn rb-btn--secundario rb-btn--sm" data-act="cerrar-modal">Cancelar</button><button class="rb-btn rb-btn--primario rb-btn--sm" type="submit" form="form-persona">' + (isNew ? 'Crear' : 'Guardar') + '</button>');
}

function modalSetPassword(m) {
  const p = personById(m.personId);
  const body = '<p style="margin-bottom:12px">Se asignará una contraseña temporal a <b class="az">' + esc(p.name) + '</b>. Deberá cambiarla al entrar y sus sesiones abiertas se cerrarán.</p>' +
    (!p.email ? '<div class="rb-alerta rb-alerta--aviso" style="margin-bottom:12px">Esta persona no tiene correo registrado: sin correo no puede iniciar sesión. Edítala primero.</div>' : '') +
    '<form id="form-setpw" data-id="' + p.id + '"><div class="campo"><label class="rb-etiqueta" for="sp-pw">Contraseña temporal</label><input class="rb-input" id="sp-pw" type="text" name="password" minlength="8" required value="' + esc(randomPassword()) + '" autocomplete="off"></div></form>';
  return modalShell('Asignar <b>contraseña</b>', body, '<span class="esp"></span><button class="rb-btn rb-btn--secundario rb-btn--sm" data-act="cerrar-modal">Cancelar</button><button class="rb-btn rb-btn--primario rb-btn--sm" type="submit" form="form-setpw"' + (!p.email ? ' disabled' : '') + '>Asignar</button>');
}

function modalShowPassword(m) {
  const body = '<div class="clave-box">Contraseña temporal de <b>' + esc(m.name) + '</b> (' + esc(m.email || 'sin correo') + '):<div class="clave">' + esc(m.password) + '</div>Compártela por un canal seguro. No volverá a mostrarse; si se pierde, asigna otra desde Personas.</div>';
  return modalShell('Acceso <b>creado</b>', body, '<span class="esp"></span><button class="rb-btn rb-btn--primario rb-btn--sm" data-act="cerrar-modal">Entendido</button>');
}

function modalCliente(m) {
  const c = m.client || { name: '', sede: '', active: true };
  const isNew = !m.client;
  const body = '<form id="form-cliente" data-id="' + (c.id || '') + '">' +
    '<div class="campo"><label class="rb-etiqueta" for="cl-name">Nombre</label><input class="rb-input" id="cl-name" type="text" name="name" required maxlength="160" value="' + esc(c.name) + '"></div>' +
    '<div class="campo"><span class="rb-etiqueta">Sede</span>' + segmentos('sede', S.sedes.map(function (x) { return { id: x, label: x }; }).concat([{ id: '', label: 'Sin sede' }]), c.sede || '') + '</div>' +
    (isNew ? '' : '<div class="campo"><label class="check"><input type="checkbox" name="active"' + (c.active !== false ? ' checked' : '') + '> Cliente activo</label></div>') + '</form>';
  return modalShell(isNew ? 'Nuevo <b>cliente</b>' : 'Editar <b>cliente</b>', body, '<span class="esp"></span><button class="rb-btn rb-btn--secundario rb-btn--sm" data-act="cerrar-modal">Cancelar</button><button class="rb-btn rb-btn--primario rb-btn--sm" type="submit" form="form-cliente">' + (isNew ? 'Crear' : 'Guardar') + '</button>');
}

function modalPassword(m) {
  const body = (m.forced ? '<div class="rb-alerta rb-alerta--info" style="margin-bottom:14px">Tu contraseña es temporal. Elige una nueva para continuar.</div>' : '') +
    '<form id="form-password">' +
    '<div class="campo"><label class="rb-etiqueta" for="pw-cur">Contraseña actual</label><input class="rb-input" id="pw-cur" type="password" name="current" autocomplete="current-password" required></div>' +
    '<div class="campo"><label class="rb-etiqueta" for="pw-new">Nueva contraseña (mínimo 8 caracteres)</label><input class="rb-input" id="pw-new" type="password" name="password" autocomplete="new-password" minlength="8" required></div>' +
    '<div class="campo"><label class="rb-etiqueta" for="pw-rep">Repite la nueva contraseña</label><input class="rb-input" id="pw-rep" type="password" name="repeat" autocomplete="new-password" minlength="8" required></div>' +
    '</form>';
  return modalShell('Cambiar <b>contraseña</b>', body, '<span class="esp"></span>' + (m.forced ? '<button class="rb-btn rb-btn--secundario rb-btn--sm" data-act="logout">Salir</button>' : '<button class="rb-btn rb-btn--secundario rb-btn--sm" data-act="cerrar-modal">Cancelar</button>') + '<button class="rb-btn rb-btn--primario rb-btn--sm" type="submit" form="form-password">Guardar</button>', { noClose: m.forced });
}

function modalSemana(m) {
  const w = weekByIdx(m.idx);
  if (!w) return '';
  const body = '<p class="sec" style="margin-bottom:14px">Semana que empieza el lunes ' + fmtDate(w.start) + '.</p>' +
    '<form id="form-semana" data-idx="' + w.idx + '">' +
    '<div class="campo inline"><div><label class="rb-etiqueta" for="s-label">Etiqueta</label><input class="rb-input" id="s-label" type="text" name="label" maxlength="40" required value="' + esc(w.label) + '"></div>' +
    '<div><label class="rb-etiqueta" for="s-month">Mes</label><input class="rb-input" id="s-month" type="text" name="month" maxlength="20" required value="' + esc(w.month) + '"></div></div>' +
    '<div class="campo" style="max-width:200px"><label class="rb-etiqueta" for="s-cap">Cargabilidad (horas disponibles)</label><input class="rb-input" id="s-cap" type="number" name="capacity" min="0" max="168" step="1" required value="' + fmtH(w.capacity) + '"></div>' +
    '</form>';
  return modalShell('Ajustar <b>semana</b>', body, '<span class="esp"></span><button class="rb-btn rb-btn--secundario rb-btn--sm" data-act="cerrar-modal">Cancelar</button><button class="rb-btn rb-btn--primario rb-btn--sm" type="submit" form="form-semana">Guardar</button>');
}

function modalFusionar(m) {
  const p = personById(m.personId);
  if (!p) return '';
  const destinos = sortPeople(S.people.filter(function (x) { return x.id !== p.id && x.active !== false; }))
    .map(function (x) { return { value: x.id, label: x.name + ' · ' + ROLE_LABELS[x.role] + (x.email ? ' · ' + x.email : ' · sin correo') + (x.dias ? ' · ' + x.dias + ' días con horas' : '') }; });
  const body = '<p style="margin-bottom:12px">Se traspasarán las horas de <b class="az">' + esc(p.name) + '</b>' + (p.dias ? ' (' + p.dias + ' días con horas)' : '') + (p.email ? ', correo ' + esc(p.email) : ', sin correo') + ' a la persona que elijas, y <b>' + esc(p.name) + ' se eliminará</b>.</p>' +
    '<ul class="rb-lista"><li>La persona que queda conserva su correo; si no tenía, toma el de la eliminada.</li><li>Si ambas tenían horas el mismo día para el mismo cliente, se suman.</li><li>Se conserva el rol más alto de las dos.</li></ul>' +
    '<form id="form-fusionar" data-from="' + p.id + '"><div class="campo"><label class="rb-etiqueta" for="f-into">Traspasar a</label><select class="rb-select" id="f-into" name="intoId" required>' + opciones(destinos, '', 'Elige la persona que se conserva') + '</select></div></form>';
  return modalShell('Fusionar <b>personas</b>', body, '<span class="esp"></span><button class="rb-btn rb-btn--secundario rb-btn--sm" data-act="cerrar-modal">Cancelar</button><button class="rb-btn rb-btn--primario rb-btn--sm" type="submit" form="form-fusionar">Fusionar y eliminar</button>');
}

function modalConfirm(m) {
  return modalShell(m.title, '<p>' + esc(m.text) + '</p>',
    '<span class="esp"></span><button class="rb-btn rb-btn--secundario rb-btn--sm" data-act="cerrar-modal">Cancelar</button><button class="rb-btn ' + (m.danger ? 'rb-btn--peligro' : 'rb-btn--primario') + ' rb-btn--sm" data-act="confirm-ok">' + esc(m.okLabel || 'Confirmar') + '</button>');
}

function confirmDialog(opts) { UI.modal = Object.assign({ type: 'confirm' }, opts); render(); }
function closeModal() { if (UI.modal && UI.modal.forced) return; UI.modal = null; render(); }

/* ============================ acciones ============================ */

function readForm(form) {
  const out = {};
  Array.prototype.forEach.call(form.elements, function (el) {
    if (!el.name) return;
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
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

/* Guarda los siete días de una semana para un cliente y una persona. */
async function saveDias(clientId, personId, weekIdx, horas, phase, note, msg) {
  const w = weekByIdx(weekIdx);
  if (!w) return;
  const dias = weekDays(w);
  const rows = dias.map(function (d, i) {
    const h = horas[i];
    const marcar = h != null || (phase === 'vacaciones' && !isWeekend(d) && !isHoliday(d));
    return marcar
      ? { clientId: clientId, personId: personId, day: d, hours: h, phase: phase || null, note: note || null }
      : { clientId: clientId, personId: personId, day: d, hours: null, phase: null, note: null };
  });
  await withBusy(async function () {
    const r = await api('PUT', '/api/budget', { rows: rows });
    const keys = {};
    dias.forEach(function (d) { keys[clientId + '|' + personId + '|' + d] = true; });
    S.budget = S.budget.filter(function (x) { return !keys[x.clientId + '|' + x.personId + '|' + x.day]; });
    r.rows.forEach(function (x) { if (!x.deleted) S.budget.push(x); });
    indexBudget();
    UI.modal = null;
    render();
    if (msg) toast(msg, 'ok');
    const total = hoursOf(personId, weekIdx);
    if (total > w.capacity) {
      const p = personById(personId);
      toast('Sobrecarga: ' + (p ? p.name : 'la persona') + ' queda con ' + fmtH(total) + ' h en la ' + weekTag(w).toLowerCase() + ', por encima de las ' + fmtH(w.capacity) + ' h.', 'err');
    }
  });
}

async function submitPersona(form) {
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
      S.people.push(r.person);
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

async function submitCliente(form) {
  const data = readForm(form);
  const id = form.dataset.id ? Number(form.dataset.id) : null;
  await withBusy(async function () {
    if (id) {
      const r = await api('PATCH', '/api/clients?id=' + id, { name: data.name, sede: data.sede || null, active: data.active });
      S.clients = S.clients.map(function (c) { return c.id === id ? r.client : c; });
    } else {
      const r = await api('POST', '/api/clients', { name: data.name, sede: data.sede || null });
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
  if (msMode()) await salirDeMicrosoft();
  S.user = null; S.loaded = false; UI.modal = null; UI.view = null; UI.authError = null;
  history.replaceState(null, '', location.pathname);
  render();
}

function irASemana(personId) {
  if (isManager()) {
    UI.filtro.persona = 'all'; UI.filtro.cliente = 'all';
    setView('semana');
    const el = document.querySelector('[data-act="agregar"][data-p="' + personId + '"]');
    if (el) el.closest('.persona-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/* ============================ eventos ============================ */

document.addEventListener('click', function (ev) {
  const segBtn = ev.target.closest('[data-seg-value]');
  if (segBtn) {
    const seg = segBtn.closest('[data-seg]');
    seg.dataset.value = segBtn.dataset.segValue;
    seg.querySelectorAll('.seg').forEach(function (b) { b.classList.toggle('activo', b === segBtn); });
    return;
  }
  if (ev.target.hasAttribute('data-overlay')) { closeModal(); return; }
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  if (el.tagName === 'A') ev.preventDefault();
  const act = el.dataset.act;
  const id = el.dataset.id ? Number(el.dataset.id) : null;

  switch (act) {
    case 'nav': if (el.dataset.view) setView(el.dataset.view); break;
    case 'logout': logout(); break;
    case 'ms-login': entrarConMicrosoft(); break;
    case 'cerrar-modal': closeModal(); break;
    case 'semana-prev': { const i = S.weeks.findIndex(function (w) { return w.idx === UI.weekIdx; }); if (i > 0) { UI.weekIdx = S.weeks[i - 1].idx; render(); } break; }
    case 'semana-next': { const i = S.weeks.findIndex(function (w) { return w.idx === UI.weekIdx; }); if (i >= 0 && i < S.weeks.length - 1) { UI.weekIdx = S.weeks[i + 1].idx; render(); } break; }
    case 'semana-hoy': UI.weekIdx = currentWeekIdx(); render(); break;
    case 'editar-dias': UI.modal = { type: 'celda', clientId: Number(el.dataset.c), personId: Number(el.dataset.p), weekIdx: Number(el.dataset.w) }; render(); break;
    case 'agregar': UI.modal = { type: 'agregar', personId: Number(el.dataset.p), weekIdx: Number(el.dataset.w) }; render(); break;
    case 'agregar-fila': UI.modal = { type: 'fila' }; render(); break;
    case 'editar-semana': UI.modal = { type: 'semana', idx: Number(el.dataset.w) }; render(); break;
    case 'dias-vaciar': { const m = UI.modal; saveDias(m.clientId, m.personId, m.weekIdx, [null, null, null, null, null, null, null], null, null, 'Semana retirada.'); break; }
    case 'ver-persona': irASemana(id); break;
    case 'ver-cliente': UI.filtro.persona = 'all'; UI.filtro.cliente = String(id); UI.filtro.sede = 'all'; setView('presupuesto'); break;
    case 'nueva-persona': UI.modal = { type: 'persona', person: null }; render(); break;
    case 'editar-persona': UI.modal = { type: 'persona', person: personById(id) }; render(); break;
    case 'clave-persona': UI.modal = { type: 'setpw', personId: id }; render(); break;
    case 'fusionar-persona': UI.modal = { type: 'fusionar', personId: id }; render(); break;
    case 'eliminar-persona': {
      const p = personById(id);
      if (!p) break;
      confirmDialog({ title: 'Eliminar <b>persona</b>', danger: true, okLabel: 'Eliminar',
        text: 'Se eliminará a ' + p.name + (p.dias ? ' y sus ' + p.dias + ' días con horas asignadas. Si quieres conservar esas horas en otra cuenta, usa Fusionar en vez de Eliminar.' : '. No tiene horas asignadas.'),
        onOk: async function () {
          await api('DELETE', '/api/people?id=' + id);
          S.people = S.people.filter(function (x) { return x.id !== id; });
          S.budget = S.budget.filter(function (x) { return x.personId !== id; });
          indexBudget(); UI.modal = null; render(); toast('Persona eliminada.', 'ok');
        } });
      break;
    }
    case 'nuevo-cliente': UI.modal = { type: 'cliente', client: null }; render(); break;
    case 'editar-cliente': UI.modal = { type: 'cliente', client: clientById(id) }; render(); break;
    case 'cambiar-clave': UI.modal = { type: 'password', forced: false }; render(); break;
    case 'seed':
      confirmDialog({ title: 'Recargar <b>presupuesto base</b>', text: 'Se cargarán de nuevo semanas, clientes, funcionarios y celdas del archivo base. Las celdas que coincidan volverán al valor del Excel; las demás se conservan.', okLabel: 'Recargar',
        onOk: async function () { const r = await api('POST', '/api/budget?action=seed'); await loadAll(); UI.modal = null; render(); toast('Presupuesto recargado: ' + r.seeded.budget + ' celdas.', 'ok'); } });
      break;
    case 'confirm-ok': { const m = UI.modal; if (m && m.onOk) withBusy(m.onOk); break; }
  }
});

document.addEventListener('submit', function (ev) {
  const form = ev.target;
  ev.preventDefault();
  switch (form.id) {
    case 'form-login': submitLogin(form); break;
    case 'form-setup': submitSetup(form); break;
    case 'form-dias': {
      const d = readForm(form);
      const clientId = form.dataset.c ? Number(form.dataset.c) : Number(d.clientId);
      if (!clientId) return;
      const horas = [0, 1, 2, 3, 4, 5, 6].map(function (i) { return d['h' + i] === '' || d['h' + i] === undefined ? null : Number(d['h' + i]); });
      saveDias(clientId, Number(form.dataset.p), Number(form.dataset.w), horas, d.phase || null, d.note || null, form.dataset.c ? 'Horas guardadas.' : 'Cliente asignado.');
      break;
    }
    case 'form-fila': {
      const d = readForm(form);
      if (!d.clientId || !d.personId) return;
      UI.filasExtra.push({ clientId: Number(d.clientId), personId: Number(d.personId) });
      UI.filtro.persona = 'all'; UI.filtro.cliente = 'all'; UI.filtro.sede = 'all';
      UI.modal = null; render();
      break;
    }
    case 'form-semana': {
      const d = readForm(form);
      withBusy(async function () {
        const r = await api('PATCH', '/api/budget?action=week', { idx: Number(form.dataset.idx), label: d.label, month: d.month, capacity: Number(d.capacity) });
        S.weeks = r.weeks; indexBudget(); UI.modal = null; render(); toast('Semana ajustada.', 'ok');
      });
      break;
    }
    case 'form-ampliar': {
      const d = readForm(form);
      withBusy(async function () {
        const r = await api('POST', '/api/budget?action=weeks', { until: d.until });
        S.weeks = r.weeks; (r.holidays || []).forEach(function (x) { S.holidays[x] = true; }); indexBudget(); render(); toast('Calendario ampliado: ' + r.added + ' semanas nuevas.', 'ok');
      });
      break;
    }
    case 'form-fusionar': {
      const d = readForm(form);
      const fromId = Number(form.dataset.from), intoId = Number(d.intoId);
      if (!intoId) return;
      withBusy(async function () {
        const r = await api('POST', '/api/people?action=merge', { fromId: fromId, intoId: intoId });
        await loadAll();
        UI.modal = null; render();
        toast('Listo: ' + r.moved + ' días de horas traspasados a ' + r.person.name + '.', 'ok');
      });
      break;
    }
    case 'form-persona': submitPersona(form); break;
    case 'form-setpw': submitSetPassword(form); break;
    case 'form-cliente': submitCliente(form); break;
    case 'form-password': submitPassword(form); break;
  }
});

document.addEventListener('change', function (ev) {
  const el = ev.target;
  if (el.dataset.actChange === 'semana') { UI.weekIdx = Number(el.value); render(); return; }
  if (el.dataset.filtro) { UI.filtro[el.dataset.filtro] = el.value; render(); }
});

document.addEventListener('keydown', function (ev) {
  if (ev.key === 'Escape' && UI.modal) closeModal();
});

boot();
