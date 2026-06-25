// Self-contained landing page served by `GET /`. Plain HTML + CSS + JS;
// fetches /api/themes, /api/gallery, and POSTs to /api/dressup.

export const INDEX_HTML = /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Doggo Dress-Up · Built on Neon</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🐶%3C/text%3E%3C/svg%3E" />
    <style>
      :root {
        --bg: #fff7f0;
        --card: #ffffff;
        --ink: #2b1d1a;
        --ink-soft: #6b5f5b;
        --accent: #ff6b6b;
        --accent-2: #ffb86b;
        --good: #2bb673;
        --line: #f1e0d0;
        --shadow: 0 8px 30px rgba(255, 107, 107, 0.08);
        --radius: 16px;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; }
      body {
        font-family: ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif;
        background:
          radial-gradient(1200px 600px at 80% -10%, #ffe9d9 0%, transparent 60%),
          radial-gradient(900px 500px at -10% 110%, #ffd9e0 0%, transparent 60%),
          var(--bg);
        color: var(--ink);
        min-height: 100vh;
      }
      header {
        max-width: 1100px;
        margin: 0 auto;
        padding: 36px 24px 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
      }
      .logo {
        display: flex;
        align-items: center;
        gap: 12px;
        font-weight: 800;
        font-size: 22px;
        letter-spacing: -0.01em;
      }
      .logo .dot { font-size: 28px; }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: #fff;
        border: 1px solid var(--line);
        padding: 6px 12px;
        border-radius: 999px;
        font-size: 13px;
        color: var(--ink-soft);
        box-shadow: var(--shadow);
      }
      .badge .pulse {
        width: 8px; height: 8px; border-radius: 50%;
        background: var(--good);
        box-shadow: 0 0 0 4px rgba(43, 182, 115, 0.18);
      }
      main {
        max-width: 1100px;
        margin: 0 auto;
        padding: 8px 24px 80px;
      }
      .hero {
        text-align: center;
        padding: 24px 0 16px;
      }
      .hero h1 {
        font-size: clamp(36px, 6vw, 56px);
        margin: 12px 0 8px;
        letter-spacing: -0.02em;
        line-height: 1.05;
      }
      .hero h1 em {
        font-style: normal;
        background: linear-gradient(90deg, var(--accent), var(--accent-2));
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }
      .hero p {
        margin: 0 auto;
        max-width: 620px;
        color: var(--ink-soft);
        font-size: 17px;
        line-height: 1.5;
      }
      .panel {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        padding: 24px;
      }
      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
      }
      @media (max-width: 820px) {
        .grid { grid-template-columns: 1fr; }
      }
      h2 {
        margin: 0 0 16px;
        font-size: 18px;
        letter-spacing: -0.01em;
      }
      h3 {
        margin: 28px 0 12px;
        font-size: 15px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--ink-soft);
      }
      .uploader {
        position: relative;
        border: 2px dashed #f0c9ad;
        background: #fff8f1;
        border-radius: var(--radius);
        height: 280px;
        display: flex; align-items: center; justify-content: center;
        flex-direction: column; gap: 8px;
        cursor: pointer;
        overflow: hidden;
        transition: border-color .2s, background .2s;
      }
      .uploader:hover { border-color: var(--accent); }
      .uploader.has-image { border-style: solid; background: #fff; }
      .uploader input[type=file] {
        position: absolute; inset: 0; opacity: 0; cursor: pointer;
      }
      .uploader .placeholder { text-align: center; color: var(--ink-soft); }
      .uploader .placeholder .big { font-size: 44px; }
      .uploader img {
        width: 100%; height: 100%; object-fit: cover;
      }
      .swap {
        position: absolute;
        right: 12px; bottom: 12px;
        background: rgba(0,0,0,0.6); color: #fff;
        border: 0; border-radius: 999px;
        padding: 6px 12px; font-size: 13px; cursor: pointer;
        display: none;
      }
      .uploader.has-image .swap { display: inline-flex; }
      .themes {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
      }
      @media (max-width: 540px) {
        .themes { grid-template-columns: repeat(3, 1fr); }
      }
      .theme {
        background: #fff;
        border: 1.5px solid var(--line);
        border-radius: 14px;
        padding: 14px 8px;
        cursor: pointer;
        text-align: center;
        font-size: 13px;
        font-weight: 600;
        color: var(--ink);
        transition: transform .08s, border-color .15s, background .15s;
      }
      .theme:hover { transform: translateY(-1px); border-color: #f0c9ad; }
      .theme .e { font-size: 28px; display: block; margin-bottom: 4px; }
      .theme.selected {
        border-color: var(--accent);
        background: #fff1f0;
        box-shadow: 0 0 0 3px rgba(255,107,107,0.12);
      }
      .actions { margin-top: 18px; }
      .btn {
        appearance: none;
        border: 0;
        background: linear-gradient(90deg, var(--accent), var(--accent-2));
        color: #fff;
        font-weight: 700;
        font-size: 17px;
        padding: 14px 22px;
        border-radius: 12px;
        cursor: pointer;
        width: 100%;
        box-shadow: 0 6px 18px rgba(255, 107, 107, 0.25);
        transition: transform .08s, opacity .15s;
      }
      .btn:hover { transform: translateY(-1px); }
      .btn:disabled {
        background: #f3e1d6; color: #b9a596; cursor: not-allowed;
        box-shadow: none; transform: none;
      }
      .status {
        margin-top: 12px;
        text-align: center;
        font-size: 14px;
        color: var(--ink-soft);
        min-height: 20px;
      }
      .status.error { color: #c0392b; }
      .result {
        margin-top: 24px;
        display: none;
      }
      .result.show { display: block; }
      .result-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }
      @media (max-width: 540px) {
        .result-grid { grid-template-columns: 1fr; }
      }
      .result-card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        overflow: hidden;
        text-align: center;
      }
      .result-card .label {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--ink-soft);
        padding: 10px;
      }
      .result-card img {
        display: block;
        width: 100%;
        aspect-ratio: 1 / 1;
        object-fit: cover;
      }
      .gallery {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 14px;
      }
      .tile {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 14px;
        overflow: hidden;
      }
      .tile img {
        display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: cover;
      }
      .tile .meta {
        padding: 10px 12px;
        font-size: 13px;
        color: var(--ink-soft);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .tile .meta strong { color: var(--ink); font-weight: 700; }
      .empty {
        color: var(--ink-soft);
        text-align: center;
        padding: 24px;
        border: 1px dashed var(--line);
        border-radius: var(--radius);
      }
      footer {
        max-width: 1100px;
        margin: 0 auto;
        padding: 0 24px 60px;
        text-align: center;
        font-size: 13px;
        color: var(--ink-soft);
      }
      footer a { color: var(--ink); }
      .spinner {
        width: 18px; height: 18px;
        border: 2px solid #f3e1d6;
        border-top-color: var(--accent);
        border-radius: 50%;
        display: inline-block; vertical-align: -3px; margin-right: 8px;
        animation: spin 0.9s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <header>
      <div class="logo">
        <span class="dot">🐶</span>
        <span>Doggo Dress-Up</span>
      </div>
      <div class="badge"><span class="pulse"></span> Built on Neon · Functions · Storage · AI Gateway</div>
    </header>

    <main>
      <section class="hero">
        <h1>Turn your dog into a <em>knight, astronaut, or sushi chef.</em></h1>
        <p>Upload a photo of your good boy or girl, pick a costume, and a tiny AI agent re-imagines them. The pic, the prompt, and the result all live in one branch-scoped Neon project.</p>
      </section>

      <section class="panel">
        <div class="grid">
          <div>
            <h2>1. Drop a dog photo</h2>
            <label class="uploader" id="uploader">
              <input id="file" type="file" accept="image/*" />
              <div class="placeholder">
                <div class="big">📷</div>
                <div>Click or drop a JPG/PNG of your dog</div>
                <div style="font-size:12px;opacity:.7">Max 8 MB</div>
              </div>
              <button type="button" class="swap" id="swap">Swap photo</button>
            </label>
          </div>
          <div>
            <h2>2. Pick a costume</h2>
            <div class="themes" id="themes"></div>
          </div>
        </div>

        <div class="actions">
          <button class="btn" id="go" disabled>Dress my dog!</button>
          <div class="status" id="status"></div>
        </div>

        <div class="result" id="result">
          <h3 id="resultTitle">Result</h3>
          <div class="result-grid">
            <div class="result-card">
              <div class="label">Original</div>
              <img id="origImg" alt="Original" />
            </div>
            <div class="result-card">
              <div class="label" id="outLabel">Dressed up</div>
              <img id="outImg" alt="Dressed up" />
            </div>
          </div>
        </div>
      </section>

      <h3>Recent dress-ups</h3>
      <div id="gallery" class="gallery"></div>
    </main>

    <footer>
      Built on the
      <a href="https://build-on-neon.vercel.app/" target="_blank" rel="noopener">Neon backend for apps and agents</a>
      preview · <a href="https://github.com" target="_blank" rel="noopener">source on GitHub</a>
    </footer>

    <script>
      const fileEl = document.getElementById('file');
      const uploader = document.getElementById('uploader');
      const placeholder = uploader.querySelector('.placeholder');
      const swapBtn = document.getElementById('swap');
      const themesEl = document.getElementById('themes');
      const goBtn = document.getElementById('go');
      const statusEl = document.getElementById('status');
      const resultEl = document.getElementById('result');
      const resultTitle = document.getElementById('resultTitle');
      const origImg = document.getElementById('origImg');
      const outImg = document.getElementById('outImg');
      const outLabel = document.getElementById('outLabel');
      const galleryEl = document.getElementById('gallery');

      let selectedTheme = null;
      let selectedFile = null;

      function updateGo() {
        goBtn.disabled = !(selectedFile && selectedTheme);
      }

      async function loadThemes() {
        const r = await fetch('/api/themes');
        const { themes } = await r.json();
        themesEl.innerHTML = '';
        for (const t of themes) {
          const el = document.createElement('button');
          el.type = 'button';
          el.className = 'theme';
          el.dataset.id = t.id;
          el.innerHTML = '<span class="e">' + t.emoji + '</span>' + t.label;
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
        const img = uploader.querySelector('img') || document.createElement('img');
        img.src = URL.createObjectURL(f);
        if (!img.parentNode) uploader.insertBefore(img, swapBtn);
        placeholder.style.display = 'none';
        uploader.classList.add('has-image');
        updateGo();
      }

      fileEl.addEventListener('change', () => setFile(fileEl.files[0] || null));
      swapBtn.addEventListener('click', (e) => {
        e.preventDefault();
        fileEl.click();
      });
      // drag-and-drop
      ;['dragenter','dragover'].forEach(ev =>
        uploader.addEventListener(ev, (e) => { e.preventDefault(); uploader.style.borderColor = '#ff6b6b'; })
      );
      ;['dragleave','drop'].forEach(ev =>
        uploader.addEventListener(ev, (e) => { e.preventDefault(); uploader.style.borderColor = ''; })
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
        statusEl.innerHTML = '<span class="spinner"></span>Dressing up your dog as a ' + selectedTheme.label + '… (this takes ~30s)';

        const fd = new FormData();
        fd.append('photo', selectedFile);
        fd.append('theme', selectedTheme.id);

        try {
          let r = await fetch('/api/dressup', { method: 'POST', body: fd });
          let data = await r.json();
          // One automatic retry on rate-limit, with a short wait.
          if (r.status === 429 && data.retry) {
            statusEl.innerHTML = '<span class="spinner"></span>Rate-limited by the AI Gateway. Waiting 20s and retrying…';
            await new Promise((res) => setTimeout(res, 20000));
            r = await fetch('/api/dressup', { method: 'POST', body: fd });
            data = await r.json();
          }
          if (!r.ok) throw new Error(data.error || 'request failed');
          origImg.src = data.originalUrl;
          outImg.src = data.outputUrl;
          outLabel.textContent = data.emoji + ' ' + data.themeLabel;
          resultTitle.textContent = 'Your dog as a ' + data.themeLabel + ' ' + data.emoji;
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
          const r = await fetch('/api/gallery');
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
            meta.innerHTML = '<strong>' + it.emoji + ' ' + it.themeLabel + '</strong><span>' + new Date(it.createdAt).toLocaleString() + '</span>';
            tile.appendChild(img);
            tile.appendChild(meta);
            galleryEl.appendChild(tile);
          }
        } catch (err) {
          galleryEl.innerHTML = '<div class="empty">Could not load gallery.</div>';
        }
      }

      loadThemes();
      loadGallery();
    </script>
  </body>
</html>
`;
