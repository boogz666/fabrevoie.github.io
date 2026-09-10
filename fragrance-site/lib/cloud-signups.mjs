import { createHash, createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

export const CONSENT_VERSION = 'fabrevoie-launch-2026-01';
export const MAX_BODY_BYTES = 4096;
export const SUCCESS_MESSAGE = 'You’re on the list. We’ll email you about the 1 October release.';

export class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function normalizeEmail(input) {
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

function origin(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && url.pathname === '/' && !url.search && !url.hash && value === url.origin ? url : null;
  } catch { return null; }
}

export function assertSameOrigin(request, env = process.env) {
  const host = request.headers.host;
  if (typeof host !== 'string' || !host || /[\s/@\\?#]/u.test(host)) {
    throw new RequestError(400, 'Invalid request host.');
  }
  const current = origin(`https://${host}`);
  if (!current || current.host !== host.toLowerCase()) throw new RequestError(400, 'Invalid request host.');
  const allowed = new Set([current.origin]);
  for (const value of [env.PUBLIC_ORIGIN, env.VERCEL_URL && `https://${env.VERCEL_URL}`,
    env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`]) {
    if (!value) continue;
    const configured = origin(value);
    if (!configured) throw new RequestError(503, 'The release list is temporarily unavailable.');
    allowed.add(configured.origin);
  }
  const supplied = origin(request.headers.origin);
  // Host comes from Vercel routing. Forwarded-Host is deliberately not trusted.
  if (!supplied || !allowed.has(supplied.origin) || supplied.host !== current.host
    || request.headers['sec-fetch-site'] === 'cross-site') {
    throw new RequestError(403, 'Please submit the form from this website.');
  }
}

export function clientKey(request, secret, env = process.env) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Rate limit configuration unavailable');
  // Vercel overwrites this header at its edge. Other environments use the socket.
  const forwarded = env.VERCEL === '1' && request.headers['x-forwarded-for'];
  const address = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : request.socket?.remoteAddress;
  const checked = typeof address === 'string' && isIP(address) ? address : 'unknown';
  return createHmac('sha256', secret).update(`fabrevoie-signup:${checked}`).digest('hex');
}

export async function readJson(request) {
  const type = request.headers['content-type'];
  if (typeof type !== 'string' || type.split(';')[0].trim().toLowerCase() !== 'application/json') {
    request.resume?.();
    throw new RequestError(415, 'Please submit the form as JSON.');
  }
  const length = request.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    request.resume?.();
    throw new RequestError(413, 'The submitted form is too large.');
  }
  let data;
  try { data = request.body; }
  catch { throw new RequestError(400, 'Please check the form and try again.'); }
  if (data === undefined) {
    // Supports the raw Node stream as well as Vercel's lazy parsed-body helper.
    data = await new Promise((resolve, reject) => {
      let size = 0;
      let finished = false;
      const chunks = [];
      const timer = setTimeout(() => finish(new RequestError(408, 'The submitted form took too long.')), 5000);
      timer.unref?.();
      function finish(error, value) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        chunks.length = 0;
        if (error) { request.resume?.(); reject(error); }
        else resolve(value);
      }
      request.on('data', chunk => {
        if (finished) return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > MAX_BODY_BYTES) finish(new RequestError(413, 'The submitted form is too large.'));
        else chunks.push(bytes);
      });
      request.on('end', () => finish(null, Buffer.concat(chunks)));
      request.on('error', () => finish(new RequestError(400, 'The submitted form could not be read.')));
      request.on('aborted', () => finish(new RequestError(400, 'The submitted form was interrupted.')));
    });
  }
  try {
    if (Buffer.isBuffer(data) || typeof data === 'string') {
      if (Buffer.byteLength(data) > MAX_BODY_BYTES) throw new RequestError(413, 'The submitted form is too large.');
      data = JSON.parse(Buffer.isBuffer(data) ? new TextDecoder('utf-8', { fatal: true }).decode(data) : data);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    if (Buffer.byteLength(JSON.stringify(data)) > MAX_BODY_BYTES) throw new RequestError(413, 'The submitted form is too large.');
    return data;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, 'Please check the form and try again.');
  }
}

export function validateSubmission(body, method) {
  if (method === 'DELETE') {
    if (typeof body.token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(body.token)) {
      throw new RequestError(400, 'A valid signup removal token is required.');
    }
    return body.token;
  }
  if (body.website !== undefined && body.website !== '') throw new RequestError(400, 'Please check the form and try again.');
  if (body.consent !== true) throw new RequestError(400, 'Please agree to receive the launch emails before joining.');
  const email = normalizeEmail(body.email);
  if (!email) throw new RequestError(400, 'Please enter a valid email address.');
  return email;
}

/** Durable storage. The caller supplies one abort signal for the entire request. */
export async function createNeonStorage(databaseUrl) {
  if (!databaseUrl) throw new Error('Signup storage unavailable');
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(databaseUrl);
  let initialized;
  async function initialize() {
    if (!initialized) {
      // The transaction lock serializes schema creation across cold instances.
      initialized = sql.transaction([
        sql`SELECT pg_advisory_xact_lock(683177499)`,
        sql`CREATE TABLE IF NOT EXISTS public.fabrevoie_signups (
          email TEXT PRIMARY KEY NOT NULL,
          consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          consent_version TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'website',
          removal_token_hash TEXT UNIQUE NOT NULL
        )`,
        sql`CREATE TABLE IF NOT EXISTS public.fabrevoie_signup_rate_limits (
          client_hash TEXT PRIMARY KEY NOT NULL,
          attempts INTEGER NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL
        )`,
        sql`CREATE INDEX IF NOT EXISTS fabrevoie_signup_rate_expiry
          ON public.fabrevoie_signup_rate_limits (expires_at)`
      ], { fetchOptions: { signal: AbortSignal.timeout(5000) } }).catch(error => {
        initialized = undefined;
        throw error;
      });
    }
    await initialized;
  }
  return {
    async consume(key, signal) {
      await initialize();
      const [, rows] = await sql.transaction([
        sql`DELETE FROM public.fabrevoie_signup_rate_limits WHERE expires_at <= NOW() - INTERVAL '1 hour'`,
        sql`INSERT INTO public.fabrevoie_signup_rate_limits AS limits (client_hash, attempts, expires_at)
          VALUES (${key}, 1, NOW() + INTERVAL '15 minutes')
          ON CONFLICT (client_hash) DO UPDATE SET
            attempts = CASE WHEN limits.expires_at <= NOW() THEN 1 ELSE LEAST(limits.attempts + 1, 11) END,
            expires_at = CASE WHEN limits.expires_at <= NOW() THEN NOW() + INTERVAL '15 minutes' ELSE limits.expires_at END
          RETURNING attempts, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - NOW()))))::INTEGER AS retry_after`
      ], { fetchOptions: { signal } });
      return rows[0].attempts > 10 ? rows[0].retry_after : 0;
    },
    async save(email, signal) {
      await initialize();
      const token = randomBytes(32).toString('base64url');
      const hash = createHash('sha256').update(token).digest('hex');
      const rows = await sql.query(`INSERT INTO public.fabrevoie_signups
        (email, consent_version, removal_token_hash) VALUES ($1, $2, $3)
        ON CONFLICT (email) DO NOTHING RETURNING email`, [email, CONSENT_VERSION, hash], { fetchOptions: { signal } });
      return rows.length ? token : undefined;
    },
    async remove(token, signal) {
      await initialize();
      const hash = createHash('sha256').update(token).digest('hex');
      await sql.query('DELETE FROM public.fabrevoie_signups WHERE removal_token_hash = $1', [hash], { fetchOptions: { signal } });
    },
  };
}
