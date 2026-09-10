# FABREVOIE signup server

Run `node server.mjs` from this directory with Node 22.16 or newer. The installed Node 22.16.0 provides the built-in `node:sqlite` module and prints its experimental-feature notice. There are no server package dependencies.

The default address is `http://127.0.0.1:4173`. The process serves only files in `website/public`; subscriber data is stored separately in `website/data/signups.sqlite`. `PORT`, `HOST`, `DATA_DIR`, and `PUBLIC_ORIGIN` are optional environment variables. Relative `DATA_DIR` values resolve against the website directory, independently of the shell's current directory. Binding `HOST` to `0.0.0.0` or `::` requires an explicit `PUBLIC_ORIGIN`, for example `https://your-domain.example`.

## Signup contract

Send a same-origin request:

```js
const response = await fetch('/api/signup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, consent: true, website: '' }),
});
const result = await response.json();
```

The browser supplies `Origin`. The checkbox must be unchecked initially and the visitor must explicitly agree to launch emails; send its actual boolean value. `website` is an optional honeypot field: leave it empty, excluded from tab navigation and assistive technology. This API returns success only after saving a consented email or verifying that it already exists. It does not send emails, validate mailbox ownership, take payments or create an order.

Success is HTTP 200 with `{ "ok": true, "message": "You’re on the list. We’ll email you about the 1 October release." }`. A newly created record additionally returns `removalToken`, a 32-byte random secret encoded as a 43-character base64url string. An existing email receives the same message but no token; the API never reveals an existing record's token. Every error has `{ "ok": false, "message": "..." }` and an appropriate non-200 status: 400 validation or invalid host, 403 origin/path protection, 405 method, 413 body too large, 415 content type, 429 rate limit with `Retry-After`, or 503 unavailable storage. Keep the email in the form on errors and do not display a success state on a network failure or non-200 result.

The server trims and lowercases addresses, converts international domain names to ASCII and rejects malformed addresses. It stores the normalized email, UTC consent timestamp, the consent version `fabrevoie-launch-2026-01`, source `website`, and the SHA-256 hash of the removal token. The original token is never stored in the database or logged. SQLite uses a unique email key, WAL journaling and `synchronous=FULL`; writes complete before a success response. Failed database startup leaves the page available with signup HTTP 503 until the storage problem is fixed and the process is restarted.

## Withdrawing a signup

Retain newly returned tokens in the browser's local storage and expose a privacy control for removing that browser's signup. Preserve existing stored tokens when a duplicate signup returns no token. Submit a same-origin `DELETE /api/signup` request with JSON `{ "token": "the-token" }` and the `Content-Type: application/json` header. Successful withdrawal returns HTTP 200 with `{ "ok": true, "message": "Your signup has been withdrawn." }`. Valid but unknown tokens receive the same response. Malformed tokens return 400; unavailable storage returns 503. Only discard a local token after a successful response.

This mechanism deletes the database record and its consent information without retaining the email in the browser. Possession of the secret token authorizes removal; knowledge of an email address alone does not. It is local to the browser that initially signed up. Clearing browser storage or using another device loses that control, so the final public site still needs a real privacy contact or an email-based removal workflow. Token presence in the signup response distinguishes a newly created email from a duplicate; responses never expose the saved consent timestamp or existing removal token.

## Frontend and operations

- Keep scripts and styles in local files. The CSP allows local assets and data-URL images, blocks inline scripts/styles and third-party requests, and prevents framing. There are no analytics or tracking cookies.
- Local fonts and images are supported. HTML/CSS/JavaScript use cache revalidation; other assets cache for one hour and expose ETags. GET and HEAD are supported.
- The in-memory rate limit permits 10 attempts per socket IP per 15 minutes. It clears on restart. Proxy forwarding headers are intentionally untrusted. If a public reverse proxy is added, visitors share the proxy's address at this server: configure rate limiting at the trusted proxy and adapt this mechanism before high-traffic use.
- Public hosting is not configured. An actual public launch requires a persistent disk, HTTPS and a domain; set `PUBLIC_ORIGIN` to the exact public origin. Keep the backend private behind a trusted proxy. No hosting credentials or mail-provider integration have been added.
- The SQLite database contains personal data. Keep the data directory outside `public`, restrict its Windows ACLs to the account running the service, and back it up. Copy backups while the server is stopped, or use SQLite's supported backup tooling; a running WAL database cannot be safely backed up by copying only its main `.sqlite` file.
- Nothing in the public site exposes the subscriber list. Authorized operators can open the local database with SQLite-compatible tooling to export or delete records. Provide a working contact or unsubscribe mechanism when launch emails are sent; no outgoing email workflow exists yet.

Run the independent test suite with `node --test tests/server.test.mjs`. Tests use separate temporary directories and verify durable storage, consent, duplicates, validation, rate limits, static access, traversal protection and honest error states. They do not write to the real subscriber database.
