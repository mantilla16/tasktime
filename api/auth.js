/* Sesión de la persona que usa la app.

   GET  /api/auth                    -> { setupRequired, user, dominio, msClientId, msTenantId }
   POST /api/auth?action=microsoft   -> { idToken } entra con la cuenta Microsoft 365 de la firma
   POST /api/auth?action=logout
   POST /api/auth?action=setup       -> solo sin Microsoft: crea la primera cuenta de gerente
   POST /api/auth?action=login       -> solo sin Microsoft: { email, password }
   POST /api/auth?action=password    -> solo sin Microsoft: { current, password }

   En producción se entra con Microsoft (mismo esquema que analitica-puc):
   MSAL obtiene un id_token en el navegador, aquí se verifica contra las
   claves del inquilino y se busca la persona por su correo. La primera
   persona que entra cuando no hay gerente queda como gerente y carga el
   presupuesto base; las demás que no estén registradas entran como junior.
   Las contraseñas solo existen para desarrollo local sin Microsoft. */

const store = require('./_lib/store.js');
const auth = require('./_lib/auth.js');
const entra = require('./_lib/entra.js');

async function setupRequired(sql) {
  const rows = await sql`
    select count(*)::int as n from people where role = 'gerente' and active = true
       and (password_hash is not null or email is not null)`;
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
        user: user,
        dominio: entra.dominio(),
        msClientId: entra.clientId() || null,
        msTenantId: entra.tenant() || null
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return store.fail(res, 405, 'Método no permitido.');
    }

    const body = store.readBody(req) || {};

    /* ---- salir ---- */
    if (action === 'logout') {
      await auth.destroySession(sql, req);
      auth.clearSessionCookie(req, res);
      return res.status(200).json({ ok: true });
    }

    /* ---- entrar con Microsoft ---- */
    if (action === 'microsoft') {
      if (!entra.configured()) {
        return store.fail(res, 503, 'El login con Microsoft no está configurado en el servidor.', { code: 'not_configured' });
      }
      let perfil;
      try {
        perfil = await entra.verifyIdToken(body.idToken);
      } catch (err) {
        console.warn('auth/microsoft: token rechazado:', err.message);
        return store.fail(res, 401, 'No se pudo validar tu sesión de Microsoft.');
      }
      const problema = entra.problemaConCorreo(perfil.correo);
      if (problema) return store.fail(res, 403, problema);

      const rows = await sql`select * from people where lower(email) = ${perfil.correo} limit 1`;
      let person = rows[0] || null;
      let seeded = null;
      if (person && !person.active) return store.fail(res, 403, 'Tu cuenta está desactivada. Habla con el gerente.');

      if (!person) {
        // Persona cargada del Excel sin correo y con el mismo nombre: se le
        // vincula el correo en vez de crear una cuenta duplicada.
        const porNombre = await sql`
          select * from people
           where email is null and active = true
             and lower(unaccent_simple(name)) = lower(unaccent_simple(${perfil.nombre}))
           limit 1`.catch(function () { return []; });
        if (porNombre.length) {
          const upd = await sql`update people set email = ${perfil.correo} where id = ${porNombre[0].id} returning *`;
          person = upd[0];
        }
      }
      if (!person) {
        const bootstrap = await setupRequired(sql);
        const role = bootstrap ? 'gerente' : 'junior';
        const created = await sql`
          insert into people (name, email, role) values (${perfil.nombre}, ${perfil.correo}, ${role})
          returning *`;
        person = created[0];
        if (bootstrap) seeded = await store.seedBudget(sql);
      }

      const token = await auth.createSession(sql, person.id);
      auth.setSessionCookie(req, res, token);
      return res.status(200).json({ user: auth.publicPerson(person), seeded: seeded });
    }

    /* ---- a partir de aquí: flujo con contraseña, solo sin Microsoft ---- */
    if (entra.configured() && action !== 'password') {
      return store.fail(res, 403, 'En este servidor se entra con la cuenta de Microsoft.');
    }

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
      if (body.seed !== false) seeded = await store.seedBudget(sql);

      const token = await auth.createSession(sql, id);
      auth.setSessionCookie(req, res, token);
      const rows = await sql`select * from people where id = ${id}`;
      return res.status(201).json({ user: auth.publicPerson(rows[0]), seeded: seeded });
    }

    if (action === 'login') {
      const email = store.str(body.email, 200).toLowerCase();
      const password = String(body.password || '');
      if (!email || !password) return store.fail(res, 400, 'Escribe tu correo y tu contraseña.');
      const rows = await sql`select * from people where lower(email) = ${email} limit 1`;
      const person = rows[0];
      const ok = person && person.active && auth.verifyPassword(password, person.password_hash);
      if (!ok) return store.fail(res, 401, 'Correo o contraseña incorrectos.');
      const token = await auth.createSession(sql, person.id);
      auth.setSessionCookie(req, res, token);
      return res.status(200).json({ user: auth.publicPerson(person) });
    }

    if (action === 'password') {
      if (entra.configured()) return store.fail(res, 403, 'En este servidor se entra con la cuenta de Microsoft; no hay contraseñas.');
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
