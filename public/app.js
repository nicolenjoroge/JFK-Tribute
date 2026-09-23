let supabaseClient = null;
let session = null;
let isAdmin = false;

const $ = (id) => document.getElementById(id);

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function togglePanel(id) {
  $(id).classList.toggle('open');
}
window.togglePanel = togglePanel;

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  return new Date(iso).toLocaleDateString();
}

function authHeaders() {
  const token = session?.access_token;
  return token ? { Authorization: 'Bearer ' + token } : {};
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* ---------------- auth ---------------- */

async function sendMagicLink() {
  const email = $('inAuthEmail').value.trim();
  const status = $('authFormStatus');
  if (!email) { status.textContent = 'Enter an email address.'; return; }
  if (!supabaseClient) { status.textContent = 'Not connected yet — try again in a moment.'; return; }
  status.textContent = 'Sending...';
  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin }
  });
  status.textContent = error ? error.message : 'Check your email for a sign-in link.';
}
window.sendMagicLink = sendMagicLink;

async function signOut() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  session = null;
  isAdmin = false;
  applyAdminVisibility();
  updateAuthBar();
  showToast('Signed out');
}
window.signOut = signOut;

function updateAuthBar() {
  $('authStatus').textContent = session
    ? (isAdmin ? `Signed in as ${session.user.email} (admin)` : `Signed in as ${session.user.email}`)
    : '';
  $('signInBtn').style.display = session ? 'none' : 'inline-block';
  $('signOutBtn').style.display = session ? 'inline-block' : 'none';
  if (session) $('signInPanel').classList.remove('open');
}

function applyAdminVisibility() {
  $('adminBar').style.display = isAdmin ? 'block' : 'none';
  $('heroEditBtn').style.display = isAdmin ? 'block' : 'none';
  $('storyEditBtn').style.display = isAdmin ? 'block' : 'none';
  $('galleryAddWrap').style.display = isAdmin ? 'block' : 'none';
  renderGallery(lastGallery); // re-render to show/hide remove buttons
  renderTributes(lastTributes);
}

async function refreshWhoAmI() {
  try {
    const info = await api('/api/whoami');
    isAdmin = !!info.isAdmin;
  } catch (e) {
    isAdmin = false;
  }
  applyAdminVisibility();
  updateAuthBar();
}

/* ---------------- profile ---------------- */

function renderProfile(data) {
  data = data || {};
  const portraitImg = $('portraitImg');
  const portraitPlaceholder = $('portraitPlaceholder');
  if (data.portrait_url) {
    portraitImg.src = data.portrait_url;
    portraitImg.style.display = 'block';
    portraitPlaceholder.style.display = 'none';
  } else {
    portraitImg.style.display = 'none';
    portraitPlaceholder.style.display = 'block';
  }
  $('nameHeading').textContent = data.name || 'Their Name';
  $('datesLine').textContent = data.dates || '— · —';
  const tag = $('taglineLine');
  if (data.tagline) { tag.textContent = data.tagline; tag.style.display = 'block'; }
  else { tag.style.display = 'none'; }

  const story = $('storyText');
  if (data.story) { story.textContent = data.story; story.classList.remove('placeholder'); }
  else { story.textContent = ''; story.classList.add('placeholder'); }

  $('inName').value = data.name || '';
  $('inDates').value = data.dates || '';
  $('inTagline').value = data.tagline || '';
  $('inStory').value = data.story || '';
}

async function loadProfile() {
  const data = await api('/api/profile');
  renderProfile(data);
}

async function uploadToStorage(file, statusEl) {
  if (!supabaseClient) throw new Error('Not connected');
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  if (statusEl) statusEl.textContent = 'Uploading...';
  const { error } = await supabaseClient.storage
    .from('tribute-photos')
    .upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw error;
  const { data } = supabaseClient.storage.from('tribute-photos').getPublicUrl(path);
  if (statusEl) statusEl.textContent = 'Uploaded.';
  return data.publicUrl;
}

async function saveHero() {
  const status = $('portraitUploadStatus');
  try {
    const file = $('inPortraitFile').files[0];
    const patch = {
      name: $('inName').value.trim(),
      dates: $('inDates').value.trim(),
      tagline: $('inTagline').value.trim()
    };
    if (file) {
      patch.portrait_url = await uploadToStorage(file, status);
    }
    await api('/api/profile', { method: 'PATCH', body: JSON.stringify(patch) });
    togglePanel('heroPanel');
    $('inPortraitFile').value = '';
    if (status) status.textContent = '';
    showToast('Saved');
    loadProfile();
  } catch (e) {
    showToast(e.message || 'Could not save');
  }
}
window.saveHero = saveHero;

async function saveStory() {
  try {
    await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ story: $('inStory').value.trim() }) });
    togglePanel('storyPanel');
    showToast('Saved');
    loadProfile();
  } catch (e) {
    showToast(e.message || 'Could not save');
  }
}
window.saveStory = saveStory;

/* ---------------- gallery ---------------- */

let lastGallery = [];

function renderGallery(items) {
  lastGallery = items || [];
  const grid = $('galleryGrid');
  const empty = $('galleryEmpty');
  grid.innerHTML = '';
  empty.style.display = (!items || items.length === 0) ? 'block' : 'none';
  (items || []).forEach((item) => {
    const div = document.createElement('div');
    div.className = 'gallery-item';
    let inner = `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.caption || '')}" loading="lazy">`;
    if (item.caption) inner += `<div class="cap">${escapeHtml(item.caption)}</div>`;
    if (isAdmin) inner += `<button class="gallery-remove" title="Remove" onclick="removePhoto('${item.id}')">✕</button>`;
    div.innerHTML = inner;
    grid.appendChild(div);
  });
}

async function loadGallery() {
  const items = await api('/api/gallery');
  renderGallery(items);
}

async function addPhoto() {
  const status = $('photoUploadStatus');
  const btn = $('addPhotoBtn');
  const file = $('inPhotoFile').files[0];
  const caption = $('inPhotoCaption').value.trim();
  if (!file) { status.textContent = 'Choose a photo file first.'; return; }
  btn.disabled = true;
  try {
    const url = await uploadToStorage(file, status);
    await api('/api/gallery', { method: 'POST', body: JSON.stringify({ url, caption }) });
    $('inPhotoFile').value = '';
    $('inPhotoCaption').value = '';
    status.textContent = '';
    togglePanel('galleryPanel');
    showToast('Photo added');
    loadGallery();
  } catch (e) {
    status.textContent = e.message || 'Could not add photo';
  }
  btn.disabled = false;
}
window.addPhoto = addPhoto;

async function removePhoto(id) {
  try {
    await api('/api/gallery/' + id, { method: 'DELETE' });
    loadGallery();
  } catch (e) {
    showToast(e.message || 'Could not remove photo');
  }
}
window.removePhoto = removePhoto;

/* ---------------- tributes ---------------- */

let lastTributes = [];

function renderTributes(items) {
  lastTributes = items || [];
  const list = $('tributeList');
  const empty = $('tributeEmpty');
  list.innerHTML = '';
  if (!items || items.length === 0) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  items.forEach((t) => {
    const div = document.createElement('div');
    div.className = 'tribute-card';
    let inner = `<span class="name">${escapeHtml(t.name || 'Anonymous')}</span><span class="when">${timeAgo(t.created_at)}</span><div class="msg">${escapeHtml(t.message || '')}</div>`;
    if (isAdmin) inner += `<button class="tribute-remove" onclick="removeTribute('${t.id}')">Remove</button>`;
    div.innerHTML = inner;
    list.appendChild(div);
  });
}

async function loadTributes() {
  const items = await api('/api/tributes');
  renderTributes(items);
}

async function submitTribute() {
  const nameEl = $('inTributeName');
  const msgEl = $('inTributeMsg');
  const status = $('tributeStatus');
  const message = msgEl.value.trim();
  if (!message) { status.textContent = 'Please write a message.'; return; }
  $('submitTributeBtn').disabled = true;
  try {
    await api('/api/tributes', { method: 'POST', body: JSON.stringify({ name: nameEl.value.trim(), message }) });
    nameEl.value = '';
    msgEl.value = '';
    status.textContent = 'Thank you for sharing this.';
    loadTributes();
  } catch (e) {
    status.textContent = e.message || 'Could not post — please try again.';
  }
  $('submitTributeBtn').disabled = false;
}
window.submitTribute = submitTribute;

async function removeTribute(id) {
  try {
    await api('/api/tributes/' + id, { method: 'DELETE' });
    loadTributes();
  } catch (e) {
    showToast(e.message || 'Could not remove');
  }
}
window.removeTribute = removeTribute;

/* ---------------- boot ---------------- */

async function init() {
  const res = await fetch('/api/config');
  const { supabaseUrl, supabaseAnonKey } = await res.json();
  if (supabaseUrl && supabaseAnonKey && window.supabase) {
    supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);

    const { data } = await supabaseClient.auth.getSession();
    session = data.session;

    supabaseClient.auth.onAuthStateChange((_event, newSession) => {
      session = newSession;
      updateAuthBar();
      refreshWhoAmI();
    });
  }

  updateAuthBar();
  await refreshWhoAmI();
  await Promise.all([loadProfile(), loadGallery(), loadTributes()]);
}

init();
