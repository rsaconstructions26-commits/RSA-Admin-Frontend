# Admin portal - deploy to Vercel

Static Vite SPA. The API lives on Render (see the backend package).

## Deploy

1. Import this folder as a new Vercel project (or `vercel` from the CLI).
2. Framework preset: **Vite**. Build `npm run build`, output `dist`.
3. Environment variable:

       VITE_API_BASE_URL = https://<your-render-service>.onrender.com/api

   Set it for Production, Preview and Development. Vite bakes it in at build
   time, so changing it later needs a redeploy, not just a restart.
4. Deploy.

`vercel.json` is included and already rewrites every path to `index.html` -
without it, refreshing on `/billing` or `/labour` returns a 404 because the
router is client-side.

## After the API is up

Set `CLIENT_ORIGIN` on the Render service to this Vercel URL, or the browser
blocks every request with a CORS error that looks like "login failed".
