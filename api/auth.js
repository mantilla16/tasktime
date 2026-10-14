/* Sesión de la persona que usa la app.

   GET  /api/auth                    -> { setupRequired, user }
   POST /api/auth?action=setup       -> crea la primera cuenta de gerente (solo si no existe ninguna)
   POST /api/auth?action=login       -> { email, password }
   POST /api/auth?action=logout
   POST /api/auth?action=password    -> { current, password } cambia la contraseña propia */

const store = require('./_lib/store.js');
const auth = require('./_lib/auth.js');

async function setupRequired(sql) {
  const rows = await sql`
    select count(*)::int as n from people
     where role = 'gerente' and password_hash is not null and active = true`;
  return Number(rows[0].n) === 0;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const sql = store.getSql();
  if (!sql) return store.fail(res, 500, store.MISSING_DB_MESSAGE);

  try {
    await store.ensureSchema(sql);
    const action = store.str(store.queryOf(req).action);

    if (req.method === 'GET') {
      const user = await auth.currentUser(sql, req);
      return res.status(200).json({
        setupRequired: await setupRequired(sql),
        user: user
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return store.fail(res, 405, 'Método no permitido.');
    }

    const body = store.readBody(req) || {};

    /* ---- primera cuenta ---- */
    if (action === 'setup') {
      if (!(await setupRequired(sql))) {
        return store.fail(res, 409, 'La app ya tiene una cuenta de gerente. Inicia sesión.');
      }
      const name = store.str(body.name, 120);
      const email = store.str(body.email, 200).toLowerCase();
      const problem = auth.passwordProblem(body.password);
      if (!name || !email) return store.fail(res, 400, 'Nombre y correo son obligatorios.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return store.fail(res, 400, 'El correo no es válido.');
      if (problem) return store.fail(res, 400, problem);

      const hash = auth.hashPassword(body.password);
      // Si el gerente ya figura (p. ej. cargado por nombre) lo reutilizamos.
      const existing = await sql`
        select id from people where lower(email) = ${email} or lower(name) = lower(${name}) limit 1`;
      let id;
      if (existing.length) {
        id = existing[0].id;
        await sql`
          update people set name = ${name}, email = ${email}, role = 'gerente',
                            password_hash = ${hash}, must_change_password = false, active = true
           where id = ${id}`;
      } else {
        const rows = await sql`
          insert into people (name, email, role, password_hash)
          values (${name}, ${email}, 'gerente', ${hash}) returning id`;
        id = rows[0].id;
      }

      let seeded = null;
      if (body.seed !== false) {
        seeded = await store.seedBudget(sql);
      }

      const token = await auth.createSession(sql, id);
      auth.setSessionCookie(req, res, token);
      const user = await auth.currentUser(sql, req) || null;
      const rows = await sql`select * from people where id = ${id}`;
      return res.status(201).json({ user: user || auth.publicPerson(rows[0]), seeded: seeded });
    }

    /* ---- entrar ---- */
    if (action === 'login') {
      const email = store.str(body.email, 200).toLowerCase();
      const password = String(body.password || '');
      if (!email || !password) return store.fail(res, 400, 'Escribe tu correo y tu contraseña.');

      const rows = await sql`
        select * from people where lower(email) = ${email} limit 1`;
      const person = rows[0];
      const ok = person && person.active && auth.verifyPassword(password, person.password_hash);
      if (!ok) {
        return store.fail(res, 401, 'Correo o contraseña incorrectos.');
      }
      const token = await auth.createSession(sql, person.id);
      auth.setSessionCookie(req, res, token);
      return res.status(200).json({ user: auth.publicPerson(person) });
    }

    /* ---- salir ---- */
    if (action === 'logout') {
      await auth.destroySession(sql, req);
      auth.clearSessionCookie(req, res);
      return res.status(200).json({ ok: true });
    }

    /* ---- cambiar la contraseña propia ---- */
    if (action === 'password') {
      const user = await auth.requireUser(req, res, sql);
      if (!user) return;
      const rows = await sql`select password_hash from people where id = ${user.id}`;
      if (!auth.verifyPassword(String(body.current || ''), rows[0].password_hash)) {
        return store.fail(res, 400, 'La contraseña actual no coincide.');
      }
      const problem = auth.passwordProblem(body.password);
      if (problem) return store.fail(res, 400, problem);
      await sql`
        update people set password_hash = ${auth.hashPassword(body.password)}, must_change_password = false
         where id = ${user.id}`;
      return res.status(200).json({ ok: true });
    }

    return store.fail(res, 400, 'Acción desconocida.');

  } catch (err) {
    console.error('api/auth:', err);
    return store.fail(res, 500, 'Error del servidor.', { detail: String((err && err.message) || err) });
  }
};
