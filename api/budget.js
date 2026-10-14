/* Presupuesto de horas por semana (la hoja de Excel, en la base de datos).

   GET  /api/budget                -> { weeks, rows }  junior: solo sus filas
   PUT  /api/budget                -> gerente/senior: { rows:[{ clientId, personId, weekIdx, hours, phase, note }] }
                                      una celda sin horas, fase ni nota se elimina
   POST /api/budget?action=seed    -> gerente: recarga data/presupuesto-2026.json (no borra lo demás) */

const store = require('./_lib/store.js');
const auth = require('./_lib/auth.js');

function rowOut(r) {
  return {
    clientId: r.client_id,
    personId: r.person_id,
    weekIdx: r.week_idx,
    hours: r.hours == null ? null : Number(r.hours),
    phase: r.phase || null,
    note: r.note || null
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const sql = store.getSql();
  if (!sql) return store.fail(res, 500, store.MISSING_DB_MESSAGE);

  try {
    await store.ensureSchema(sql);
    const user = await auth.requireUser(req, res, sql);
    if (!user) return;
    const action = store.str(store.queryOf(req).action);

    if (req.method === 'GET') {
      const weeks = await sql`
        select idx, to_char(week_start, 'YYYY-MM-DD') as start, label, month, capacity
          from weeks order by idx`;
      const rows = auth.canManage(user)
        ? await sql`select * from budget`
        : await sql`select * from budget where person_id = ${user.id}`;
      return res.status(200).json({
        weeks: weeks.map(function (w) {
          return { idx: w.idx, start: w.start, label: w.label, month: w.month, capacity: Number(w.capacity) || 0 };
        }),
        rows: rows.map(rowOut)
      });
    }

    if (req.method === 'POST' && action === 'seed') {
      if (user.role !== 'gerente') return store.fail(res, 403, 'Solo el gerente recarga el presupuesto base.');
      const result = await store.seedBudget(sql);
      return res.status(200).json({ seeded: result });
    }

    if (req.method === 'PUT') {
      if (!auth.canManage(user)) return store.fail(res, 403, 'Solo gerentes y seniors editan el presupuesto.');
      const body = store.readBody(req) || {};
      const list = Array.isArray(body.rows) ? body.rows : null;
      if (!list || !list.length) return store.fail(res, 400, 'Se esperaba { rows: [...] }.');
      if (list.length > 500) return store.fail(res, 400, 'Demasiadas celdas en una sola petición.');

      const saved = [];
      for (const r of list) {
        const clientId = store.numOrNull(r.clientId);
        const personId = store.numOrNull(r.personId);
        const weekIdx = store.numOrNull(r.weekIdx);
        const hours = store.numOrNull(r.hours);
        const phase = store.str(r.phase) || null;
        const note = store.str(r.note, 300) || null;
        if (!clientId || !personId || weekIdx === null) return store.fail(res, 400, 'Celda incompleta.');
        if (phase && store.PHASES.indexOf(phase) === -1) return store.fail(res, 400, 'Fase inválida.');
        if (hours !== null && hours < 0) return store.fail(res, 400, 'Horas inválidas.');

        if (hours === null && !phase && !note) {
          await sql`
            delete from budget where client_id = ${clientId} and person_id = ${personId} and week_idx = ${weekIdx}`;
          saved.push({ clientId: clientId, personId: personId, weekIdx: weekIdx, deleted: true });
          continue;
        }
        const w = await sql`select idx from weeks where idx = ${weekIdx}`;
        if (!w.length) return store.fail(res, 400, 'La semana no existe.');
        const rows = await sql`
          insert into budget (client_id, person_id, week_idx, hours, phase, note)
          values (${clientId}, ${personId}, ${weekIdx}, ${hours}, ${phase}, ${note})
          on conflict (client_id, person_id, week_idx) do update
            set hours = excluded.hours, phase = excluded.phase, note = excluded.note
          returning *`;
        saved.push(rowOut(rows[0]));
      }
      return res.status(200).json({ rows: saved });
    }

    res.setHeader('Allow', 'GET, PUT, POST');
    return store.fail(res, 405, 'Método no permitido.');

  } catch (err) {
    console.error('api/budget:', err);
    return store.fail(res, 500, 'Error del servidor.', { detail: String((err && err.message) || err) });
  }
};
