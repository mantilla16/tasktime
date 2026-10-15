/* Asignación de clientes a personas (independiente de las horas).

   GET    /api/assignments                       -> gerente/senior: todas; junior: las suyas
   POST   /api/assignments  { clientId, personId } -> gerente/senior: asigna el cliente
   DELETE /api/assignments?clientId=&personId=   -> gerente/senior: quita el cliente y
                                                    también las horas que tuviera con él */

const store = require('./_lib/store.js');
const auth = require('./_lib/auth.js');

function out(r) { return { clientId: r.client_id, personId: r.person_id }; }

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const sql = store.getSql();
  if (!sql) return store.fail(res, 500, store.MISSING_DB_MESSAGE);

  try {
    await store.ensureSchema(sql);
    const user = await auth.requireUser(req, res, sql);
    if (!user) return;

    if (req.method === 'GET') {
      const rows = auth.canManage(user)
        ? await sql`select client_id, person_id from assignments`
        : await sql`select client_id, person_id from assignments where person_id = ${user.id}`;
      return res.status(200).json({ assignments: rows.map(out) });
    }

    if (!auth.canManage(user)) return store.fail(res, 403, 'Solo gerentes y seniors asignan clientes.');

    if (req.method === 'POST') {
      const body = store.readBody(req) || {};
      const clientId = store.numOrNull(body.clientId);
      const personId = store.numOrNull(body.personId);
      if (!clientId || !personId) return store.fail(res, 400, 'Indica el cliente y la persona.');
      const c = await sql`select id from clients where id = ${clientId}`;
      const p = await sql`select id from people where id = ${personId} and active = true`;
      if (!c.length) return store.fail(res, 400, 'El cliente no existe.');
      if (!p.length) return store.fail(res, 400, 'La persona no existe o está inactiva.');
      await sql`insert into assignments (client_id, person_id) values (${clientId}, ${personId}) on conflict do nothing`;
      return res.status(201).json({ assignment: { clientId: clientId, personId: personId } });
    }

    if (req.method === 'DELETE') {
      const q = store.queryOf(req);
      const clientId = store.numOrNull(q.clientId);
      const personId = store.numOrNull(q.personId);
      if (!clientId || !personId) return store.fail(res, 400, 'Indica el cliente y la persona.');
      const horas = await sql`delete from budget_days where client_id = ${clientId} and person_id = ${personId} returning id`;
      await sql`delete from assignments where client_id = ${clientId} and person_id = ${personId}`;
      return res.status(200).json({ ok: true, removedDays: horas.length });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return store.fail(res, 405, 'Método no permitido.');

  } catch (err) {
    console.error('api/assignments:', err);
    return store.fail(res, 500, 'Error del servidor.', { detail: String((err && err.message) || err) });
  }
};
