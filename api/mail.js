/* Notificaciones por correo.

   GET    /api/mail  -> gerente/senior: { configured, connected, email, name, connectedAt, lastError }
   POST   /api/mail  -> gerente/senior: { taskId } envía el aviso a la persona asignada
   DELETE /api/mail  -> gerente: desconecta la cuenta remitente

   El cuerpo del correo se arma AQUÍ a partir de la tarea guardada en la base, no
   con lo que mande el navegador: así este endpoint no se puede usar para enviar
   texto arbitrario a direcciones arbitrarias. El destinatario es siempre la
   persona asignada a la tarea, registrada en el equipo. */

const g = require('./_lib/google.js');
const store = require('./_lib/store.js');
const auth = require('./_lib/auth.js');

const PRIORITY_LABELS = { alta: 'Alta', media: 'Media', baja: 'Baja' };
const PHASE_LABELS = {
  previas: 'Actividades previas', planeacion: 'Planeación', ejecucion: 'Ejecución', cierre: 'Cierre',
  informe: 'Informe mensual', vacaciones: 'Vacaciones', compensatorio: 'Compensatorio', especiales: 'Proyectos especiales'
};
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function fmtDate(iso) {
  if (!iso) return '';
  const parts = String(iso).slice(0, 10).split('-');
  if (parts.length !== 3) return String(iso);
  const month = MONTHS_ES[Number(parts[1]) - 1] || parts[1];
  return Number(parts[2]) + ' ' + month + ' ' + parts[0];
}

function bodyFor(task, assignedBy, appUrl) {
  const details = [
    'Tarea: ' + task.title,
    'Cliente: ' + (task.client_name || 'Sin cliente')
  ];
  if (task.phase) details.push('Fase: ' + (PHASE_LABELS[task.phase] || task.phase));
  details.push('Prioridad: ' + (PRIORITY_LABELS[task.priority] || task.priority || 'Media'));
  if (task.start_date) details.push('Fecha de inicio: ' + fmtDate(task.start_date));
  details.push('Fecha límite: ' + (task.due_date ? fmtDate(task.due_date) : 'Sin definir'));
  if (task.hours_budget != null) details.push('Horas presupuestadas: ' + Number(task.hours_budget));

  const lines = [
    'Hola ' + (task.assignee_name || '') + ',',
    '',
    (assignedBy ? assignedBy + ' te asignó' : 'Se te asignó') + ' una tarea en Russell:',
    '',
    details.join('\n')
  ];
  if (task.description) lines.push('', 'Descripción:', task.description);
  if (appUrl) lines.push('', 'Ábrela en Russell: ' + appUrl);
  return lines.join('\n');
}

function statusPayload(sender) {
  return {
    configured: g.isConfigured(),
    connected: Boolean(sender),
    email: sender ? sender.email : null,
    name: sender ? (sender.name || null) : null,
    connectedAt: sender ? sender.connected_at : null,
    lastError: sender ? (sender.last_error || null) : null
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const sql = store.getSql();
  if (!sql) return store.fail(res, 500, store.MISSING_DB_MESSAGE);

  try {
    await store.ensureSchema(sql);

    if (req.method === 'GET') {
      const user = await auth.requireUser(req, res, sql, ['gerente', 'senior']);
      if (!user) return;
      return res.status(200).json(statusPayload(await store.readSender(sql)));
    }

    if (req.method === 'DELETE') {
      const user = await auth.requireUser(req, res, sql, ['gerente']);
      if (!user) return;
      await store.deleteSender(sql);
      return res.status(200).json(statusPayload(null));
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, DELETE');
      return store.fail(res, 405, 'Método no permitido.');
    }

    /* ---- envío ---- */

    const user = await auth.requireUser(req, res, sql, ['gerente', 'senior']);
    if (!user) return;

    if (!g.isConfigured()) {
      return res.status(503).json({
        code: 'not_configured',
        error: 'El envío de correo no está configurado: faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en Vercel.'
      });
    }

    const body = store.readBody(req);
    const taskId = body && Number(body.taskId);
    if (!taskId) return store.fail(res, 400, 'Cuerpo inválido: se esperaba { taskId }.');

    const sender = await store.readSender(sql);
    if (!sender) {
      return res.status(409).json({
        code: 'not_connected',
        error: 'No hay una cuenta de Google conectada para enviar. El gerente la conecta en Ajustes.'
      });
    }

    const rows = await sql`
      select t.*, c.name as client_name, a.name as assignee_name, a.email as assignee_email, a.active as assignee_active,
             to_char(t.start_date, 'YYYY-MM-DD') as start_date,
             to_char(t.due_date, 'YYYY-MM-DD') as due_date
        from tasks t
        left join clients c on c.id = t.client_id
        left join people a on a.id = t.assignee_id
       where t.id = ${taskId}`;
    const task = rows[0];
    if (!task) return store.fail(res, 404, 'La tarea no existe.');
    if (!task.assignee_id || !task.assignee_email || !task.assignee_active) {
      return store.fail(res, 400, 'La tarea no tiene a nadie asignado con correo registrado.');
    }

    let accessToken;
    try {
      const refreshed = await g.refreshAccessToken(sender.refresh_token);
      accessToken = refreshed.access_token;
      if (!accessToken) throw new Error('Google no devolvió un access_token.');
    } catch (err) {
      /* invalid_grant = el permiso fue revocado o caducó (pasa cada 7 días
         mientras la app de Google Cloud siga en modo "Testing"). */
      const revoked = err.googleError === 'invalid_grant';
      const message = revoked
        ? 'El permiso de Google caducó o fue revocado. El gerente debe volver a conectar la cuenta en Ajustes.'
        : ('Google rechazó la renovación del permiso: ' + err.message);
      await store.setSenderError(sql, message);
      return res.status(409).json({ code: revoked ? 'needs_reauth' : 'refresh_failed', error: message });
    }

    try {
      await g.sendMail(accessToken, {
        from: sender.email,
        fromName: sender.name || 'Russell',
        to: task.assignee_email,
        toName: task.assignee_name || '',
        subject: 'Nueva tarea asignada: ' + task.title,
        body: bodyFor(task, user.name, g.originOf(req) + '/'),
        replyTo: sender.email
      });
    } catch (err) {
      const message = 'Gmail no pudo enviar el correo: ' + err.message;
      await store.setSenderError(sql, message);
      return res.status(502).json({ code: 'send_failed', error: message });
    }

    await store.clearSenderError(sql);
    await sql`update tasks set notified_at = now() where id = ${taskId}`;
    return res.status(200).json({
      sentAt: new Date().toISOString(),
      from: sender.email,
      to: task.assignee_email,
      toName: task.assignee_name || ''
    });

  } catch (err) {
    console.error('api/mail:', err);
    return store.fail(res, 500, 'Error del servidor de correo.', { detail: String((err && err.message) || err) });
  }
};
