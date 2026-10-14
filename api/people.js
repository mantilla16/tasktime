/* Equipo.

   GET    /api/people        -> gerente/senior: lista completa; junior: solo id, nombre y rol
   POST   /api/people        -> gerente: { name, email, role, password? }
   PATCH  /api/people?id=N   -> gerente: { name?, email?, role?, active?, password? }

   Solo el gerente administra cuentas. Al poner una contraseña a alguien se le
   marca "debe cambiarla" para que la reemplace en su primer ingreso. */

const store = require('./_lib/store.js');
const auth = require('./_lib/auth.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const sql = store.getSql();
  if (!sql) return store.fail(res, 500, store.MISSING_DB_MESSAGE);

  try {
    await store.ensureSchema(sql);

    if (req.method === 'GET') {
      const user = await auth.requireUser(req, res, sql);
      if (!user) return;
      const rows = await sql`
        select p.id, p.name, p.email, p.role, p.active, p.password_hash, p.must_change_password, p.created_at,
               (select count(*)::int from tasks t where t.assignee_id = p.id and t.status <> 'terminada') as open_tasks
          from people p
         order by case p.role when 'gerente' then 0 when 'senior' then 1 else 2 end, p.name`;
      if (auth.canManage(user)) {
        return res.status(200).json({
          people: rows.map(function (r) {
            const p = auth.publicPerson(r);
            p.openTasks = Number(r.open_tasks) || 0;
            return p;
          })
        });
      }
      // Junior: nombres para mostrar quién creó o comentó una tarea; nada más.
      return res.status(200).json({
        people: rows.filter(function (r) { return r.active; })
          .map(function (r) { return { id: r.id, name: r.name, role: r.role, active: true }; })
      });
    }

    const user = await auth.requireUser(req, res, sql, ['gerente']);
    if (!user) return;
    const body = store.readBody(req) || {};

    if (req.method === 'POST') {
      const name = store.str(body.name, 120);
      const email = store.str(body.email, 200).toLowerCase() || null;
      const role = store.str(body.role) || 'junior';
      if (!name) return store.fail(res, 400, 'El nombre es obligatorio.');
      if (store.ROLES.indexOf(role) === -1) return store.fail(res, 400, 'Rol inválido.');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return store.fail(res, 400, 'El correo no es válido.');
      let hash = null;
      if (body.password) {
        const problem = auth.passwordProblem(body.password);
        if (problem) return store.fail(res, 400, problem);
        hash = auth.hashPassword(body.password);
      }
      if (email) {
        const dup = await sql`select id from people where lower(email) = ${email}`;
        if (dup.length) return store.fail(res, 409, 'Ya hay una persona con ese correo.');
      }
      const rows = await sql`
        insert into people (name, email, role, password_hash, must_change_password)
        values (${name}, ${email}, ${role}, ${hash}, ${Boolean(hash)})
        returning *`;
      return res.status(201).json({ person: auth.publicPerson(rows[0]) });
    }

    if (req.method === 'PATCH') {
      const id = Number(store.queryOf(req).id);
      if (!id) return store.fail(res, 400, 'Falta el id.');
      const rows = await sql`select * from people where id = ${id}`;
      const p = rows[0];
      if (!p) return store.fail(res, 404, 'La persona no existe.');

      const name = body.name !== undefined ? store.str(body.name, 120) : p.name;
      const email = body.email !== undefined ? (store.str(body.email, 200).toLowerCase() || null) : p.email;
      const role = body.role !== undefined ? store.str(body.role) : p.role;
      const active = body.active !== undefined ? Boolean(body.active) : p.active;
      let hash = p.password_hash;
      let mustChange = p.must_change_password;

      if (!name) return store.fail(res, 400, 'El nombre es obligatorio.');
      if (store.ROLES.indexOf(role) === -1) return store.fail(res, 400, 'Rol inválido.');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return store.fail(res, 400, 'El correo no es válido.');
      if (id === user.id && (role !== 'gerente' || !active)) {
        return store.fail(res, 400, 'No puedes quitarte el rol de gerente ni desactivar tu propia cuenta.');
      }
      if (email && email !== p.email) {
        const dup = await sql`select id from people where lower(email) = ${email} and id <> ${id}`;
        if (dup.length) return store.fail(res, 409, 'Ya hay una persona con ese correo.');
      }
      if (body.password) {
        const problem = auth.passwordProblem(body.password);
        if (problem) return store.fail(res, 400, problem);
        hash = auth.hashPassword(body.password);
        mustChange = id !== user.id;
      }

      const updated = await sql`
        update people
           set name = ${name}, email = ${email}, role = ${role}, active = ${active},
               password_hash = ${hash}, must_change_password = ${mustChange}
         where id = ${id}
        returning *`;

      // Cambiar rol, desactivar o resetear la clave invalida las sesiones abiertas de esa persona.
      if (id !== user.id && (!active || role !== p.role || hash !== p.password_hash)) {
        await auth.destroyAllSessions(sql, id);
      }
      return res.status(200).json({ person: auth.publicPerson(updated[0]) });
    }

    res.setHeader('Allow', 'GET, POST, PATCH');
    return store.fail(res, 405, 'Método no permitido.');

  } catch (err) {
    console.error('api/people:', err);
    return store.fail(res, 500, 'Error del servidor.', { detail: String((err && err.message) || err) });
  }
};
