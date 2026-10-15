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
    r = await senior('POST', '/api/clients', { name: 'Cliente Nuevo S.A.S', sede: 'Santa Marta' });
    assert.strictEqual(r.status, 201);
    const nuevo = r.body.client;
    assert.strictEqual(nuevo.sede, 'Santa Marta');
    r = await senior('PATCH', '/api/clients?id=' + kaia.id, { sede: 'Barranquilla' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.client.sede, 'Barranquilla');
    r = await senior('PATCH', '/api/clients?id=' + kaia.id, { sede: 'Bogotá' });
    assert.strictEqual(r.status, 400, 'solo las sedes definidas');

    /* ---- horas por día: gerente y senior ven todo; el junior solo lo suyo ---- */
    r = await gerente('GET', '/api/budget');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.weeks.length, 44);
    assert.strictEqual(r.body.weeks[0].start, '2026-06-01');
    assert.ok(r.body.weeks.every(function (w) { return w.capacity === 42; }), 'cargabilidad fija de 42 h');
    assert.strictEqual(r.body.capacity, 42);
    assert.ok(r.body.holidays.indexOf('2026-10-12') !== -1, 'festivos de Colombia en el rango');
    const total = r.body.rows.length;
    assert.ok(total > 800, 'las celdas semanales del Excel quedaron repartidas por día');
    // Paula, Grupo KAIA... el Excel tenía 16 h en la semana del 22 de junio para
    // Paula en Centro Empresarial Buenavista: deben ser 4 h en cada día hábil.
    const cebCliente = (await gerente('GET', '/api/clients')).body.clients.find(function (c) { return c.name === 'Centro Empresarial Buenavista'; });
    const ceb = r.body.rows.filter(function (x) { return x.personId === paula.id && x.clientId === cebCliente.id && x.day >= '2026-06-22' && x.day <= '2026-06-28'; });
    const cebHoras = ceb.reduce(function (a, x) { return a + (x.hours || 0); }, 0);
    assert.strictEqual(Math.round(cebHoras * 100) / 100, 16, 'la semana conserva sus 16 h');
    assert.ok(ceb.every(function (x) { return x.day <= '2026-06-26'; }), 'solo días hábiles');
    r = await senior('GET', '/api/budget');
    assert.strictEqual(r.body.rows.length, total, 'el senior ve todas las filas');

    r = await junior('GET', '/api/budget');
    assert.ok(r.body.rows.length > 0 && r.body.rows.length < total);
    assert.ok(r.body.rows.every(function (x) { return x.personId === paula.id; }), 'el junior solo ve sus horas');

    /* ---- asignar horas por día: el senior asigna a una junior, la junior no puede ---- */
    r = await junior('PUT', '/api/budget', { rows: [{ clientId: kaia.id, personId: paula.id, day: '2026-06-15', hours: 5 }] });
    assert.strictEqual(r.status, 403);

    r = await senior('PUT', '/api/budget', { rows: [
      { clientId: nuevo.id, personId: paula.id, day: '2026-06-15', hours: 4, phase: 'planeacion' },
      { clientId: nuevo.id, personId: paula.id, day: '2026-06-16', hours: 5, phase: 'planeacion' },
      { clientId: nuevo.id, personId: arleidis.id, day: '2026-06-15', hours: 8, phase: 'planeacion', note: 'Visita en sitio' }
    ] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.rows.length, 3);

    r = await junior('GET', '/api/budget');
    const cell = r.body.rows.find(function (x) { return x.clientId === nuevo.id && x.day === '2026-06-16'; });
    assert.ok(cell && cell.hours === 5 && cell.phase === 'planeacion', 'la junior ve las horas que le asignaron');
    assert.ok(!r.body.rows.some(function (x) { return x.personId === arleidis.id; }), 'pero no las de su compañera');

    r = await senior('PUT', '/api/budget', { rows: [{ clientId: nuevo.id, personId: paula.id, day: '2026-06-15', hours: null, phase: null }] });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.rows[0].deleted, true);

    r = await senior('PUT', '/api/budget', { rows: [{ clientId: nuevo.id, personId: paula.id, day: '2030-01-07', hours: 1 }] });
    assert.strictEqual(r.status, 400, 'día fuera del calendario');
    r = await senior('PUT', '/api/budget', { rows: [{ clientId: nuevo.id, personId: paula.id, day: '2026-06-15', hours: -1 }] });
    assert.strictEqual(r.status, 400, 'horas negativas');
    r = await senior('PUT', '/api/budget', { rows: [{ clientId: nuevo.id, personId: paula.id, day: '2026-06-15', hours: 30 }] });
    assert.strictEqual(r.status, 400, 'más de 24 h en un día');

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
    assert.strictEqual(nueva.capacity, 42);
    const conFestivo = r.body.weeks.find(function (w) { return w.start === '2027-05-10'; });
    assert.strictEqual(conFestivo.capacity, 42, 'la cargabilidad es fija aunque haya festivo');
    assert.strictEqual(conFestivo.label, 'Del 11 al 15');
    assert.ok(r.body.holidays.indexOf('2027-05-10') !== -1, 'el festivo nuevo aparece en la lista');

    r = await gerente('PATCH', '/api/budget?action=week', { idx: nueva.idx, capacity: 40 });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.weeks[44].capacity, 40);
    r = await senior('PUT', '/api/budget', { rows: [{ clientId: nuevo.id, personId: paula.id, day: nueva.start, hours: 6, phase: 'cierre' }] });
    assert.strictEqual(r.status, 200, 'se pueden asignar horas en las semanas nuevas');

    /* ---- fusionar cuentas duplicadas y eliminar personas ---- */
    r = await gerente('POST', '/api/people', { name: 'Paula Ariza Duplicada', email: 'paula.ariza@ejemplo.test', role: 'junior' });
    assert.strictEqual(r.status, 201);
    const dup = r.body.person;
    r = await senior('PUT', '/api/budget', { rows: [
      { clientId: kaia.id, personId: dup.id, day: '2026-06-16', hours: 3, phase: 'cierre' },
      { clientId: nuevo.id, personId: dup.id, day: '2026-06-16', hours: 2, phase: 'cierre' }
    ] });
    assert.strictEqual(r.status, 200);
    r = await junior('POST', '/api/people?action=merge', { fromId: dup.id, intoId: paula.id });
    assert.strictEqual(r.status, 403, 'solo el gerente fusiona');
    r = await gerente('POST', '/api/people?action=merge', { fromId: dup.id, intoId: paula.id });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.moved, 2);
    assert.strictEqual(r.body.person.email, 'paula@ejemplo.test', 'el destino conserva su correo');
    r = await gerente('GET', '/api/people');
    assert.ok(!r.body.people.some(function (p) { return p.id === dup.id; }), 'la duplicada desaparece');
    r = await gerente('GET', '/api/budget');
    const sumada = r.body.rows.find(function (x) { return x.personId === paula.id && x.clientId === nuevo.id && x.day === '2026-06-16'; });
    assert.strictEqual(sumada.hours, 7, 'mismo cliente y día: las horas se suman (5 + 2)');
    const movida = r.body.rows.find(function (x) { return x.personId === paula.id && x.clientId === kaia.id && x.day === '2026-06-16'; });
    assert.ok(movida && movida.hours === 3, 'las demás se traspasan');

    r = await gerente('POST', '/api/people', { name: 'Temporal', role: 'junior' });
    const temp = r.body.person;
    r = await senior('DELETE', '/api/people?id=' + temp.id);
    assert.strictEqual(r.status, 403, 'solo el gerente elimina');
    r = await gerente('DELETE', '/api/people?id=' + temp.id);
    assert.strictEqual(r.status, 200);
    r = await gerente('GET', '/api/auth');
    r = await gerente('DELETE', '/api/people?id=' + r.body.user.id);
    assert.strictEqual(r.status, 400, 'el gerente no se elimina a sí mismo');

    /* ---- login con Microsoft: sin configurar responde 503, nunca abre sesión ---- */
    r = await client()('POST', '/api/auth?action=microsoft', { idToken: 'a.b.c' });
    assert.strictEqual(r.status, 503);

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
