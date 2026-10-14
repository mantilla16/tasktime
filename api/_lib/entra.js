/* Validación de id_token de Microsoft Entra ID (mismo esquema que analitica-puc).

   El navegador obtiene un id_token con MSAL y lo manda a /api/auth?action=
   microsoft. Aquí se comprueba la firma contra las claves públicas del
   inquilino y se validan emisor, audiencia, vigencia e inquilino (tid).
   Nunca se cree nada del token sin esto: un id_token sin verificar es texto
   que manda el navegador.

   Configuración por entorno (se aceptan los nombres de analitica-puc para
   poder copiar el mismo .env):
     MS_TENANT_ID  | AUDITORIA_MS_TENANT    id de directorio (inquilino)
     MS_CLIENT_ID  | AUDITORIA_MS_CLIENTE   id de aplicación (cliente)
     RB_DOMINIO    | AUDITORIA_DOMINIO      dominio institucional (rbcol.co)

   Sin dependencias: Node trae fetch y crypto.verify con claves JWK. */

const crypto = require('crypto');

function cfg(a, b) { return String(process.env[a] || process.env[b] || '').trim(); }
function tenant() { return cfg('MS_TENANT_ID', 'AUDITORIA_MS_TENANT'); }
function clientId() { return cfg('MS_CLIENT_ID', 'AUDITORIA_MS_CLIENTE'); }
function dominio() { return (cfg('RB_DOMINIO', 'AUDITORIA_DOMINIO') || 'rbcol.co').toLowerCase(); }
function configured() { return Boolean(tenant() && clientId()); }

/* ---- claves públicas del inquilino (rotan cada pocas semanas) ---- */

const JWKS_TTL_MS = 12 * 3600 * 1000;
let jwksCache = { tenant: '', keys: [], at: 0 };

async function jwks(force) {
  const t = tenant();
  const fresh = jwksCache.tenant === t && (Date.now() - jwksCache.at) < JWKS_TTL_MS;
  if (fresh && !force) return jwksCache.keys;
  const r = await fetch('https://login.microsoftonline.com/' + t + '/discovery/v2.0/keys');
  if (!r.ok) throw new Error('No se pudieron obtener las claves de Microsoft (HTTP ' + r.status + ').');
  const payload = await r.json();
  jwksCache = { tenant: t, keys: payload.keys || [], at: Date.now() };
  return jwksCache.keys;
}

function b64url(s) { return Buffer.from(String(s), 'base64url'); }
function parseJson(buf) { try { return JSON.parse(buf.toString('utf8')); } catch (e) { return null; } }

/* Devuelve { correo, nombre, oid } si el token es válido para nosotros; si no, lanza. */
async function verifyIdToken(idToken) {
  if (!configured()) throw new Error('El login con Microsoft no está configurado.');
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Token mal formado.');
  const header = parseJson(b64url(parts[0]));
  const claims = parseJson(b64url(parts[1]));
  if (!header || !claims) throw new Error('Token ilegible.');
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Algoritmo no admitido.');

  let key = (await jwks()).find(function (k) { return k.kid === header.kid; });
  if (!key) key = (await jwks(true)).find(function (k) { return k.kid === header.kid; });
  if (!key) throw new Error('Clave de firma desconocida.');

  const publicKey = crypto.createPublicKey({ key: key, format: 'jwk' });
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]),
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, b64url(parts[2]));
  if (!ok) throw new Error('Firma inválida.');

  const now = Math.floor(Date.now() / 1000);
  const leeway = 120;
  if (typeof claims.exp !== 'number' || claims.exp + leeway < now) throw new Error('Token vencido.');
  if (typeof claims.nbf === 'number' && claims.nbf - leeway > now) throw new Error('Token aún no válido.');
  if (claims.aud !== clientId()) throw new Error('El token es para otra aplicación.');
  const t = tenant();
  const emisores = ['https://login.microsoftonline.com/' + t + '/v2.0', 'https://sts.windows.net/' + t + '/'];
  if (emisores.indexOf(claims.iss) === -1) throw new Error('Emisor no reconocido.');
  if (claims.tid !== t) throw new Error('El token pertenece a otro inquilino.');

  const correo = String(claims.preferred_username || claims.email || '').trim().toLowerCase();
  if (!correo) throw new Error('El token no trae correo.');
  return { correo: correo, nombre: String(claims.name || correo), oid: claims.oid || null };
}

/* El problema con el correo en palabras, o null si sirve para entrar. */
function problemaConCorreo(correo) {
  if (!correo) return 'Escribe tu correo.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return 'Ese no parece un correo válido.';
  if (!correo.endsWith('@' + dominio())) return 'Solo se puede entrar con una cuenta @' + dominio() + '.';
  return null;
}

module.exports = { tenant, clientId, dominio, configured, verifyIdToken, problemaConCorreo };
