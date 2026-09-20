# Connect the Vercel website to the IncidentOS API

Website: https://incident-os-web.vercel.app

The Next.js website is only one part of this repo. `server/src/index.ts` is a separate
long-running Express API and background worker. Deploying `apps/web` to Vercel does not
start that server or its investigation queue.

## Configure Vercel

1. Push the current frontend changes and set the Vercel project's root directory to `apps/web`.
2. In Project Settings → Environment Variables, set for Production:

| Variable | Value |
|---|---|
| `API_INTERNAL_URL` | Your deployed Express API's HTTPS origin, without `/api` or trailing slash |
| `INCIDENT_API_URL` | Same API origin (optional; now defaults to `API_INTERNAL_URL`) |
| `INCIDENT_WEBHOOK_SECRET` | The same secret configured on the API server |

3. Remove an old `NEXT_PUBLIC_API_BASE=http://localhost:4000` setting. The updated Vercel build
   intentionally uses relative `/api/...` requests on the website domain.
4. Redeploy; rewrites are configured at build time, so changing a variable alone is insufficient.

Do not use `https://incident-os-web.vercel.app` as `API_INTERNAL_URL`: that points the proxy
back to itself. Do not use localhost: it is not the AWS server. Use a publicly reachable HTTPS
backend origin with a valid certificate.

## Configure the API

Set `NODE_ENV=production` and `WEB_ORIGIN=https://incident-os-web.vercel.app` on the Express
server. Retain its Neon URL, JWT secret, Anthropic credentials, and webhook secret server-side.
Restart/recreate the API container after changing its environment.

Browser requests go to Vercel, then a Next.js fallback rewrite forwards them to Express.
This keeps login cookies on the website domain. The existing Next.js `/api/report` and
`/api/logs` handlers take precedence over the fallback rewrite.

## Verify

- Open `https://incident-os-web.vercel.app/api/health`: it should return API JSON with
  `persistence: true`.
- Sign in and verify `/api/auth/me` returns the current account.
- Test dashboard loading, guest-page redirects, and sign-out.
- Test public reports after setting matching webhook secrets.

Incoming incident progress uses polling and the persistent backend worker. The optional demo
uses SSE; verify stream behavior against the hosting platform's proxy timeout limits separately.

The EC2 instance created during setup is `i-0ea7184d29559c2dd` in `us-east-1`, Elastic IP
`34.192.130.50`. This is infrastructure inventory, not confirmation that a backend is running.
AWS resources continue incurring charges while retained.
