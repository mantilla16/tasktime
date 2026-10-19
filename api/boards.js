/* Tableros: un grupo de personas y de clientes para ver y asignar aparte.

   El tablero "General" no está en la base: es la vista de todo (todas las
   personas y todos los clientes). Los demás acotan las pantallas a sus
   miembros y sus clientes; la asignación cliente-persona y las horas siguen
   siendo las mismas en todos.

   GET    /api/boards           -> gerente/senior: todos; junior: en los que participa
   POST   /api/boards           -> gerente/senior: { name, people:[ids], clients:[ids] }
   PATCH  /api/boards?id=N      -> gerente/senior: { name?, people?, clients? }
   DELETE /api/boards?id=N      -> gerente/senior */

const store = require('./_lib/store.js');
const auth = require('./_lib/auth.js');

async function readBoards(sql, onlyPersonId) {
  const boards = onlyPersonId
    ? await sql`
        select b.id, b.name, b.created_at from boards b
         where exists (select 1 from board_people bp where bp.board_id = b.id and bp.person_id = ${onlyPersonId})
         order by b.name`
    : await sql`select id, name, created_at from boards order by name`;
  const people = await sql`select board_id, person_id from board_people`;
  const clients = await sql`select board_id, client_id from board_clients`;
  return boards.map(function (b) {
    return {
      id: b.id,
      name: b.name,
      createdAt: b.created_at,
      people: people.filter(function (x) { return x.board_id === b.id; }).map(function (x) { return x.person_id; }),
      clients: clients.filter(function (x) { return x.board_id === b.id; }).map(function (x) { return x.client_id; })
    };
  });
}

function idList(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  v.forEach(function (x) { const n = Number(x); if (Number.isInteger(n) && n > 0 && out.indexOf(n) === -1) out.push(n); });
  return out;
}

async function setMembers(sql, boardId, people, clients) {
  if (people) {
    await sql`delete from board_people where board_id = ${boardId}`;
    for (const pid of people) await sql`insert into board_people (board_id, person_id) values (${boardId}, ${pid}) on conflict do nothing`;
  }
  if (clients) {
    await sql`delete from board_clients where board_id = ${boardId}`;
    for (const cid of clients) await sql`insert into board_clients (board_id, client_id) values (${boardId}, ${cid}) on conflict do nothing`;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const sql = store.getSql();
  if (!sql) return store.fail(res, 500, store.MISSING_DB_MESSAGE);

  try {
    await store.ensureSchema(sql);
    const user = await auth.requireUser(req, res, sql);
    if (!user) return;

    if (req.method === 'GET') {
      return res.status(200).json({ boards: await readBoards(sql, auth.canManage(user) ? null : user.id) });
    }

    if (!auth.canManage(user)) return store.fail(res, 403, 'Solo gerentes y seniors administran tableros.');
    const body = store.readBody(req) || {};

    if (req.method === 'POST') {
      const name = store.str(body.name, 80);
      if (!name) return store.fail(res, 400, 'El tablero necesita un nombre.');
      if (name.toLowerCase() === 'general') return store.fail(res, 400, '"General" es el tablero de todo; elige otro nombre.');
      const dup = await sql`select id from boards where lower(name) = lower(${name})`;
      if (dup.length) return store.fail(res, 409, 'Ya existe un tablero con ese nombre.');
      const rows = await sql`insert into boards (name) values (${name}) returning id`;
      await setMembers(sql, rows[0].id, idList(body.people) || [], idList(body.clients) || []);
      const boards = await readBoards(sql);
      return res.status(201).json({ board: boards.find(function (b) { return b.id === rows[0].id; }), boards: boards });
    }

    const id = Number(store.queryOf(req).id);
    if (!id) return store.fail(res, 400, 'Falta el id del tablero.');
    const existing = await sql`select id, name from boards where id = ${id}`;
    if (!existing.length) return store.fail(res, 404, 'El tablero no existe.');

    if (req.method === 'PATCH') {
      if (body.name !== undefined) {
        const name = store.str(body.name, 80);
        if (!name) return store.fail(res, 400, 'El tablero necesita un nombre.');
        if (name.toLowerCase() === 'general') return store.fail(res, 400, '"General" es el tablero de todo; elige otro nombre.');
        const dup = await sql`select id from boards where lower(name) = lower(${name}) and id <> ${id}`;
        if (dup.length) return store.fail(res, 409, 'Ya existe un tablero con ese nombre.');
        await sql`update boards set name = ${name} where id = ${id}`;
      }
      await setMembers(sql, id, idList(body.people), idList(body.clients));
      const boards = await readBoards(sql);
      return res.status(200).json({ board: boards.find(function (b) { return b.id === id; }), boards: boards });
    }

    if (req.method === 'DELETE') {
      await sql`delete from boards where id = ${id}`;
      return res.status(200).json({ ok: true, boards: await readBoards(sql) });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return store.fail(res, 405, 'Método no permitido.');

  } catch (err) {
    console.error('api/boards:', err);
    return store.fail(res, 500, 'Error del servidor.', { detail: String((err && err.message) || err) });
  }
};
