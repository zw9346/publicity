(function () {
  'use strict';

  /* ============================================================
     兜底数据：fetch 失败（例如 file:// 打开）也能显示内容
     ============================================================ */
  const FALLBACK = {
    playlist: [
      { type: 'image', src: 'assets/images/1.jpg', duration: 5000, fit: 'cover' }
    ],
    subtitle: '欢迎观看宣传展示（默认字幕，请检查 data/subtitle.txt 是否可访问）。',
    panels: [
      {
        title: '提示',
        rows: [
          { label: '数据文件', value: '未加载' },
          { label: '建议', value: '用 HTTP 打开' }
        ]
      }
    ]
  };

  /* ---------- DOM ---------- */
  const clockEl    = document.getElementById('clock');
  const dateEl     = document.getElementById('date');
  const panelsEl   = document.getElementById('panels');
  const badgeEl    = document.getElementById('media-badge');
  const subtitleEl = document.getElementById('subtitle');
  const subCopyEl  = document.getElementById('subtitle-copy');
  const layers = {
    a: document.getElementById('layer-a'),
    b: document.getElementById('layer-b')
  };

  /* ---------- 状态 ---------- */
  let playlist    = [];
  let index       = 0;
  let activeLayer = 'a';
  let timer       = null;
  let token       = 0;
  const preloaded = new Set();

  /* ============================================================
     时钟
     ============================================================ */
  function updateClock() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
    dateEl.textContent  = now.toLocaleDateString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long'
    });
  }
  updateClock();
  setInterval(updateClock, 1000);

  /* ============================================================
     安全的 fetch 工具
     ============================================================ */
  async function fetchJSON(url, fallback) {
    try {
      const res = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return data;
    } catch (e) {
      console.warn('[fetchJSON] ' + url + ' 失败：' + e.message + '（使用兜底数据）');
      return fallback;
    }
  }

  async function fetchText(url, fallback) {
    try {
      const res = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = (await res.text()).trim();
      return text || fallback;
    } catch (e) {
      console.warn('[fetchText] ' + url + ' 失败：' + e.message + '（使用兜底数据）');
      return fallback;
    }
  }

  /* ============================================================
     媒体工具
     ============================================================ */
  function createMediaEl(item) {
    const fit = item.fit === 'contain' ? 'contain' : 'cover';

    if (item.type === 'video') {
      const v = document.createElement('video');
      v.className = 'media-el';
      v.muted = true;
      v.defaultMuted = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
      v.preload = 'auto';
      v.style.objectFit = fit;
      v.src = item.src;
      return v;
    }

    const img = document.createElement('img');
    img.className = 'media-el';
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'eager';
    img.style.objectFit = fit;
    img.src = item.src;
    return img;
  }

  function waitReady(el, timeout = 8000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ok   = () => { if (!settled) { settled = true; resolve(); } };
      const fail = () => { if (!settled) { settled = true; reject(new Error('媒体加载失败')); } };

      if (el.tagName === 'IMG') {
        if (el.complete) {
          return el.naturalWidth > 0 ? ok() : fail();
        }
        el.addEventListener('load',  ok,   { once: true });
        el.addEventListener('error', fail, { once: true });
      } else {
        if (el.readyState >= 3) return ok();
        el.addEventListener('canplay', ok,   { once: true });
        el.addEventListener('error',   fail, { once: true });
      }
      setTimeout(ok, timeout);
    });
  }

  function preload(item) {
    if (!item || !item.src || preloaded.has(item.src)) return;
    preloaded.add(item.src);
    if (item.type === 'video') {
      const v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      v.src = item.src;
    } else {
      const img = new Image();
      img.src = item.src;
    }
  }

  function showMediaError(container, src) {
    const err = document.createElement('div');
    err.className = 'media-error';
    err.innerHTML =
      '<strong>媒体加载失败</strong>' +
      '<div>请检查文件名大小写与路径是否正确</div>' +
      '<code>' + src + '</code>';
    container.appendChild(err);
  }

  /* ============================================================
     播放核心：双缓冲
     ============================================================ */
  async function playIndex(i) {
    const item = playlist[i];
    if (!item) return;

    clearTimeout(timer);
    const myToken = ++token;

    const incomingName = activeLayer === 'a' ? 'b' : 'a';
    const incoming = layers[incomingName];
    const outgoing = layers[activeLayer];

    // 清空待用层
    incoming.innerHTML = '';
    incoming.classList.remove('error');

    // 放入新的媒体元素
    const el = createMediaEl(item);
    incoming.appendChild(el);

    // 加载动画
    const loading = document.createElement('div');
    loading.className = 'media-loading';
    loading.innerHTML = '<span></span>';
    incoming.appendChild(loading);

    // 等就绪
    try {
      await waitReady(el);
    } catch (err) {
      if (myToken !== token) return;
      loading.remove();
      showMediaError(incoming, item.src);
      incoming.classList.add('visible');
      outgoing.classList.remove('visible');
      activeLayer = incomingName;
      // 3 秒后跳下一项，避免卡在这一条
      timer = setTimeout(() => {
        if (myToken !== token) return;
        nextItem();
      }, 3000);
      return;
    }

    if (myToken !== token) return;
    loading.remove();

    // 交叉淡入淡出
    incoming.style.transition = 'none';
    incoming.classList.add('visible');
    void incoming.offsetHeight;
    incoming.style.transition = '';

    outgoing.classList.remove('visible');
    activeLayer = incomingName;

    // 更新角标
    badgeEl.textContent = (i + 1) + ' / ' + playlist.length;

    // 清空旧层
    setTimeout(() => {
      if (!outgoing.classList.contains('visible')) outgoing.innerHTML = '';
    }, 900);

    // 只有一项
    if (playlist.length === 1) {
      if (item.type === 'video') {
        el.loop = true;
        el.play().catch(() => {});
      }
      return;
    }

    // 调度下一项
    if (item.type === 'video') {
      el.play().then(() => {
        if (myToken !== token) return;
        el.addEventListener('ended', () => {
          if (myToken !== token) return;
          nextItem();
        }, { once: true });
      }).catch(() => {
        if (myToken !== token) return;
        timer = setTimeout(() => {
          if (myToken !== token) return;
          nextItem();
        }, item.duration || 6000);
      });
    } else {
      timer = setTimeout(() => {
        if (myToken !== token) return;
        nextItem();
      }, item.duration || 5000);
    }

    // 预加载下一项
    preload(playlist[(i + 1) % playlist.length]);
  }

  function nextItem() {
    index = (index + 1) % playlist.length;
    playIndex(index);
  }

  /* ============================================================
     数据加载
     ============================================================ */
  async function loadPlaylist() {
    const data = await fetchJSON('./data/playlist.json', FALLBACK.playlist);
    playlist = Array.isArray(data) && data.length ? data : FALLBACK.playlist;

    // 过滤掉明显不合法的条目
    playlist = playlist.filter(it => it && it.src && (it.type === 'image' || it.type === 'video'));

    if (!playlist.length) {
      playlist = FALLBACK.playlist;
    }

    index = 0;
    playIndex(0);
  }

  async function loadSubtitle() {
    const text = await fetchText('./data/subtitle.txt', FALLBACK.subtitle);
    subtitleEl.textContent = text;
    subCopyEl.textContent  = text;

    // 按字数动态调整速度
    const dur = Math.max(16, Math.min(70, text.length * 0.55));
    document.documentElement.style.setProperty('--ticker-duration', dur + 's');
  }

  async function loadPanels() {
    const data = await fetchJSON('./data/panels.json', FALLBACK.panels);
    const list = Array.isArray(data) ? data : FALLBACK.panels;
    renderPanels(list);
  }

  function renderPanels(panels) {
    panelsEl.innerHTML = '';

    if (!panels || !panels.length) {
      const empty = document.createElement('div');
      empty.className = 'panels-empty';
      empty.textContent = '暂无信息卡';
      panelsEl.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();

    panels.forEach((p) => {
      const card = document.createElement('article');
      card.className = 'panel';

      const title = document.createElement('h3');
      title.className = 'panel-title';
      title.textContent = p.title || '';
      card.appendChild(title);

      (p.rows || []).forEach((row) => {
        const r = document.createElement('div');
        r.className = 'panel-row';

        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = row.label || '';

        const value = document.createElement('span');
        value.className = 'value';
        value.textContent = row.value || '';

        r.appendChild(label);
        r.appendChild(value);
        card.appendChild(r);
      });

      frag.appendChild(card);
    });

    panelsEl.appendChild(frag);
  }

  /* ============================================================
     初始化
     ============================================================ */
  async function init() {
    // 三个并行加载，谁先到谁先渲染
    await Promise.allSettled([
      loadPlaylist(),
      loadSubtitle(),
      loadPanels()
    ]);

    // 每 2 分钟静默刷新字幕
    setInterval(loadSubtitle, 120000);
  }

  // 等 DOM 就绪
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 调试信息
  if (location.protocol === 'file:') {
    console.warn(
      '%c[提示] 当前是 file:// 协议，fetch 会被浏览器拦截。\n' +
      '请用本地 HTTP 服务器打开（如 python -m http.server 8000），或部署到 GitHub Pages。',
      'color:#f87171;font-weight:bold;'
    );
  }

})();