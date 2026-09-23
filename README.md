# Tribute Site

A simple, story-first tribute page. One Express app serves both the
frontend and the API, backed by Supabase (Postgres + Auth + Storage).

- Visitors can read the story, browse photos, and post a tribute/condolence message.
- Admins (allow-listed emails) sign in with a Supabase magic link and can edit the
  name/dates/tagline/portrait, edit the story, and add or remove photos.
- Photos are uploaded directly from the browser to Supabase Storage.

## 1. Create the Supabase project

1. Go to https://supabase.com, create a new project.
2. In **Project Settings -> API**, copy:
   - `Project URL` -> `SUPABASE_URL`
   - `anon public` key -> `SUPABASE_ANON_KEY`
   - `service_role` key -> `SUPABASE_SERVICE_ROLE_KEY` (keep this secret — server only)
3. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and run it.
   This creates the `profile`, `gallery`, and `tributes` tables, enables Row Level
   Security (the server bypasses it with the service role key, so the browser can't
   read/write the database directly), and creates a public `tribute-photos` storage
   bucket with policies allowing public reads and authenticated uploads/deletes.
4. In **Authentication -> URL Configuration**, add your local and deployed URLs
   (e.g. `http://localhost:3000` and your Render URL) to **Redirect URLs**, so the
   magic-link email can send people back to the right place.
5. In **Authentication -> Providers -> Email**, magic link / OTP sign-in is enabled
   by default — nothing else to configure there.

## 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in `.env`:

```
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_EMAILS=you@example.com,otherfamilymember@example.com
PORT=3000
```

`ADMIN_EMAILS` is the allow-list: only these addresses become admins after signing
in via magic link. Anyone else who signs in is treated as a regular visitor.

## 3. Run locally

```bash
npm install
npm run dev
```

Visit http://localhost:3000. Click **Admin sign in**, enter one of the
`ADMIN_EMAILS` addresses, and follow the link Supabase emails you — it will
redirect back to the site already signed in, and the edit controls will appear.

## 4. Deploy on Vercel

This project can run as a single Express server (Render, step 4 below) or as
static files + a serverless function (Vercel). Both are included:

- `server.js` — plain Express server (`app.listen`), used for local `npm run dev`
  and for Render.
- `api/index.js` — the same routes, exported as an Express app with no
  `app.listen`, for Vercel to run as a serverless function.
- `vercel.json` — routes any `/api/*` request to `api/index.js`; everything
  else is served directly from `public/` as static files.

Steps:

1. Push this project to a GitHub repo.
2. In Vercel, **Add New -> Project**, import that repo. Framework preset:
   "Other" (no build step needed).
3. In **Settings -> Environment Variables**, add `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `ADMIN_EMAILS`
   (same values as your `.env`).
4. Deploy. Vercel will serve `public/index.html` (and `style.css`, `app.js`)
   as static files, and route `/api/*` to `api/index.js`.
5. Add the deployed URL (e.g. `https://your-project.vercel.app`) to Supabase's
   **Authentication -> URL Configuration -> Redirect URLs**, so magic links work.

To test the Vercel setup locally instead of `npm run dev`, install the Vercel
CLI (`npm i -g vercel`) and run `vercel dev` from the project root — it reads
`vercel.json` and `api/` the same way production does.

> If you ever change the API logic, update it in **both** `server.js` and
> `api/index.js` — they're kept as two small, independent copies rather than
> sharing a module, to keep each deploy target simple and dependency-free.

## 5. Deploy on Render (alternative)

1. Push this project to a GitHub repo.
2. In Render, create a **Web Service** from that repo.
   - Build command: `npm install`
   - Start command: `npm start`
3. Add the same environment variables from `.env` in Render's dashboard
   (Environment tab) — `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS`.
4. Once deployed, add the Render URL to Supabase's **Redirect URLs** (step 1.4 above)
   so magic links work in production too.

## Project structure

```
server.js            Express app for Render/local dev (app.listen + static)
api/index.js          Same routes, exported for Vercel serverless
vercel.json           Routes /api/* to api/index.js on Vercel
public/
  index.html          Page markup
  style.css            Theme (navy/cream, pinned to light mode)
  app.js                Auth, uploads, and API calls
supabase/
  schema.sql            Tables, RLS, and storage bucket/policies
.env.example
```

## Notes

- The database is never touched directly from the browser — all reads/writes go
  through the Express API, which uses the Supabase `service_role` key server-side.
  This is why RLS on the tables has no public policies: the tables are effectively
  locked to the server.
- Storage uploads *do* go straight from the browser to Supabase, using the
  signed-in admin's session — this is fine because the storage policies require
  an authenticated session, and only allow-listed emails ever get treated as admins
  by the API.
- Tribute posting is intentionally open to anyone with the link, with no sign-in,
  since that's the whole point of a condolence wall. Admins can remove any
  message if needed.
