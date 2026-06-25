// Doggo Dress-Up frontend (Vibecastly-style).
// 1. Add pets (the "cast")
// 2. Write a prompt and @-mention them
// 3. Generate
//
// Two services: the Neon Function (API) and Neon Auth (sign-in / token issuance).

const API_BASE =
  new URL(location.href).searchParams.get('api') ||
  window.DOGGO_API_BASE ||
  'https://br-rapid-forest-aj8fmj9i-dressup.compute.c-3.us-east-2.aws.neon.tech';

let AUTH_BASE = null;
let jwt = null;
let jwtFetchedAt = 0;
const JWT_TTL_MS = 14 * 60 * 1000;

const $ = (id) => document.getElementById(id);

const homeSection = $('home');
const appPanel = $('appPanel');
const userBox = $('userBox');
const userEmail = $('userEmail');

let petsCache = [];          // [{ id, name, slug, photoUrl }]
let examplesCache = [];      // [{ id, emoji, label, template }]

// ---------- auth ----------

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
  if (!r.ok) { jwt = null; return null; }
  const { token } = await r.json();
  if (token) { jwt = token; jwtFetchedAt = Date.now(); }
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
  if (!t) { showAuthGate(); return null; }
  const r = await api('/api/me');
  const data = await r.json().catch(() => ({}));
  if (!data.user) { showAuthGate(); return null; }
  showApp(data.user);
  return data.user;
}

function showAuthGate() {
  homeSection.classList.remove('hidden');
  appPanel.classList.add('hidden');
  userBox.classList.add('hidden');
}
function showApp(user) {
  homeSection.classList.add('hidden');
  appPanel.classList.remove('hidden');
  userBox.classList.remove('hidden');
  userEmail.textContent = user.email || user.name || 'Signed in';
  loadExamples();
  loadPets();
  loadGallery();
  // Scroll to top on transition for a clean feel.
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function signIn(email, password) {
  await bootstrapAuthBase();
  const r = await fetch(`${AUTH_BASE}/sign-in/email`, {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.user) throw new Error(data.message || data.error?.message || 'sign-in failed');
  jwt = null;
  return data.user;
}

async function signUp(name, email, password) {
  await bootstrapAuthBase();
  const r = await fetch(`${AUTH_BASE}/sign-up/email`, {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.user) throw new Error(data.message || data.error?.message || 'sign-up failed');
  jwt = null;
  return data.user;
}

async function signOut() {
  await bootstrapAuthBase();
  await fetch(`${AUTH_BASE}/sign-out`, { method: 'POST', credentials: 'include' }).catch(() => {});
  jwt = null; jwtFetchedAt = 0;
  petsCache = [];
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

// ---------- cast (pets) ----------

const castEl = $('cast');
const addPetDetails = $('addPetDetails');
const addPetForm = $('addPetForm');
const addPetStatus = $('addPetStatus');

function petInsert(slug) {
  const ta = $('prompt');
  const cur = ta.value;
  const tag = `@${slug} `;
  // Append (or insert at cursor)
  const start = ta.selectionStart ?? cur.length;
  const end = ta.selectionEnd ?? cur.length;
  ta.value = cur.slice(0, start) + tag + cur.slice(end);
  ta.focus();
  const pos = start + tag.length;
  ta.setSelectionRange(pos, pos);
  updateGo();
}

function renderPets() {
  castEl.innerHTML = '';
  if (petsCache.length === 0) {
    castEl.innerHTML = '<div class="empty">No pets yet. Click <strong>+ Add a pet</strong> below to get started.</div>';
    return;
  }
  for (const p of petsCache) {
    const card = document.createElement('div');
    card.className = 'pet-card';
    card.innerHTML = `
      <button type="button" class="delete" title="Remove">×</button>
      <img src="${p.photoUrl}" alt="${p.name}" />
      <div class="name">${p.name}</div>
      <div class="slug">@${p.slug}</div>
      <button type="button" class="insert">Insert @${p.slug}</button>
    `;
    card.querySelector('.delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Remove ${p.name} from your cast?`)) return;
      const r = await api(`/api/pets/${p.id}`, { method: 'DELETE' });
      if (r.ok) loadPets();
    });
    card.querySelector('.insert').addEventListener('click', () => petInsert(p.slug));
    castEl.appendChild(card);
  }
}

async function loadPets() {
  try {
    const r = await api('/api/pets');
    if (!r.ok) { petsCache = []; renderPets(); return; }
    const { items } = await r.json();
    petsCache = items || [];
  } catch {
    petsCache = [];
  }
  renderPets();
}

addPetForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  addPetStatus.classList.remove('error');
  addPetStatus.innerHTML = '<span class="spinner"></span>Adding…';
  const fd = new FormData(addPetForm);
  try {
    const r = await api('/api/pets', { method: 'POST', body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'failed');
    addPetStatus.textContent = `Added @${data.slug}.`;
    addPetForm.reset();
    addPetDetails.open = false;
    loadPets();
  } catch (err) {
    addPetStatus.classList.add('error');
    addPetStatus.textContent = err.message;
  }
});

// ---------- examples ----------

const examplesEl = $('examples');

async function loadExamples() {
  try {
    const r = await fetch(`${API_BASE}/api/examples`);
    const { examples } = await r.json();
    examplesCache = examples || [];
  } catch {
    examplesCache = [];
  }
  examplesEl.innerHTML = '';
  for (const ex of examplesCache) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ex';
    b.innerHTML = `${ex.emoji} ${ex.label}`;
    b.title = ex.template;
    b.addEventListener('click', () => fillExample(ex));
    examplesEl.appendChild(b);
  }
}

function fillExample(ex) {
  const ta = $('prompt');
  let mention;
  if (petsCache.length > 0) {
    mention = `@${petsCache[0].slug}`;
  } else {
    mention = '@yourdog';
  }
  ta.value = ex.template.replace(/\{pet\}/g, mention);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  updateGo();
}

// ---------- @-mention autocomplete ----------

const mentionPopup = $('mentionPopup');
let mentionState = null; // { start, items, active }

function closeMentionPopup() {
  mentionPopup.classList.add('hidden');
  mentionPopup.innerHTML = '';
  mentionState = null;
}

function openMentionPopup(start, query) {
  const matches = petsCache.filter((p) => p.slug.startsWith(query.toLowerCase()));
  if (matches.length === 0) return closeMentionPopup();

  mentionState = { start, items: matches, active: 0 };
  mentionPopup.innerHTML = '';
  matches.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'item' + (i === 0 ? ' active' : '');
    item.innerHTML = `<img src="${p.photoUrl}" /><span><strong>${p.name}</strong> <span class="slug">@${p.slug}</span></span>`;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); pickMention(p); });
    mentionPopup.appendChild(item);
  });
  mentionPopup.classList.remove('hidden');
}

function pickMention(pet) {
  if (!mentionState) return;
  const ta = $('prompt');
  const before = ta.value.slice(0, mentionState.start);
  const after = ta.value.slice(ta.selectionStart);
  ta.value = `${before}@${pet.slug} ${after}`;
  const pos = before.length + 2 + pet.slug.length;
  ta.setSelectionRange(pos, pos);
  ta.focus();
  closeMentionPopup();
  updateGo();
}

function refreshMentionFromTextarea() {
  const ta = $('prompt');
  const cursor = ta.selectionStart ?? 0;
  const upto = ta.value.slice(0, cursor);
  const m = upto.match(/(?:^|\s)@([\p{L}\p{N}_-]{0,32})$/u);
  if (!m) return closeMentionPopup();
  const start = cursor - m[1].length - 1; // includes the @
  openMentionPopup(start, m[1]);
}

$('prompt').addEventListener('input', () => { refreshMentionFromTextarea(); updateGo(); });
$('prompt').addEventListener('keyup', (e) => {
  if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) refreshMentionFromTextarea();
});
$('prompt').addEventListener('blur', () => setTimeout(closeMentionPopup, 100));
$('prompt').addEventListener('keydown', (e) => {
  if (!mentionState) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    mentionState.active = (mentionState.active + 1) % mentionState.items.length;
    refreshMentionPopupActive();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    mentionState.active = (mentionState.active - 1 + mentionState.items.length) % mentionState.items.length;
    refreshMentionPopupActive();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    pickMention(mentionState.items[mentionState.active]);
  } else if (e.key === 'Escape') {
    closeMentionPopup();
  }
});
function refreshMentionPopupActive() {
  for (const [i, el] of [...mentionPopup.children].entries()) {
    el.classList.toggle('active', i === mentionState.active);
  }
}

// ---------- generate ----------

const promptEl = $('prompt');
const goBtn = $('go');
const statusEl = $('status');
const resultEl = $('result');
const resultTitle = $('resultTitle');
const outImg = $('outImg');
const outMeta = $('outMeta');

function updateGo() {
  const text = promptEl.value.trim();
  goBtn.disabled = text.length === 0;
}

goBtn.addEventListener('click', async () => {
  const prompt = promptEl.value.trim();
  if (!prompt) return;
  goBtn.disabled = true;
  resultEl.classList.remove('show');
  statusEl.classList.remove('error');
  statusEl.innerHTML = '<span class="spinner"></span>Generating… (this takes ~30s)';

  try {
    let r = await api('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    let data = await r.json();
    if (r.status === 429 && data.retry) {
      statusEl.innerHTML = '<span class="spinner"></span>Rate-limited by the AI Gateway. Waiting 20s and retrying…';
      await new Promise((res) => setTimeout(res, 20000));
      r = await api('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      data = await r.json();
    }
    if (!r.ok) throw new Error(data.error || 'request failed');
    outImg.src = data.outputUrl;
    outMeta.innerHTML = `<div><strong>${(data.petNames || []).join(', ') || 'Result'}</strong></div><div class="muted small">${escapeHtml(data.prompt)}</div>`;
    resultTitle.textContent = 'Result';
    resultEl.classList.add('show');
    statusEl.textContent = data.warnings?.length ? data.warnings.join(' · ') : 'Done!';
    loadGallery();
  } catch (err) {
    statusEl.classList.add('error');
    statusEl.textContent = err.message || String(err);
  } finally {
    goBtn.disabled = false;
    updateGo();
  }
});

// ---------- gallery ----------

const galleryEl = $('gallery');

async function loadGallery() {
  try {
    const r = await api('/api/gallery');
    if (!r.ok) { galleryEl.innerHTML = '<div class="empty">Could not load gallery.</div>'; return; }
    const { items } = await r.json();
    if (!items || items.length === 0) {
      galleryEl.innerHTML = '<div class="empty">No generations yet — write a prompt above to make your first one.</div>';
      return;
    }
    galleryEl.innerHTML = '';
    for (const it of items) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.innerHTML = `
        <img src="${it.outputUrl}" alt="" />
        <div class="meta">
          <div class="prompt">${escapeHtml(it.prompt)}</div>
          <div class="when">${(it.petNames || []).join(', ') ? '🐶 ' + escapeHtml((it.petNames || []).join(', ')) + ' · ' : ''}${new Date(it.createdAt).toLocaleString()}</div>
        </div>
      `;
      galleryEl.appendChild(tile);
    }
  } catch {
    galleryEl.innerHTML = '<div class="empty">Could not load gallery.</div>';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// boot
checkAuthState();
