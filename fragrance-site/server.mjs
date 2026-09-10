import http from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { domainToASCII } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SITE_DIR = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 4096;
const CONSENT_VERSION = 'fabrevoie-launch-2026-01';
const SUCCESS_MESSAGE = 'You’re on the list. We’ll email you about the 1 October release.';
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "media-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const MIME_TYPES = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
}));

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isInside(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function parsePublicOrigin(value) {
  if (!value) return null;
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
    || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('PUBLIC_ORIGIN must be a complete HTTP(S) origin, such as https://example.com.');
  }
  return parsed;
}

function securityHeaders(response) {
  response.setHeader('Content-Security-Policy', CSP);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function json(response, status, payload, headers = {}) {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(body);
}

function normalizeEmail(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (value.length > 254 || /[\s\u0000-\u001f\u007f]/u.test(value)) return null;
  const parts = value.split('@');
  if (parts.length !== 2) return null;
  const [local, rawDomain] = parts;
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.')
    || local.includes('..') || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return null;
  const domain = domainToASCII(rawDomain.toLowerCase());
  const labels = domain.split('.');
  if (labels.length < 2 || labels.at(-1).length < 2
    || !labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  const email = `${local.toLowerCase()}@${domain}`;
  return email.length <= 254 ? email : null;
}

async function readJson(request) {
  const type = (request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    request.resume();
    throw new RequestError(415, 'Please submit the form as JSON.');
  }
  if (Number(request.headers['content-length']) > MAX_BODY_BYTES) {
    request.resume();
    throw new RequestError(413, 'The submitted form is too large.');
  }
  let size = 0;
  const chunks = [];
  // The data listener permits an honest 413 response without destroying the socket.
  const body = await new Promise((resolve, reject) => {
    let rejected = false;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        if (!rejected) reject(new RequestError(413, 'The submitted form is too large.'));
        rejected = true;
        chunks.length = 0;
      } else if (!rejected) chunks.push(chunk);
    });
    request.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    request.on('error', () => reject(new RequestError(400, 'The submitted form could not be read.')));
    request.on('aborted', () => reject(new RequestError(400, 'The submitted form was interrupted.')));
  });
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new RequestError(400, 'Please check the form and try again.');
  }
}

function createRateLimiter(limit, windowMs, now) {
  const clients = new Map();
  let lastSweep = now();
  return address => {
    const time = now();
    if (time - lastSweep >= windowMs) {
      for (const [key, item] of clients) if (item.reset <= time) clients.delete(key);
      lastSweep = time;
    }
    let item = clients.get(address);
    if (!item || item.reset <= time) {
      if (clients.size >= 10000) clients.delete(clients.keys().next().value);
      item = { count: 0, reset: time + windowMs };
      clients.set(address, item);
    }
    item.count += 1;
    return item.count > limit ? Math.max(1, Math.ceil((item.reset - time) / 1000)) : 0;
  };
}

async function openStorage(dataDir, publicDir) {
  if (isInside(publicDir, dataDir)) throw new Error('Signup data must be stored outside the public directory.');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const actualDataDir = await realpath(dataDir);
  let actualPublicDir = publicDir;
  try { actualPublicDir = await realpath(publicDir); } catch { /* The static directory can be created later. */ }
  if (isInside(actualPublicDir, actualDataDir)) throw new Error('Signup data must be stored outside the public directory.');
  const database = new DatabaseSync(path.join(actualDataDir, 'signups.sqlite'));
  try {
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS signups (
        email TEXT PRIMARY KEY NOT NULL,
        consented_at TEXT NOT NULL,
        consent_version TEXT NOT NULL,
        source TEXT NOT NULL,
        removal_token_hash TEXT
      );
    `);
    const columns = database.prepare('PRAGMA table_info(signups)').all();
    if (!columns.some(column => column.name === 'removal_token_hash')) {
      database.exec('ALTER TABLE signups ADD COLUMN removal_token_hash TEXT');
    }
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS signup_removal_token ON signups(removal_token_hash)');
    const insert = database.prepare(`
      INSERT INTO signups (email, consented_at, consent_version, source, removal_token_hash)
      VALUES (?, ?, ?, 'website', ?)
      ON CONFLICT(email) DO NOTHING
    `);
    const remove = database.prepare('DELETE FROM signups WHERE removal_token_hash = ?');
    return {
      save(email, date) {
        const removalToken = randomBytes(32).toString('base64url');
        const hash = createHash('sha256').update(removalToken).digest('hex');
        const result = insert.run(email, date.toISOString(), CONSENT_VERSION, hash);
        return result.changes ? removalToken : undefined;
      },
      remove(token) { remove.run(createHash('sha256').update(token).digest('hex')); },
      close() { database.close(); },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

/** Creates an unbound server. Tests may supply isolated public/data directories. */
export async function createSiteServer(options = {}) {
  const publicDir = path.resolve(options.publicDir || path.join(SITE_DIR, 'public'));
  const dataDir = path.resolve(SITE_DIR, options.dataDir || process.env.DATA_DIR || 'data');
  const publicOrigin = parsePublicOrigin(options.publicOrigin ?? process.env.PUBLIC_ORIGIN);
  const host = options.host || process.env.HOST || '127.0.0.1';
  const now = options.now || Date.now;
  const logger = options.logger || console;
  const rateLimit = createRateLimiter(options.rateLimitMax ?? 10, options.rateLimitWindowMs ?? 15 * 60 * 1000, now);
  const allowedLocalNames = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (!['0.0.0.0', '::'].includes(host)) allowedLocalNames.add(host.toLowerCase());
  let storage;
  try {
    storage = await openStorage(dataDir, publicDir);
  } catch {
    logger.error('Signup storage is unavailable. The page remains accessible; submissions will return 503. Check DATA_DIR permissions and restart.');
  }

  async function serveStatic(request, response, pathname) {
    const destination = path.resolve(publicDir, `.${pathname}`);
    if (!isInside(publicDir, destination)) throw new RequestError(403, 'This path is not available.');
    try {
      let file = destination;
      let details = await stat(file);
      if (details.isDirectory()) {
        file = path.join(file, 'index.html');
        details = await stat(file);
      }
      const [actualRoot, actualFile] = await Promise.all([realpath(publicDir), realpath(file)]);
      if (!details.isFile() || !isInside(actualRoot, actualFile)) throw new RequestError(404, 'Page not found.');
      const tag = `W/"${details.size.toString(16)}-${Math.trunc(details.mtimeMs).toString(16)}"`;
      response.setHeader('Content-Type', MIME_TYPES.get(path.extname(file).toLowerCase()) || 'application/octet-stream');
      response.setHeader('Last-Modified', details.mtime.toUTCString());
      response.setHeader('ETag', tag);
      response.setHeader('Cache-Control', /\.(?:html|css|m?js)$/i.test(file) ? 'no-cache' : 'public, max-age=3600');
      if (request.headers['if-none-match'] === tag) {
        response.writeHead(304);
        response.end();
        return;
      }
      response.setHeader('Content-Length', details.size);
      if (request.method === 'HEAD') {
        response.writeHead(200);
        response.end();
        return;
      }
      const stream = createReadStream(actualFile);
      stream.on('error', () => {
        if (response.headersSent) response.destroy();
        else json(response, 500, { ok: false, message: 'This file is temporarily unavailable.' });
      });
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } catch (error) {
      if (error instanceof RequestError) throw error;
      if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) throw new RequestError(404, 'Page not found.');
      throw error;
    }
  }

  const server = http.createServer(async (request, response) => {
    securityHeaders(response);
    try {
      let requestOrigin;
      try {
        requestOrigin = new URL(`http://${request.headers.host}`);
        const address = server.address();
        const expectedPort = typeof address === 'object' && address ? String(address.port) : '80';
        const localHostAllowed = allowedLocalNames.has(requestOrigin.hostname.toLowerCase())
          && (requestOrigin.port || '80') === expectedPort;
        const publicHostAllowed = publicOrigin && requestOrigin.host === publicOrigin.host;
        if (requestOrigin.username || requestOrigin.password || requestOrigin.pathname !== '/'
          || requestOrigin.search || requestOrigin.hash || (!localHostAllowed && !publicHostAllowed)) throw new Error();
      } catch {
        throw new RequestError(400, 'Invalid request host.');
      }
      const target = request.url || '/';
      if (!target.startsWith('/') || target.startsWith('//')) throw new RequestError(400, 'Invalid request path.');
      let pathname;
      try { pathname = decodeURIComponent(target.split('?')[0]); }
      catch { throw new RequestError(400, 'Invalid request path.'); }
      if (/[\\:\u0000-\u001f\u007f]/u.test(pathname)
        || pathname.split('/').some(segment => segment.startsWith('.'))) {
        throw new RequestError(403, 'This path is not available.');
      }
      if (pathname === '/api/signup') {
        if (!['POST', 'DELETE'].includes(request.method)) {
          json(response, 405, { ok: false, message: 'Please use the signup form.' }, { Allow: 'POST, DELETE' });
          return;
        }
        const expectedOrigin = publicOrigin?.origin || requestOrigin.origin;
        if (request.headers.origin !== expectedOrigin || request.headers['sec-fetch-site'] === 'cross-site') {
          request.resume();
          throw new RequestError(403, 'Please submit the form from this website.');
        }
        const retryAfter = rateLimit(request.socket.remoteAddress || 'unknown');
        if (retryAfter) {
          request.resume();
          json(response, 429, { ok: false, message: 'Too many attempts. Please try again in a few minutes.' }, { 'Retry-After': retryAfter });
          return;
        }
        const body = await readJson(request);
        if (request.method === 'DELETE') {
          if (typeof body.token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(body.token)) {
            throw new RequestError(400, 'A valid signup removal token is required.');
          }
          try {
            if (!storage) throw new Error('Storage unavailable');
            storage.remove(body.token);
          } catch {
            logger.error('A signup withdrawal could not be saved. Check storage availability.');
            throw new RequestError(503, 'We couldn’t process your withdrawal. Please try again later.');
          }
          json(response, 200, { ok: true, message: 'Your signup has been withdrawn.' });
          return;
        }
        if (body.website !== undefined && body.website !== '') throw new RequestError(400, 'Please check the form and try again.');
        if (body.consent !== true) throw new RequestError(400, 'Please agree to receive the launch emails before joining.');
        const email = normalizeEmail(body.email);
        if (!email) throw new RequestError(400, 'Please enter a valid email address.');
        let removalToken;
        try {
          if (!storage) throw new Error('Storage unavailable');
          removalToken = storage.save(email, new Date(now()));
        } catch {
          logger.error('A signup could not be saved. No confirmation was returned. Check storage availability.');
          throw new RequestError(503, 'We couldn’t save your signup. Please try again later.');
        }
        json(response, 200, { ok: true, message: SUCCESS_MESSAGE, ...(removalToken ? { removalToken } : {}) });
        return;
      }
      if (pathname.startsWith('/api/')) throw new RequestError(404, 'Page not found.');
      if (!['GET', 'HEAD'].includes(request.method)) {
        request.resume();
        json(response, 405, { ok: false, message: 'This method is not available.' }, { Allow: 'GET, HEAD' });
        return;
      }
      await serveStatic(request, response, pathname);
    } catch (error) {
      const expected = error instanceof RequestError;
      if (!expected) logger.error('A request could not be completed.');
      json(response, expected ? error.status : 500, {
        ok: false,
        message: expected ? error.message : 'The website is temporarily unavailable. Please try again.',
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.on('close', () => storage?.close());
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  if (['0.0.0.0', '::'].includes(host) && !process.env.PUBLIC_ORIGIN) {
    throw new Error('Set PUBLIC_ORIGIN before binding to a public interface.');
  }
  const server = await createSiteServer({ host });
  server.on('error', error => {
    console.error(`Website could not start: ${error.code || 'server error'}.`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => console.log(`FABREVOIE website: http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => { server.closeAllConnections(); }, 5000).unref();
    });
  }
}
