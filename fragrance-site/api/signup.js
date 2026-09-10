import {
  RequestError, SUCCESS_MESSAGE, assertSameOrigin, clientKey,
  createNeonStorage, readJson, validateSubmission,
} from '../lib/cloud-signups.mjs';

function json(response, status, payload, headers = {}) {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...headers,
  });
  response.end(body);
}

/** Options allow behavior tests without a live database; production uses Neon. */
export function createSignupHandler({ env = process.env, logger = console, storage: injected } = {}) {
  let storagePromise;
  async function storage() {
    if (injected) return injected;
    if (!env.DATABASE_URL) throw new Error('Signup storage unavailable');
    if (!storagePromise) storagePromise = createNeonStorage(env.DATABASE_URL).catch(error => {
      storagePromise = undefined;
      throw error;
    });
    return storagePromise;
  }
  return async function signup(request, response) {
    try {
      if (!['POST', 'DELETE'].includes(request.method)) {
        request.resume?.();
        json(response, 405, { ok: false, message: 'Please use the signup form.' }, { Allow: 'POST, DELETE' });
        return;
      }
      assertSameOrigin(request, env);
      const value = validateSubmission(await readJson(request), request.method);
      const signal = AbortSignal.timeout(10000);
      const key = clientKey(request, env.RATE_LIMIT_SECRET, env);
      const db = await storage();
      const retryAfter = await db.consume(key, signal);
      if (retryAfter) {
        json(response, 429, { ok: false, message: 'Too many attempts. Please try again in a few minutes.' }, { 'Retry-After': String(retryAfter) });
        return;
      }
      if (request.method === 'DELETE') {
        await db.remove(value, signal);
        json(response, 200, { ok: true, message: 'Your signup has been withdrawn.' });
        return;
      }
      const removalToken = await db.save(value, signal);
      json(response, 200, { ok: true, message: SUCCESS_MESSAGE, ...(removalToken ? { removalToken } : {}) });
    } catch (error) {
      const expected = error instanceof RequestError;
      if (!expected) logger.error('Signup storage request failed. No confirmation was returned.');
      json(response, expected ? error.status : 503, {
        ok: false,
        message: expected ? error.message : request.method === 'DELETE'
          ? 'We couldn’t process your withdrawal. Please try again later.'
          : 'We couldn’t save your signup. Please try again later.',
      });
    }
  };
}

export default createSignupHandler();
