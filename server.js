require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.warn(`[warn] Missing env var ${key} -- see .env.example`);
  }
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Server-side client using the service_role key -- bypasses RLS.
// Never expose this key to the browser.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// ---------------------------------------------------------------------
// Public config the frontend needs to talk to Supabase Auth directly
// (this is the ANON key, which is safe to expose -- it has no special
// privileges on its own; access control happens on our API routes)
// ---------------------------------------------------------------------
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY
  });
});

// Resolve the signed-in user (if any) from an Authorization: Bearer <token> header
async function getUserFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

function isAdminEmail(email) {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

// Middleware: require a signed-in admin
async function requireAdmin(req, res, next) {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Sign in required' });
  if (!isAdminEmail(user.email)) return res.status(403).json({ error: 'Not an admin' });
  req.adminEmail = user.email;
  next();
}

// Lets the frontend ask "am I an admin?" after a magic-link sign-in
app.get('/api/whoami', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.json({ isAdmin: false });
  res.json({ isAdmin: isAdminEmail(user.email), email: user.email });
});

// ---------------------------------------------------------------------
// Profile (name, dates, tagline, portrait, story)
// ---------------------------------------------------------------------
app.get('/api/profile', async (req, res) => {
  const { data, error } = await supabase
    .from('profile')
    .select('*')
    .eq('id', 'main')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || {});
});

app.patch('/api/profile', requireAdmin, async (req, res) => {
  const { name, dates, tagline, portrait_url, story } = req.body || {};
  const patch = { id: 'main', updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = String(name).slice(0, 200);
  if (dates !== undefined) patch.dates = String(dates).slice(0, 200);
  if (tagline !== undefined) patch.tagline = String(tagline).slice(0, 200);
  if (portrait_url !== undefined) patch.portrait_url = String(portrait_url).slice(0, 2000);
  if (story !== undefined) patch.story = String(story).slice(0, 20000);

  const { data, error } = await supabase
    .from('profile')
    .upsert(patch)
    .select()
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ---------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------
app.get('/api/gallery', async (req, res) => {
  const { data, error } = await supabase
    .from('gallery')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// The image itself is uploaded straight from the browser to Supabase
// Storage (see public/app.js). This route just records the resulting
// public URL against the gallery, once the admin session is verified.
app.post('/api/gallery', requireAdmin, async (req, res) => {
  const { url, caption } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });
  const { data, error } = await supabase
    .from('gallery')
    .insert({ url: String(url).slice(0, 2000), caption: caption ? String(caption).slice(0, 200) : null })
    .select()
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/gallery/:id', requireAdmin, async (req, res) => {
  const { data: row } = await supabase
    .from('gallery')
    .select('url')
    .eq('id', req.params.id)
    .maybeSingle();

  const { error } = await supabase.from('gallery').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });

  // best-effort: also remove the underlying file from storage
  if (row?.url) {
    const marker = '/tribute-photos/';
    const idx = row.url.indexOf(marker);
    if (idx !== -1) {
      const filePath = row.url.slice(idx + marker.length);
      await supabase.storage.from('tribute-photos').remove([filePath]).catch(() => {});
    }
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// Tributes / condolences -- reading and posting is open to everyone;
// deleting is admin-only (e.g. to remove spam)
// ---------------------------------------------------------------------
app.get('/api/tributes', async (req, res) => {
  const { data, error } = await supabase
    .from('tributes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/api/tributes', async (req, res) => {
  let { name, message } = req.body || {};
  message = (message || '').toString().trim();
  if (!message) return res.status(400).json({ error: 'message is required' });
  if (message.length > 2000) return res.status(400).json({ error: 'message is too long' });
  name = (name || '').toString().trim().slice(0, 60) || 'Anonymous';

  const { data, error } = await supabase
    .from('tributes')
    .insert({ name, message })
    .select()
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/tributes/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('tributes').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Tribute site running on http://localhost:${PORT}`));
