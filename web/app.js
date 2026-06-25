// Doggo Dress-Up frontend.
// Two services: the Neon Function (API) and Neon Auth (sign-in / token issuance).

// API base: hardcoded production deploy. Override by setting `?api=...` in the URL
// or by setting `window.DOGGO_API_BASE` before this script runs.
const API_BASE =
  new URL(location.href).searchParams.get('api') ||
  window.DOGGO_API_BASE ||
  'https://br-ancient-dream-aj6ae96i-dressup.compute.c-3.us-east-2.aws.neon.tech';

// Neon Auth base URL — discovered at runtime from /api/auth-config so it stays
// in sync with whatever `auth: true` resolves to on the linked branch.
let AUTH_BASE = null;

// In-memory JWT (refreshed on demand). Session cookie lives on the auth domain.
let jwt = null;
let jwtFetchedAt = 0;
const JWT_TTL_MS = 14 * 60 * 1000; // gateway issues 15-minute tokens; refresh just before then

const $ = (id) => document.getElementById(id);

const authGate = $('authGate');
const appPanel = $('appPanel');
const userBox = $('userBox');
const userEmail = $('userEmail');

// ---------- auth helpers ----------

async function bootstrapAuthBase() {
  if (AUTH_BASE) return AUTH_BASE;
  const r = await fetch(`${API_BASE}/api/auth-config`);
  const data = await r.json();
  AUTH_BASE = data.baseUrl;
  return AUTH_BASE;
}

async function fetchJwt() {
  await bootstrapAuthBase();
  const r = await fetch(`${AUTH_BASE}/token`, { credentials: 'include' });
  if (!r.ok) {
    jwt = null;
    return null;
  }
  const { token } = await r.json();
  if (token) {
    jwt = token;
    jwtFetchedAt = Date.now();
  }
  return jwt;
}

async function ensureJwt() {
  if (jwt && Date.now() - jwtFetchedAt < JWT_TTL_MS) return jwt;
  return await fetchJwt();
}

async function api(path, opts = {}) {
  const t = await ensureJwt();
  const headers = new Headers(opts.headers || {});
  if (t) headers.set('Authorization', `Bearer ${t}`);
  let res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (res.status === 401) {
    // Token might have just expired — try one refresh.
    const refreshed = await fetchJwt();
    if (refreshed) {
      headers.set('Authorization', `Bearer ${refreshed}`);
      res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
    }
  }
  return res;
}

async function checkAuthState() {
  await bootstrapAuthBase();
  const t = await fetchJwt();
  if (!t) {
    showAuthGate();
    return null;
  }
  const r = await api('/api/me');
  const data = await r.json().catch(() => ({}));
  if (!data.user) {
    showAuthGate();
    return null;
  }
  showApp(data.user);
  return data.user;
}

function showAuthGate() {
  authGate.classList.remove('hidden');
  appPanel.classList.add('hidden');
  userBox.classList.add('hidden');
}
function showApp(user) {
  authGate.classList.add('hidden');
  appPanel.classList.remove('hidden');
  userBox.classList.remove('hidden');
  userEmail.textContent = user.email || user.name || 'Signed in';
  loadThemes();
  loadGallery();
}

async function signIn(email, password) {
  await bootstrapAuthBase();
  const r = await fetch(`${AUTH_BASE}/sign-in/email`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.user) {
    throw new Error(data.message || data.error?.message || 'sign-in failed');
  }
  jwt = null; // force a fresh /token
  return data.user;
}

async function signUp(name, email, password) {
  await bootstrapAuthBase();
  const r = await fetch(`${AUTH_BASE}/sign-up/email`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.user) {
    throw new Error(data.message || data.error?.message || 'sign-up failed');
  }
  jwt = null;
  return data.user;
}

async function signOut() {
  await bootstrapAuthBase();
  await fetch(`${AUTH_BASE}/sign-out`, {
    method: 'POST',
    credentials: 'include',
  }).catch(() => {});
  jwt = null;
  jwtFetchedAt = 0;
  showAuthGate();
}

// ---------- auth UI ----------

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    for (const t of document.querySelectorAll('.tab')) t.classList.remove('selected');
    tab.classList.add('selected');
    const which = tab.dataset.tab;
    $('signinForm').classList.toggle('hidden', which !== 'signin');
    $('signupForm').classList.toggle('hidden', which !== 'signup');
  });
}

$('signinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('signinStatus');
  status.classList.remove('error');
  status.innerHTML = '<span class="spinner"></span>Signing you in…';
  const fd = new FormData(e.target);
  try {
    const user = await signIn(fd.get('email'), fd.get('password'));
    status.textContent = `Welcome back, ${user.name || user.email}`;
    await checkAuthState();
  } catch (err) {
    status.classList.add('error');
    status.textContent = err.message;
  }
});

$('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('signupStatus');
  status.classList.remove('error');
  status.innerHTML = '<span class="spinner"></span>Creating your account…';
  const fd = new FormData(e.target);
  try {
    const user = await signUp(fd.get('name'), fd.get('email'), fd.get('password'));
    status.textContent = `Welcome, ${user.name || user.email}`;
    await checkAuthState();
  } catch (err) {
    status.classList.add('error');
    status.textContent = err.message;
  }
});

$('signOut').addEventListener('click', () => signOut());

// ---------- dressup app ----------

let selectedTheme = null;
let selectedFile = null;

const fileEl = $('file');
const uploader = $('uploader');
const placeholder = uploader.querySelector('.placeholder');
const swapBtn = $('swap');
const themesEl = $('themes');
const goBtn = $('go');
const statusEl = $('status');
const resultEl = $('result');
const resultTitle = $('resultTitle');
const origImg = $('origImg');
const outImg = $('outImg');
const outLabel = $('outLabel');
const galleryEl = $('gallery');

function updateGo() {
  goBtn.disabled = !(selectedFile && selectedTheme);
}

async function loadThemes() {
  const r = await fetch(`${API_BASE}/api/themes`);
  const { themes } = await r.json();
  themesEl.innerHTML = '';
  for (const t of themes) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'theme';
    el.dataset.id = t.id;
    el.innerHTML = `<span class="e">${t.emoji}</span>${t.label}`;
    el.addEventListener('click', () => {
      selectedTheme = t;
      for (const c of themesEl.querySelectorAll('.theme')) c.classList.remove('selected');
      el.classList.add('selected');
      updateGo();
    });
    themesEl.appendChild(el);
  }
}

function setFile(f) {
  selectedFile = f;
  if (!f) {
    uploader.classList.remove('has-image');
    const old = uploader.querySelector('img');
    if (old) old.remove();
    placeholder.style.display = '';
    updateGo();
    return;
  }
  let img = uploader.querySelector('img');
  if (!img) {
    img = document.createElement('img');
    uploader.insertBefore(img, swapBtn);
  }
  img.src = URL.createObjectURL(f);
  placeholder.style.display = 'none';
  uploader.classList.add('has-image');
  updateGo();
}

fileEl.addEventListener('change', () => setFile(fileEl.files[0] || null));
swapBtn.addEventListener('click', (e) => { e.preventDefault(); fileEl.click(); });
['dragenter', 'dragover'].forEach((ev) =>
  uploader.addEventListener(ev, (e) => { e.preventDefault(); uploader.style.borderColor = '#ff6b6b'; }),
);
['dragleave', 'drop'].forEach((ev) =>
  uploader.addEventListener(ev, (e) => { e.preventDefault(); uploader.style.borderColor = ''; }),
);
uploader.addEventListener('drop', (e) => {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) setFile(f);
});

goBtn.addEventListener('click', async () => {
  if (!selectedFile || !selectedTheme) return;
  goBtn.disabled = true;
  resultEl.classList.remove('show');
  statusEl.classList.remove('error');
  statusEl.innerHTML = `<span class="spinner"></span>Dressing up your dog as a ${selectedTheme.label}… (this takes ~30s)`;

  const fd = new FormData();
  fd.append('photo', selectedFile);
  fd.append('theme', selectedTheme.id);

  try {
    let r = await api('/api/dressup', { method: 'POST', body: fd });
    let data = await r.json();
    if (r.status === 429 && data.retry) {
      statusEl.innerHTML = '<span class="spinner"></span>Rate-limited by the AI Gateway. Waiting 20s and retrying…';
      await new Promise((res) => setTimeout(res, 20000));
      r = await api('/api/dressup', { method: 'POST', body: fd });
      data = await r.json();
    }
    if (!r.ok) throw new Error(data.error || 'request failed');
    origImg.src = data.originalUrl;
    outImg.src = data.outputUrl;
    outLabel.textContent = `${data.emoji} ${data.themeLabel}`;
    resultTitle.textContent = `Your dog as a ${data.themeLabel} ${data.emoji}`;
    resultEl.classList.add('show');
    statusEl.textContent = 'Done!';
    loadGallery();
  } catch (err) {
    statusEl.classList.add('error');
    statusEl.textContent = err.message || String(err);
  } finally {
    goBtn.disabled = false;
    updateGo();
  }
});

async function loadGallery() {
  try {
    const r = await api('/api/gallery');
    if (!r.ok) {
      galleryEl.innerHTML = '<div class="empty">Could not load gallery.</div>';
      return;
    }
    const { items } = await r.json();
    if (!items || items.length === 0) {
      galleryEl.innerHTML = '<div class="empty">No dress-ups yet — be the first!</div>';
      return;
    }
    galleryEl.innerHTML = '';
    for (const it of items) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      const img = document.createElement('img');
      img.src = it.outputUrl;
      img.alt = it.themeLabel;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = `<strong>${it.emoji} ${it.themeLabel}</strong><span>${new Date(it.createdAt).toLocaleString()}</span>`;
      tile.appendChild(img);
      tile.appendChild(meta);
      galleryEl.appendChild(tile);
    }
  } catch {
    galleryEl.innerHTML = '<div class="empty">Could not load gallery.</div>';
  }
}

// boot
checkAuthState();
