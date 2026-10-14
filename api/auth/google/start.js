/* Arranca el flujo de OAuth: manda a la pantalla de consentimiento de Google.
   GET /api/auth/google/start   (solo el gerente) */

const g = require('../../_lib/google.js');
const store = require('../../_lib/store.js');
const auth = require('../../_lib/auth.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const sql = store.getSql();
  if (!sql) return res.status(500).json({ error: store.MISSING_DB_MESSAGE });

  try {
    await store.ensureSchema(sql);
    const user = await auth.requireUser(req, res, sql, ['gerente']);
    if (!user) return;
  } catch (err) {
    console.error('auth/google/start:', err);
    return res.status(500).json({ error: 'Error del servidor.' });
  }

  if (!g.isConfigured()) {
    return res.status(500).json({
      error: 'Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en las variables de entorno de Vercel.'
    });
  }

  const state = g.newState();
  const secure = (req.headers['x-forwarded-proto'] || 'https') === 'https';
  res.setHeader('Set-Cookie',
    'russell_oauth=' + encodeURIComponent(state) +
    '; Path=/; Max-Age=600; HttpOnly; SameSite=Lax' + (secure ? '; Secure' : ''));

  res.writeHead(302, { Location: g.authorizeUrl(req, state) });
  res.end();
};
