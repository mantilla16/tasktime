/* Clientes.

   GET    /api/clients        -> cualquier persona autenticada
   POST   /api/clients        -> gerente/senior: { name }
   PATCH  /api/clients?id=N   -> gerente/senior: { name?, active? } */

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
      const rows = await sql`select id, name, active from clients order by name`;
      return res.status(200).json({ clients: rows });
    }

    const user = await auth.requireUser(req, res, sql, ['gerente', 'senior']);
    if (!user) return;
    const body = store.readBody(req) || {};

    if (req.method === 'POST') {
      const name = store.str(body.name, 160);
      if (!name) return store.fail(res, 400, 'El nombre es obligatorio.');
      const dup = await sql`select id from clients where lower(name) = lower(${name})`;
      if (dup.length) return store.fail(res, 409, 'Ya existe un cliente con ese nombre.');
      const rows = await sql`insert into clients (name) values (${name}) returning id, name, active`;
      return res.status(201).json({ client: rows[0] });
    }

    if (req.method === 'PATCH') {
      const id = Number(store.queryOf(req).id);
      if (!id) return store.fail(res, 400, 'Falta el id.');
      const rows = await sql`select * from clients where id = ${id}`;
      const c = rows[0];
      if (!c) return store.fail(res, 404, 'El cliente no existe.');
      const name = body.name !== undefined ? store.str(body.name, 160) : c.name;
      const active = body.active !== undefined ? Boolean(body.active) : c.active;
      if (!name) return store.fail(res, 400, 'El nombre es obligatorio.');
      const dup = await sql`select id from clients where lower(name) = lower(${name}) and id <> ${id}`;
      if (dup.length) return store.fail(res, 409, 'Ya existe un cliente con ese nombre.');
      const updated = await sql`
        update clients set name = ${name}, active = ${active} where id = ${id}
        returning id, name, active`;
      return res.status(200).json({ client: updated[0] });
    }

    res.setHeader('Allow', 'GET, POST, PATCH');
    return store.fail(res, 405, 'Método no permitido.');

  } catch (err) {
    console.error('api/clients:', err);
    return store.fail(res, 500, 'Error del servidor.', { detail: String((err && err.message) || err) });
  }
};
