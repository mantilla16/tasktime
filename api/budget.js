/* Presupuesto de horas por semana (la hoja de Excel, en la base de datos).

   GET  /api/budget                -> { weeks, rows }  junior: solo sus filas
   PUT  /api/budget                -> gerente/senior: { rows:[{ clientId, personId, weekIdx, hours, phase, note }] }
                                      una celda sin horas, fase ni nota se elimina
   POST /api/budget?action=seed    -> gerente: recarga data/presupuesto-2026.json (no borra lo demás)
   POST /api/budget?action=weeks   -> gerente: { until: 'YYYY-MM-DD' } amplía el calendario hasta esa fecha
   PATCH /api/budget?action=week   -> gerente: { idx, label?, month?, capacity? } ajusta una semana */

const store = require('./_lib/store.js');
const auth = require('./_lib/auth.js');
const calendario = require('./_lib/calendario.js');

function weekOut(w) {
  return { idx: w.idx, start: w.start, label: w.label, month: w.month, capacity: Number(w.capacity) || 0 };
}

async function readWeeks(sql) {
  const rows = await sql`
    select idx, to_char(week_start, 'YYYY-MM-DD') as start, label, month, capacity
      from weeks order by idx`;
  return rows.map(weekOut);
}

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
      const rows = auth.canManage(user)
        ? await sql`select * from budget`
        : await sql`select * from budget where person_id = ${user.id}`;
      return res.status(200).json({ weeks: await readWeeks(sql), rows: rows.map(rowOut) });
    }

    /* ---- ampliar el calendario ---- */
    if (req.method === 'POST' && action === 'weeks') {
      if (user.role !== 'gerente') return store.fail(res, 403, 'Solo el gerente amplía el calendario.');
      const body = store.readBody(req) || {};
      const until = store.dateOrNull(body.until);
      if (!until) return store.fail(res, 400, 'Indica hasta qué fecha ampliar (AAAA-MM-DD).');
      const existing = await readWeeks(sql);
      const last = existing.length ? existing[existing.length - 1] : null;
      if (last && until <= last.start) {
        return store.fail(res, 400, 'El calendario ya llega hasta la semana del ' + last.start + '. Elige una fecha posterior.');
      }
      const nuevas = calendario.generarSemanas(last ? last.start : null, until, body.from || until);
      if (!nuevas.length) return store.fail(res, 400, 'No hay semanas nuevas que agregar hasta esa fecha.');
      if (nuevas.length > 260) return store.fail(res, 400, 'Amplía como máximo cinco años por vez.');
      let idx = last ? last.idx + 1 : 0;
      for (const w of nuevas) {
        await sql`
          insert into weeks (idx, week_start, label, month, capacity)
          values (${idx}, ${w.start}, ${w.label}, ${w.month}, ${w.capacity})
          on conflict (idx) do nothing`;
        idx++;
      }
      return res.status(201).json({ added: nuevas.length, weeks: await readWeeks(sql) });
    }

    /* ---- ajustar una semana ---- */
    if (req.method === 'PATCH' && action === 'week') {
      if (user.role !== 'gerente') return store.fail(res, 403, 'Solo el gerente ajusta las semanas.');
      const body = store.readBody(req) || {};
      const idx = store.numOrNull(body.idx);
      if (idx === null) return store.fail(res, 400, 'Falta la semana.');
      const rows = await sql`select idx, label, month, capacity from weeks where idx = ${idx}`;
      if (!rows.length) return store.fail(res, 404, 'La semana no existe.');
      const w = rows[0];
      const label = body.label !== undefined ? store.str(body.label, 40) : w.label;
      const month = body.month !== undefined ? store.str(body.month, 20) : w.month;
      const capacity = body.capacity !== undefined ? store.numOrNull(body.capacity) : Number(w.capacity);
      if (!label || !month) return store.fail(res, 400, 'La etiqueta y el mes son obligatorios.');
      if (capacity === null || capacity < 0 || capacity > 168) return store.fail(res, 400, 'Cargabilidad inválida.');
      await sql`update weeks set label = ${label}, month = ${month}, capacity = ${capacity} where idx = ${idx}`;
      return res.status(200).json({ weeks: await readWeeks(sql) });
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

    res.setHeader('Allow', 'GET, PUT, POST, PATCH');
    return store.fail(res, 405, 'Método no permitido.');

  } catch (err) {
    console.error('api/budget:', err);
    return store.fail(res, 500, 'Error del servidor.', { detail: String((err && err.message) || err) });
  }
};
