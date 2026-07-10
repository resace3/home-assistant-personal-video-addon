const api = (path) => new URL(path, document.baseURI).toString();
const state = { items: [], settings: {}, tab: 'feed', libraryType: 'daily', selected: 0, mobile: matchMedia('(max-width: 1023px)').matches };

function escapeText(value) {
  const node = document.createElement('span');
  node.textContent = String(value ?? '');
  return node.innerHTML;
}

function asset(item, kind) {
  return api(`api/videos/${encodeURIComponent(item.id)}/${kind}?v=${encodeURIComponent(item.created_at)}`);
}

async function preference(item, field, value) {
  const response = await fetch(api(`api/videos/${encodeURIComponent(item.id)}/preferences`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'PersonalVideoStudio' },
    body: JSON.stringify({ [field]: value }),
  });
  if (!response.ok) throw new Error('Could not save preference');
  Object.assign(item, await response.json());
}

function mediaMarkup(item, index, mobile = false) {
  const autoplay = index === state.selected && state.settings.autoplay;
  return `<div class="media-shell">
    <video class="studio-video" data-index="${index}" ${autoplay ? 'autoplay' : ''} ${state.settings.start_muted ? 'muted' : ''}
      playsinline preload="${Math.abs(index - state.selected) <= 1 ? 'metadata' : 'none'}" poster="${asset(item, 'thumbnail')}"
      aria-label="${escapeText(item.title)}" controls>
      <source src="${asset(item, 'stream')}" type="video/mp4">
      <track kind="captions" src="${asset(item, 'captions')}" srclang="en" label="English">
    </video>
    <button class="play-fallback hidden" data-action="play" data-index="${index}" aria-label="Play ${escapeText(item.title)}">▶ Play</button>
    ${mobile ? `<div class="mobile-actions">
      <button data-action="like" data-index="${index}" aria-pressed="${Boolean(item.liked)}" aria-label="Like video">♥<span>Like</span></button>
      <button data-action="save" data-index="${index}" aria-pressed="${Boolean(item.saved)}" aria-label="Save video">★<span>Save</span></button>
      <button data-action="mute" data-index="${index}" aria-pressed="${state.settings.start_muted}" aria-label="Mute or unmute">◖<span>Sound</span></button>
    </div>` : ''}
  </div>`;
}

function nav(active, mobile) {
  let entries = mobile ? [['feed', 'Feed'], ['library', 'Library'], ['insights', 'Insights'], ['settings', 'Settings']] : [['feed', 'For You'], ['daily', 'Daily Videos'], ['weekly', 'Weekly Videos'], ['library', 'Library'], ['insights', 'Insights'], ['settings', 'Settings']];
  if (!state.settings.enable_insights) entries = entries.filter(([id]) => id !== 'insights');
  return `<nav class="${mobile ? 'bottom-nav' : 'side-nav'}" aria-label="Primary">${entries.map(([id, label]) => `<button data-tab="${id}" class="${active === id ? 'active' : ''}" ${active === id ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav>`;
}

function empty(message = 'No completed videos yet') {
  return `<section class="empty" role="status"><div class="empty-icon">◌</div><h1>${escapeText(message)}</h1><p>Generate a synthetic daily or weekly video, then refresh this page.</p></section>`;
}

function mobileView() {
  let content = '';
  if (state.tab === 'feed') {
    content = state.items.length ? `<main id="main" class="mobile-feed">${state.items.map((item, index) => `<article class="feed-card" data-index="${index}">
      ${mediaMarkup(item, index, true)}
      <div class="caption-scrim"><span class="pill">${item.type}</span><h1>${escapeText(item.title)}</h1><p>${escapeText(item.description)}</p></div>
    </article>`).join('')}</main>` : empty();
  } else if (state.tab === 'library') {
    const filtered = state.items.filter((item) => item.type === state.libraryType);
    content = `<main id="main" class="library"><header><h1>Library</h1><div class="segmented" role="tablist"><button data-library="daily" class="${state.libraryType === 'daily' ? 'active' : ''}" role="tab" aria-selected="${state.libraryType === 'daily'}" tabindex="${state.libraryType === 'daily' ? '0' : '-1'}">Daily Videos</button><button data-library="weekly" class="${state.libraryType === 'weekly' ? 'active' : ''}" role="tab" aria-selected="${state.libraryType === 'weekly'}" tabindex="${state.libraryType === 'weekly' ? '0' : '-1'}">Weekly Videos</button></div></header>${filtered.length ? `<div class="card-grid">${filtered.map(cardMarkup).join('')}</div>` : empty(`No ${state.libraryType} videos yet`)}</main>`;
  } else if (state.tab === 'insights') {
    const daily = state.items.filter((item) => item.type === 'daily').length;
    const weekly = state.items.filter((item) => item.type === 'weekly').length;
    content = `<main id="main" class="panel"><h1>Private Insights</h1><p>These counts come only from browser-safe video metadata.</p><div class="stats"><div><strong>${daily}</strong><span>Daily reflections</span></div><div><strong>${weekly}</strong><span>Weekly reflections</span></div></div></main>`;
  } else {
    content = `<main id="main" class="panel"><h1>Settings</h1><p>Playback preferences stay in this browser or the add-on's private state. Credentials are never sent here.</p><label class="toggle"><input id="mutedSetting" type="checkbox" ${state.settings.start_muted ? 'checked' : ''}> Start videos muted</label><p class="privacy">Sharing is disabled by default because these videos may contain personal information.</p></main>`;
  }
  return `${content}${nav(state.tab, true)}`;
}

function cardMarkup(item) {
  const index = state.items.indexOf(item);
  return `<button class="library-card" data-select="${index}"><img src="${asset(item, 'thumbnail')}" alt=""><span class="pill">${item.type}</span><strong>${escapeText(item.title)}</strong><span>${Math.round(item.duration_seconds)} sec · ${new Date(item.created_at).toLocaleDateString()}</span></button>`;
}

function desktopView() {
  const filtered = state.tab === 'daily' || state.tab === 'weekly' ? state.items.filter((item) => item.type === state.tab) : state.items;
  let body = '';
  if (state.tab === 'feed') {
    const item = state.items[state.selected];
    body = item ? `<main id="main" class="desktop-dashboard"><section class="desktop-player"><div class="eyebrow">FOR YOU · ${item.type.toUpperCase()}</div><h1>${escapeText(item.title)}</h1>${mediaMarkup(item, state.selected)}<p>${escapeText(item.description)}</p><div class="desktop-actions"><button data-action="like" data-index="${state.selected}" aria-pressed="${Boolean(item.liked)}">♥ Like</button><button data-action="save" data-index="${state.selected}" aria-pressed="${Boolean(item.saved)}">★ Save</button></div></section><aside><h2>Recent videos</h2>${state.items.slice(0, 6).map(cardMarkup).join('')}</aside></main>` : empty();
  } else if (['daily', 'weekly', 'library'].includes(state.tab)) {
    body = `<main id="main" class="desktop-library"><header><div class="eyebrow">PRIVATE LIBRARY</div><h1>${state.tab === 'library' ? 'All Videos' : `${state.tab[0].toUpperCase() + state.tab.slice(1)} Videos`}</h1></header>${filtered.length ? `<div class="card-grid">${filtered.map(cardMarkup).join('')}</div>` : empty()}</main>`;
  } else if (state.tab === 'insights') {
    body = `<main id="main" class="panel desktop-panel"><div class="eyebrow">LOCAL METADATA ONLY</div><h1>Insights</h1><div class="stats"><div><strong>${state.items.filter(x => x.type === 'daily').length}</strong><span>Daily videos</span></div><div><strong>${state.items.filter(x => x.type === 'weekly').length}</strong><span>Weekly videos</span></div><div><strong>${state.items.filter(x => x.liked).length}</strong><span>Liked</span></div></div></main>`;
  } else {
    body = `<main id="main" class="panel desktop-panel"><h1>Settings</h1><p>The viewer has read-only access to completed media. Provider credentials and private generation audits stay outside the browser.</p><label class="toggle"><input id="mutedSetting" type="checkbox" ${state.settings.start_muted ? 'checked' : ''}> Start videos muted</label></main>`;
  }
  return `<div class="desktop-shell">${nav(state.tab, false)}${body}</div>`;
}

function render() {
  document.getElementById('app').innerHTML = state.mobile ? mobileView() : desktopView();
  bind();
  if (state.mobile && state.tab === 'feed') {
    const feed = document.querySelector('.mobile-feed');
    if (feed) feed.scrollTop = state.selected * feed.clientHeight;
  }
  coordinatePlayback();
}

function bind() {
  document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => { state.tab = button.dataset.tab; render(); }));
  document.querySelectorAll('[data-library]').forEach((button) => button.addEventListener('click', () => { state.libraryType = button.dataset.library; render(); }));
  document.querySelectorAll('[data-select]').forEach((button) => button.addEventListener('click', () => { state.selected = Number(button.dataset.select); state.tab = 'feed'; render(); }));
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', async () => {
    const index = Number(button.dataset.index);
    const item = state.items[index];
    const video = document.querySelector(`video[data-index="${index}"]`);
    if (button.dataset.action === 'play') await video?.play();
    if (button.dataset.action === 'mute' && video) { video.muted = !video.muted; button.setAttribute('aria-pressed', String(video.muted)); }
    try {
      if (button.dataset.action === 'like') { await preference(item, 'liked', !item.liked); button.setAttribute('aria-pressed', String(Boolean(item.liked))); }
      if (button.dataset.action === 'save') { await preference(item, 'saved', !item.saved); button.setAttribute('aria-pressed', String(Boolean(item.saved))); }
    } catch (error) {
      button.title = error.message;
      button.setAttribute('aria-label', `${button.getAttribute('aria-label') || 'Preference'} unavailable`);
    }
  }));
  const mutedSetting = document.getElementById('mutedSetting');
  mutedSetting?.addEventListener('change', () => { state.settings.start_muted = mutedSetting.checked; localStorage.setItem('personal-video-studio:v1:start-muted', String(mutedSetting.checked)); });
  document.querySelectorAll('video').forEach((video) => {
    const persistProgress = () => {
      const item = state.items[Number(video.dataset.index)];
      if (item && Number.isFinite(video.currentTime)) preference(item, 'watched_seconds', Math.min(video.currentTime, 120)).catch(() => {});
    };
    video.addEventListener('pause', persistProgress);
    video.addEventListener('ended', persistProgress);
  });
}

function tryPlay(video) {
  if (!video) return;
  document.querySelectorAll('video').forEach((other) => { if (other !== video) other.pause(); });
  video.muted = state.settings.start_muted;
  const promise = video.play();
  if (promise) promise.catch(() => video.parentElement.querySelector('.play-fallback')?.classList.remove('hidden'));
}

function coordinatePlayback() {
  const videos = [...document.querySelectorAll('video')];
  if (!state.settings.autoplay) return;
  if (!state.mobile) { tryPlay(videos[0]); return; }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const video = entry.target.querySelector('video');
      if (entry.isIntersecting && entry.intersectionRatio >= 0.7) {
        state.selected = Number(entry.target.dataset.index);
        video.preload = 'auto';
        tryPlay(video);
      } else video?.pause();
    }
  }, { root: document.querySelector('.mobile-feed'), threshold: [0.2, 0.7] });
  document.querySelectorAll('.feed-card').forEach((card) => observer.observe(card));
}

document.addEventListener('visibilitychange', () => { if (document.hidden) document.querySelectorAll('video').forEach((video) => video.pause()); });
matchMedia('(max-width: 1023px)').addEventListener('change', (event) => { state.mobile = event.matches; render(); });

async function boot() {
  try {
    const [videosResponse, settingsResponse] = await Promise.all([fetch(api('api/videos?page_size=50')), fetch(api('api/settings'))]);
    if (!videosResponse.ok || !settingsResponse.ok) throw new Error('The private library could not be loaded.');
    const payload = await videosResponse.json();
    state.settings = await settingsResponse.json();
    state.items = payload.items.filter((item) => (item.type === 'daily' && state.settings.show_daily_videos) || (item.type === 'weekly' && state.settings.show_weekly_videos));
    state.tab = state.settings.default_tab || 'feed';
    const localMuted = localStorage.getItem('personal-video-studio:v1:start-muted');
    if (localMuted !== null) state.settings.start_muted = localMuted === 'true';
    render();
  } catch (error) {
    document.getElementById('app').innerHTML = `<section class="empty error" role="alert"><h1>Videos are temporarily unavailable</h1><p>${escapeText(error.message)}</p><button id="retryButton">Try again</button></section>`;
    document.getElementById('retryButton')?.addEventListener('click', () => location.reload());
  }
}

boot();
