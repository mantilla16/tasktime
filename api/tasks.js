/* Tareas.

   GET    /api/tasks                       -> gerente/senior: todas; junior: solo las suyas
   GET    /api/tasks?id=N                  -> una tarea con sus avances (comentarios)
   POST   /api/tasks                       -> gerente/senior: crear
   POST   /api/tasks?id=N&action=comment   -> quien pueda ver la tarea: { body }
   PATCH  /api/tasks?id=N                  -> gerente/senior: cualquier campo
                                              junior: solo status y hours_spent de sus tareas
   DELETE /api/tasks?id=N                  -> gerente/senior

   La visibilidad se decide aquí, en el servidor: un junior nunca recibe
   tareas que no estén asignadas a él, pida lo que pida el navegador. */

const store = require('./_lib/store.js');
const auth = require('./_lib/auth.js');

function rowToTask(r) {
  return {
    id: r.id,
    title: r.title,
    description: r.description || '',
    clientId: r.client_id,
    clientName: r.client_name || null,
    phase: r.phase || null,
    assigneeId: r.assignee_id,
    assigneeName: r.assignee_name || null,
    assigneeEmail: r.assignee_email || null,
    createdBy: r.created_by,
    creatorName: r.creator_name || null,
    status: r.status,
    priority: r.priority,
    startDate: r.start_date || null,
    dueDate: r.due_date || null,
    hoursBudget: r.hours_budget == null ? null : Number(r.hours_budget),
    hoursSpent: Number(r.hours_spent) || 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
    notifiedAt: r.notified_at,
    commentsCount: Number(r.comments_count) || 0
  };
}

async function fetchTask(sql, id) {
  const rows = await sql`
    select t.*, c.name as client_name, a.name as assignee_name, a.email as assignee_email,
           cr.name as creator_name,
           to_char(t.start_date, 'YYYY-MM-DD') as start_date,
           to_char(t.due_date, 'YYYY-MM-DD') as due_date,
           (select count(*)::int from task_comments k where k.task_id = t.id) as comments_count
      from tasks t
      left join clients c on c.id = t.client_id
      left join people a on a.id = t.assignee_id
      left join people cr on cr.id = t.created_by
     where t.id = ${id}`;
  return rows[0] ? rowToTask(rows[0]) : null;
}

async function fetchComments(sql, taskId) {
  const rows = await sql`
    select k.id, k.body, k.created_at, k.person_id, p.name as person_name
      from task_comments k
      left join people p on p.id = k.person_id
     where k.task_id = ${taskId}
     order by k.created_at asc`;
  return rows.map(function (r) {
    return { id: r.id, body: r.body, createdAt: r.created_at, personId: r.person_id, personName: r.person_name || null };
  });
}

function canSee(user, task) {
  if (auth.canManage(user)) return true;
  return task && task.assigneeId === user.id;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const sql = store.getSql();
  if (!sql) return store.fail(res, 500, store.MISSING_DB_MESSAGE);

  try {
    await store.ensureSchema(sql);
    const user = await auth.requireUser(req, res, sql);
    if (!user) return;

    const q = store.queryOf(req);
    const id = q.id ? Number(q.id) : null;
    const action = store.str(q.action);
    const body = store.readBody(req) || {};

    /* ---------------- lectura ---------------- */

    if (req.method === 'GET') {
      if (id) {
        const task = await fetchTask(sql, id);
        if (!task || !canSee(user, task)) return store.fail(res, 404, 'La tarea no existe.');
        task.comments = await fetchComments(sql, id);
        return res.status(200).json({ task: task });
      }
      const rows = auth.canManage(user)
        ? await sql`
            select t.*, c.name as client_name, a.name as assignee_name, a.email as assignee_email,
                   cr.name as creator_name,
                   to_char(t.start_date, 'YYYY-MM-DD') as start_date,
                   to_char(t.due_date, 'YYYY-MM-DD') as due_date,
                   (select count(*)::int from task_comments k where k.task_id = t.id) as comments_count
              from tasks t
              left join clients c on c.id = t.client_id
              left join people a on a.id = t.assignee_id
              left join people cr on cr.id = t.created_by
             order by t.created_at desc`
        : await sql`
            select t.*, c.name as client_name, a.name as assignee_name, a.email as assignee_email,
                   cr.name as creator_name,
                   to_char(t.start_date, 'YYYY-MM-DD') as start_date,
                   to_char(t.due_date, 'YYYY-MM-DD') as due_date,
                   (select count(*)::int from task_comments k where k.task_id = t.id) as comments_count
              from tasks t
              left join clients c on c.id = t.client_id
              left join people a on a.id = t.assignee_id
              left join people cr on cr.id = t.created_by
             where t.assignee_id = ${user.id}
             order by t.created_at desc`;
      return res.status(200).json({ tasks: rows.map(rowToTask) });
    }

    /* ---------------- avances (comentarios) ---------------- */

    if (req.method === 'POST' && id && action === 'comment') {
      const task = await fetchTask(sql, id);
      if (!task || !canSee(user, task)) return store.fail(res, 404, 'La tarea no existe.');
      const text = store.str(body.body, 4000);
      if (!text) return store.fail(res, 400, 'Escribe el avance.');
      await sql`insert into task_comments (task_id, person_id, body) values (${id}, ${user.id}, ${text})`;
      await sql`update tasks set updated_at = now() where id = ${id}`;
      return res.status(201).json({ comments: await fetchComments(sql, id) });
    }

    /* ---------------- crear ---------------- */

    if (req.method === 'POST') {
      if (!auth.canManage(user)) return store.fail(res, 403, 'Solo gerentes y seniors crean tareas.');
      const title = store.str(body.title, 200);
      if (!title) return store.fail(res, 400, 'El título es obligatorio.');
      const v = await validateFields(sql, res, body, {});
      if (!v) return;
      const rows = await sql`
        insert into tasks (title, description, client_id, phase, assignee_id, created_by, status, priority,
                           start_date, due_date, hours_budget, hours_spent, completed_at)
        values (${title}, ${v.description}, ${v.clientId}, ${v.phase}, ${v.assigneeId}, ${user.id},
                ${v.status}, ${v.priority}, ${v.startDate}, ${v.dueDate}, ${v.hoursBudget}, ${v.hoursSpent},
                ${v.status === 'terminada' ? new Date().toISOString() : null})
        returning id`;
      return res.status(201).json({ task: await fetchTask(sql, rows[0].id) });
    }

    /* ---------------- editar ---------------- */

    if (req.method === 'PATCH') {
      if (!id) return store.fail(res, 400, 'Falta el id.');
      const current = await fetchTask(sql, id);
      if (!current || !canSee(user, current)) return store.fail(res, 404, 'La tarea no existe.');

      if (!auth.canManage(user)) {
        // Junior: solo avance de estado y horas invertidas en lo suyo.
        const status = body.status !== undefined ? store.str(body.status) : current.status;
        const hoursSpent = body.hoursSpent !== undefined ? store.numOrNull(body.hoursSpent) : current.hoursSpent;
        if (store.STATUSES.indexOf(status) === -1) return store.fail(res, 400, 'Estado inválido.');
        if (hoursSpent === null || hoursSpent < 0) return store.fail(res, 400, 'Horas inválidas.');
        const completedAt = status === 'terminada'
          ? (current.completedAt || new Date().toISOString())
          : null;
        await sql`
          update tasks set status = ${status}, hours_spent = ${hoursSpent},
                           completed_at = ${completedAt}, updated_at = now()
           where id = ${id}`;
        return res.status(200).json({ task: await fetchTask(sql, id) });
      }

      const title = body.title !== undefined ? store.str(body.title, 200) : current.title;
      if (!title) return store.fail(res, 400, 'El título es obligatorio.');
      const v = await validateFields(sql, res, body, current);
      if (!v) return;
      const completedAt = v.status === 'terminada'
        ? (current.completedAt || new Date().toISOString())
        : null;
      // Si cambia la persona asignada, la notificación anterior deja de valer.
      const notifiedAt = v.assigneeId !== current.assigneeId ? null : current.notifiedAt;
      await sql`
        update tasks
           set title = ${title}, description = ${v.description}, client_id = ${v.clientId}, phase = ${v.phase},
               assignee_id = ${v.assigneeId}, status = ${v.status}, priority = ${v.priority},
               start_date = ${v.startDate}, due_date = ${v.dueDate}, hours_budget = ${v.hoursBudget},
               hours_spent = ${v.hoursSpent}, completed_at = ${completedAt}, notified_at = ${notifiedAt},
               updated_at = now()
         where id = ${id}`;
      return res.status(200).json({ task: await fetchTask(sql, id) });
    }

    /* ---------------- borrar ---------------- */

    if (req.method === 'DELETE') {
      if (!auth.canManage(user)) return store.fail(res, 403, 'Solo gerentes y seniors eliminan tareas.');
      if (!id) return store.fail(res, 400, 'Falta el id.');
      const rows = await sql`delete from tasks where id = ${id} returning id`;
      if (!rows.length) return store.fail(res, 404, 'La tarea no existe.');
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return store.fail(res, 405, 'Método no permitido.');

  } catch (err) {
    console.error('api/tasks:', err);
    return store.fail(res, 500, 'Error del servidor.', { detail: String((err && err.message) || err) });
  }
};

/* Normaliza y valida los campos editables por gerente/senior. Devuelve null
   (y ya respondió el error) si algo no cuadra. */
async function validateFields(sql, res, body, current) {
  const out = {
    description: body.description !== undefined ? store.str(body.description, 8000) : (current.description || ''),
    clientId: body.clientId !== undefined ? (store.numOrNull(body.clientId) || null) : (current.clientId || null),
    phase: body.phase !== undefined ? (store.str(body.phase) || null) : (current.phase || null),
    assigneeId: body.assigneeId !== undefined ? (store.numOrNull(body.assigneeId) || null) : (current.assigneeId || null),
    status: body.status !== undefined ? store.str(body.status) : (current.status || 'pendiente'),
    priority: body.priority !== undefined ? store.str(body.priority) : (current.priority || 'media'),
    startDate: body.startDate !== undefined ? store.dateOrNull(body.startDate) : (current.startDate || null),
    dueDate: body.dueDate !== undefined ? store.dateOrNull(body.dueDate) : (current.dueDate || null),
    hoursBudget: body.hoursBudget !== undefined ? store.numOrNull(body.hoursBudget) : (current.hoursBudget == null ? null : current.hoursBudget),
    hoursSpent: body.hoursSpent !== undefined ? (store.numOrNull(body.hoursSpent) || 0) : (current.hoursSpent || 0)
  };
  if (out.phase && store.PHASES.indexOf(out.phase) === -1) { store.fail(res, 400, 'Fase inválida.'); return null; }
  if (store.STATUSES.indexOf(out.status) === -1) { store.fail(res, 400, 'Estado inválido.'); return null; }
  if (store.PRIORITIES.indexOf(out.priority) === -1) { store.fail(res, 400, 'Prioridad inválida.'); return null; }
  if (out.hoursBudget !== null && out.hoursBudget < 0) { store.fail(res, 400, 'Horas presupuestadas inválidas.'); return null; }
  if (out.hoursSpent < 0) { store.fail(res, 400, 'Horas invertidas inválidas.'); return null; }
  if (out.startDate && out.dueDate && out.dueDate < out.startDate) {
    store.fail(res, 400, 'La fecha límite no puede ser anterior al inicio.'); return null;
  }
  if (out.clientId) {
    const c = await sql`select id from clients where id = ${out.clientId}`;
    if (!c.length) { store.fail(res, 400, 'El cliente no existe.'); return null; }
  }
  if (out.assigneeId) {
    const p = await sql`select id from people where id = ${out.assigneeId} and active = true`;
    if (!p.length) { store.fail(res, 400, 'La persona asignada no existe o está inactiva.'); return null; }
  }
  return out;
}
