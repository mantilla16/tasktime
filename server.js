/* Servidor HTTP de la app (producción y desarrollo).

   - /api/<ruta>  -> require('./api/<ruta>.js') con req.query, req.body y
                     res.status().json(), el mismo contrato que las funciones
                     de Vercel, así el mismo código sirve en ambos entornos.
   - /            -> index.html; el resto se sirve como archivo estático.

   Producción:  DATABASE_URL=postgres://... node server.js   (npm start)
   Desarrollo:  npm run dev  -> node server.js --dev: sin DATABASE_URL usa
                PGlite (Postgres embebido) en .pglite/ y recarga los handlers
                de /api en cada petición. */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const DEV = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';

if (DEV && !process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
  process.env.USE_PGLITE = '1';
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function decorate(req, res, url) {
  req.query = Object.fromEntries(url.searchParams.entries());
  res.status = function (code) { res.statusCode = code; return res; };
  res.json = function (obj) {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = function (data) {
    if (typeof data === 'object' && !Buffer.isBuffer(data)) return res.json(data);
    res.end(data);
    return res;
  };
  res.redirect = function (code, location) {
    if (typeof code !== 'number') { location = code; code = 302; }
    res.writeHead(code, { Location: location });
    res.end();
  };
}

function readBody(req) {
  return new Promise(function (resolve) {
    const chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () {
      const raw = Buffer.concat(chunks).toString('utf8');
      const type = String(req.headers['content-type'] || '');
      if (!raw) return resolve(undefined);
      if (type.indexOf('application/json') !== -1) {
        try { return resolve(JSON.parse(raw)); } catch (e) { return resolve(raw); }
      }
      resolve(raw);
    });
  });
}

function resolveApi(pathname) {
  const rel = pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
  if (!rel || rel.indexOf('..') !== -1) return null;
  const file = path.join(ROOT, 'api', rel + '.js');
  if (path.basename(file).startsWith('_') || rel.split('/').some(function (p) { return p.startsWith('_'); })) return null;
  return fs.existsSync(file) ? file : null;
}

const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const started = Date.now();
  if (DEV) {
    res.on('finish', function () {
      console.log(req.method, url.pathname + url.search, res.statusCode, (Date.now() - started) + 'ms');
    });
  }

  if (url.pathname.startsWith('/api/')) {
    const file = resolveApi(url.pathname);
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Ruta no encontrada.' }));
    }
    decorate(req, res, url);
    req.body = await readBody(req);
    try {
      // En desarrollo recargamos el handler en cada petición para ver cambios sin reiniciar.
      if (DEV) {
        Object.keys(require.cache).forEach(function (k) {
          if (k.startsWith(path.join(ROOT, 'api')) && !k.includes('_lib')) delete require.cache[k];
        });
      }
      await require(file)(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: 'Error interno', detail: String(err && err.message) });
      else res.end();
    }
    return;
  }

  let filePath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  filePath = path.normalize(path.join(ROOT, filePath));
  if (!filePath.startsWith(ROOT) || filePath.includes(path.sep + '.') || filePath.includes('node_modules')) {
    res.writeHead(403); return res.end('Prohibido');
  }
  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', function () {
  const motor = process.env.USE_PGLITE === '1' ? 'base local PGlite en .pglite/' : 'Postgres';
  console.log('Russell · horas por cliente en http://localhost:' + PORT + '  (' + motor + (DEV ? ', modo desarrollo' : '') + ')');
});

process.on('SIGTERM', function () { server.close(function () { process.exit(0); }); });
