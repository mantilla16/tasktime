/* Sesiones y contraseñas.

   - La contraseña se guarda con scrypt y una sal aleatoria; nunca en claro.
   - La sesión es un token aleatorio que viaja en una cookie HttpOnly; en la
     base solo se guarda su hash SHA-256, así una fuga de la tabla no sirve
     para suplantar a nadie.
   - Cada handler llama a requireUser(req, res, sql, rolesPermitidos): devuelve
     la persona autenticada o responde 401/403 y devuelve null. */

const crypto = require('crypto');

const COOKIE = 'russell_session';
const SESSION_DAYS = 30;

/* ---- contraseñas ---- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 64);
  return 'scrypt$' + salt.toString('base64') + '$' + key.toString('base64');
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64');
  const expected = Buffer.from(parts[2], 'base64');
  const key = crypto.scryptSync(String(password), salt, expected.length);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

function passwordProblem(password) {
  const s = String(password || '');
  if (s.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (s.length > 200) return 'La contraseña es demasiado larga.';
  return null;
}

/* ---- cookies ---- */

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  raw.split(';').forEach(function (part) {
    const eq = part.indexOf('=');
    if (eq < 1) return;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  });
  return out;
}

function isSecure(req) {
  const proto = req.headers['x-forwarded-proto'];
  if (proto) return proto === 'https';
  const host = req.headers.host || '';
  return !(host.startsWith('localhost') || host.startsWith('127.0.0.1'));
}

function appendCookie(res, value) {
  const prev = res.getHeader('Set-Cookie');
  const list = !prev ? [] : Array.isArray(prev) ? prev.slice() : [prev];
  list.push(value);
  res.setHeader('Set-Cookie', list);
}

function setSessionCookie(req, res, token) {
  appendCookie(res,
    COOKIE + '=' + encodeURIComponent(token) +
    '; Path=/; Max-Age=' + (SESSION_DAYS * 86400) +
    '; HttpOnly; SameSite=Lax' + (isSecure(req) ? '; Secure' : ''));
}

function clearSessionCookie(req, res) {
  appendCookie(res,
    COOKIE + '=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' + (isSecure(req) ? '; Secure' : ''));
}

/* ---- sesiones ---- */

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function createSession(sql, personId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
  await sql`
    insert into sessions (token_hash, person_id, expires_at)
    values (${hashToken(token)}, ${personId}, ${expires})`;
  // Limpieza oportunista de sesiones vencidas.
  await sql`delete from sessions where expires_at < now()`;
  return token;
}

async function destroySession(sql, req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return;
  await sql`delete from sessions where token_hash = ${hashToken(token)}`;
}

async function destroyAllSessions(sql, personId) {
  await sql`delete from sessions where person_id = ${personId}`;
}

function publicPerson(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active,
    hasPassword: Boolean(row.password_hash),
    mustChangePassword: Boolean(row.must_change_password),
    createdAt: row.created_at
  };
}

async function currentUser(sql, req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const rows = await sql`
    select p.id, p.name, p.email, p.role, p.active, p.password_hash, p.must_change_password, p.created_at
      from sessions s
      join people p on p.id = s.person_id
     where s.token_hash = ${hashToken(token)}
       and s.expires_at > now()
       and p.active = true
     limit 1`;
  return publicPerson(rows[0]);
}

/* Devuelve la persona autenticada o responde con el error adecuado. */
async function requireUser(req, res, sql, roles) {
  const user = await currentUser(sql, req);
  if (!user) {
    res.status(401).json({ code: 'unauthenticated', error: 'Inicia sesión para continuar.' });
    return null;
  }
  if (roles && roles.length && roles.indexOf(user.role) === -1) {
    res.status(403).json({ code: 'forbidden', error: 'Tu rol no permite esta acción.' });
    return null;
  }
  return user;
}

function canManage(user) {
  return user && (user.role === 'gerente' || user.role === 'senior');
}

module.exports = {
  COOKIE,
  hashPassword,
  verifyPassword,
  passwordProblem,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  createSession,
  destroySession,
  destroyAllSessions,
  publicPerson,
  currentUser,
  requireUser,
  canManage
};
