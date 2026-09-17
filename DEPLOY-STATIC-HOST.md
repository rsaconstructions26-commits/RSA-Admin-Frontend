# Deploying this portal as a static site

## The one setting that must be right: the SPA rewrite

React Router owns `/billing`, `/labour`, `/voucher`, `/dashboard` and the rest.
Those paths are **not files**. A static host asked for `/billing` looks for a
file with that name, does not find one, and returns its own bare `Not Found`
page — which is what you get on a deep link, on a refresh, or on a bookmark.

Every path must serve `index.html` instead, so the app boots, React Router
reads the URL, and the auth guard sends an unauthenticated visitor to the
login screen.

### Render (Static Site)

Dashboard → your static site → **Redirects / Rewrites** → Add Rule:

| Source | Destination | Action |
|---|---|---|
| `/*` | `/index.html` | **Rewrite** |

Action must be **Rewrite**, not Redirect. Redirect changes the address bar and
loses the route; Rewrite serves index.html while keeping the URL.

Add this rule to **each** static site — admin, manager and mobile. It is
per-service; setting it on one does not cover the others.

### Vercel

`vercel.json` in this folder already does it (`rewrites` → `/index.html`).

### Belt and braces

`npm run build` also writes `dist/404.html` and `dist/200.html` as copies of
`index.html` (see `scripts/spa-fallback.cjs`). Several static hosts serve one
of those for unknown paths, so deep links survive even before the rewrite rule
is configured. It is a fallback, not a replacement — configure the rule.

## The other two settings

    VITE_API_BASE_URL   https://rsa-backend-2026.onrender.com/api

Baked in at build time by Vite — changing it needs a **rebuild**, not just a
restart. It is already set in `.env.production`.

And on the backend service, `CLIENT_ORIGIN` must list this site's URL
(comma-separated, no trailing slash) or every request is CORS-blocked.
