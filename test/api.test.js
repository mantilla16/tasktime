/* Prueba de extremo a extremo del API contra el servidor local con PGlite.

   Levanta server.js --dev en un puerto libre con una base temporal, recorre el
   flujo completo (configuración inicial, cuentas, clientes, asignación de
   horas) y comprueba sobre todo las reglas de visibilidad por rol.

   Uso: npm test */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const PORT = 3999;
const BASE = 'http://localhost:' + PORT;
const ROOT = path.join(__dirname, '..');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'russell-test-'));
const server = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--dev'], {
  cwd: ROOT,
  env: Object.assign({}, process.env, { PORT: String(PORT), PGLITE_DATA_DIR: dataDir, DATABASE_URL: '', POSTGRES_URL: '' }),
  stdio: ['ignore', 'pipe', 'inherit']
});
server.stdout.on('data', function () { /* silencio */ });

function client() {
  let cookie = '';
  return async function (method, url, body) {
    const r = await fetch(BASE + url, {
      method: method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const set = r.headers.get('set-cookie');
    if (set) {
      const m = set.match(/russell_session=([^;]*)/);
      if (m) cookie = m[1] ? 'russell_session=' + m[1] : '';
    }
    let payload = null;
    try { payload = await r.json(); } catch (e) { payload = null; }
    return { status: r.status, body: payload };
  };
}

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(BASE + '/api/auth');
      if (r.status < 500) return;
    } catch (e) { /* aún no */ }
    await new Promise(function (r) { setTimeout(r, 200); });
  }
  throw new Error('El servidor no arrancó.');
}

(async function main() {
  let failed = false;
  try {
    await waitForServer();
    const gerente = client();
    const senior = client();
    const junior = client();

    /* ---- configuración inicial ---- */
    let r = await gerente('GET', '/api/auth');
    assert.strictEqual(r.body.setupRequired, true, 'sin cuentas debe pedir configuración');

    r = await gerente('POST', '/api/auth?action=setup', { name: 'Gerente Prueba', email: 'gerente@ejemplo.test', password: 'clave-segura-1' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.user.role, 'gerente');
    assert.ok(r.body.seeded.budget > 200, 'debe cargar el presupuesto del Excel');

    r = await gerente('POST', '/api/auth?action=setup', { name: 'Otro', email: 'otro@ejemplo.test', password: 'clave-segura-1' });
    assert.strictEqual(r.status, 409, 'no se puede repetir la configuración inicial');

    /* ---- personas cargadas del Excel ---- */
    r = await gerente('GET', '/api/people');
    assert.strictEqual(r.status, 200);
    const people = r.body.people;
    const roberto = people.find(function (p) { return p.name === 'Roberto Gonzalez'; });
    const paula = people.find(function (p) { return p.name === 'Paula Ariza'; });
    const arleidis = people.find(function (p) { return p.name === 'Arleidis Alvarez'; });
    assert.ok(roberto && roberto.role === 'senior');
    assert.ok(paula && paula.role === 'junior');
    assert.strictEqual(roberto.hasPassword, false);

    /* ---- el gerente da acceso a un senior y a un junior ---- */
    r = await gerente('PATCH', '/api/people?id=' + roberto.id, { email: 'roberto@ejemplo.test', password: 'clave-roberto-1' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.person.mustChangePassword, true);
    r = await gerente('PATCH', '/api/people?id=' + paula.id, { email: 'paula@ejemplo.test', password: 'clave-paula-1' });
    assert.strictEqual(r.status, 200);

    r = await senior('POST', '/api/auth?action=login', { email: 'roberto@ejemplo.test', password: 'mala' });
    assert.strictEqual(r.status, 401);
    r = await senior('POST', '/api/auth?action=login', { email: 'roberto@ejemplo.test', password: 'clave-roberto-1' });
    assert.strictEqual(r.status, 200);
    r = await junior('POST', '/api/auth?action=login', { email: 'PAULA@ejemplo.test', password: 'clave-paula-1' });
    assert.strictEqual(r.status, 200);

    /* ---- solo el gerente administra personas ---- */
    r = await junior('POST', '/api/people', { name: 'Intruso', role: 'gerente' });
    assert.strictEqual(r.status, 403);
    r = await senior('POST', '/api/people', { name: 'Intruso', role: 'gerente' });
    assert.strictEqual(r.status, 403, 'tampoco el senior');
    r = await junior('GET', '/api/people');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.people[0].email, undefined, 'el junior no ve correos ajenos');

    /* ---- clientes ---- */
    r = await junior('GET', '/api/clients');
    assert.strictEqual(r.status, 200);
    const kaia = r.body.clients.find(function (c) { return c.name === 'Grupo KAIA'; });
    assert.ok(kaia);
    r = await junior('POST', '/api/clients', { name: 'Nuevo' });
    assert.strictEqual(r.status, 403);
    r = await senior('POST', '/api/clients', { name: 'Cliente Nuevo S.A.S' });
    assert.strictEqual(r.status, 201);
    const nuevo = r.body.client;

    /* ---- horas: gerente y senior ven todo; el junior solo lo suyo ---- */
    r = await gerente('GET', '/api/budget');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.weeks.length, 44);
    assert.strictEqual(r.body.weeks[0].start, '2026-06-01');
    const total = r.body.rows.length;
    assert.ok(total > 200);
    r = await senior('GET', '/api/budget');
    assert.strictEqual(r.body.rows.length, total, 'el senior ve todas las filas');

    r = await junior('GET', '/api/budget');
    assert.ok(r.body.rows.length > 0 && r.body.rows.length < total);
    assert.ok(r.body.rows.every(function (x) { return x.personId === paula.id; }), 'el junior solo ve sus horas');

    /* ---- asignar horas: el senior asigna a una junior, la junior no puede ---- */
    r = await junior('PUT', '/api/budget', { rows: [{ clientId: kaia.id, personId: paula.id, weekIdx: 0, hours: 5 }] });
    assert.strictEqual(r.status, 403);

    r = await senior('PUT', '/api/budget', { rows: [
      { clientId: nuevo.id, personId: paula.id, weekIdx: 2, hours: 9, phase: 'planeacion' },
      { clientId: nuevo.id, personId: arleidis.id, weekIdx: 2, hours: 12, phase: 'planeacion', note: 'Visita en sitio' }
    ] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.rows.length, 2);

    r = await junior('GET', '/api/budget');
    const cell = r.body.rows.find(function (x) { return x.clientId === nuevo.id && x.weekIdx === 2; });
    assert.ok(cell && cell.hours === 9 && cell.phase === 'planeacion', 'la junior ve las horas que le asignaron');
    assert.ok(!r.body.rows.some(function (x) { return x.personId === arleidis.id; }), 'pero no las de su compañera');

    r = await senior('PUT', '/api/budget', { rows: [{ clientId: nuevo.id, personId: paula.id, weekIdx: 2, hours: null, phase: null }] });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.rows[0].deleted, true);

    r = await senior('PUT', '/api/budget', { rows: [{ clientId: nuevo.id, personId: paula.id, weekIdx: 99, hours: 1 }] });
    assert.strictEqual(r.status, 400, 'semana inexistente');
    r = await senior('PUT', '/api/budget', { rows: [{ clientId: nuevo.id, personId: paula.id, weekIdx: 1, hours: -1 }] });
    assert.strictEqual(r.status, 400, 'horas negativas');

    r = await gerente('POST', '/api/budget?action=seed');
    assert.strictEqual(r.status, 200);
    r = await senior('POST', '/api/budget?action=seed');
    assert.strictEqual(r.status, 403);

    /* ---- ampliar el calendario y ajustar una semana ---- */
    r = await senior('POST', '/api/budget?action=weeks', { until: '2027-06-30' });
    assert.strictEqual(r.status, 403, 'solo el gerente amplía el calendario');
    r = await gerente('POST', '/api/budget?action=weeks', { until: '2027-03-01' });
    assert.strictEqual(r.status, 400, 'no se puede ampliar hacia atrás');
    r = await gerente('POST', '/api/budget?action=weeks', { until: '2027-06-30' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.added, 13, 'del 5 de abril al 28 de junio de 2027 son 13 semanas');
    assert.strictEqual(r.body.weeks.length, 57);
    const nueva = r.body.weeks[44];
    assert.strictEqual(nueva.start, '2027-04-05');
    assert.strictEqual(nueva.month, 'Abril');
    assert.strictEqual(nueva.capacity, 44);
    const conFestivo = r.body.weeks.find(function (w) { return w.start === '2027-05-10'; });
    assert.strictEqual(conFestivo.capacity, 36, 'la semana con festivo (Ascensión) descuenta 8 h');
    assert.strictEqual(conFestivo.label, 'Del 11 al 15');

    r = await gerente('PATCH', '/api/budget?action=week', { idx: nueva.idx, capacity: 40 });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.weeks[44].capacity, 40);
    r = await senior('PUT', '/api/budget', { rows: [{ clientId: nuevo.id, personId: paula.id, weekIdx: nueva.idx, hours: 6, phase: 'cierre' }] });
    assert.strictEqual(r.status, 200, 'se pueden asignar horas en las semanas nuevas');

    /* ---- contraseña propia y cierre de sesión ---- */
    r = await junior('POST', '/api/auth?action=password', { current: 'mala', password: 'otra-clave-123' });
    assert.strictEqual(r.status, 400);
    r = await junior('POST', '/api/auth?action=password', { current: 'clave-paula-1', password: 'otra-clave-123' });
    assert.strictEqual(r.status, 200);
    r = await junior('GET', '/api/auth');
    assert.strictEqual(r.body.user.mustChangePassword, false);

    r = await junior('POST', '/api/auth?action=logout');
    assert.strictEqual(r.status, 200);
    r = await junior('GET', '/api/budget');
    assert.strictEqual(r.status, 401);

    /* ---- desactivar a alguien invalida su sesión ---- */
    r = await gerente('PATCH', '/api/people?id=' + roberto.id, { active: false });
    assert.strictEqual(r.status, 200);
    r = await senior('GET', '/api/budget');
    assert.strictEqual(r.status, 401, 'la sesión del desactivado deja de valer');
    r = await gerente('GET', '/api/auth');
    r = await gerente('PATCH', '/api/people?id=' + r.body.user.id, { active: false });
    assert.strictEqual(r.status, 400, 'el gerente no se desactiva a sí mismo');

    console.log('OK: todas las comprobaciones pasaron.');
  } catch (err) {
    failed = true;
    console.error('FALLÓ:', err && err.stack || err);
  } finally {
    server.kill();
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* nada */ }
    process.exit(failed ? 1 : 0);
  }
})();
