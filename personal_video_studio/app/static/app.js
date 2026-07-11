const viewportQuery = matchMedia('(max-width: 1023px)');
const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const state = {
  items: [],
  settings: {},
  catalog: { state: 'empty', usable: 0, expected_index: '/share/personal_video_studio/indexes/all.json' },
  total: 0,
  tab: 'feed',
  libraryType: 'daily',
  selected: 0,
  mobile: viewportQuery.matches,
};
let playbackObserver = null;

function api(path) {
  const relativePath = String(path).replace(/^\/+/, '');
  return new URL(relativePath, document.baseURI).toString();
}

function escapeText(value) {
  const node = document.createElement('span');
  node.textContent = String(value ?? '');
  return node.innerHTML;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function mediaType(item) {
  return String(item.video_filename || '').toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4';
}

function asset(item, kind) {
  return api(`api/videos/${encodeURIComponent(item.id)}/${kind}?v=${encodeURIComponent(item.created_at)}`);
}

async function preference(item, field, value) {
  const response = await fetch(api(`api/videos/${encodeURIComponent(item.id)}/preferences`), {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'PersonalVideoStudio' },
    body: JSON.stringify({ [field]: value }),
  });
  if (!response.ok) throw new Error('Could not save preference');
  Object.assign(item, await response.json());
}

function mediaMarkup(item, index, mobile = false) {
  const autoplay = index === state.selected && state.settings.autoplay && !reducedMotionQuery.matches;
  const muted = Boolean(state.settings.start_muted);
  return `<div class="media-shell">
    <video class="studio-video" data-index="${index}" ${autoplay ? 'autoplay' : ''} ${muted ? 'muted' : ''}
      playsinline preload="${Math.abs(index - state.selected) <= 1 ? 'metadata' : 'none'}" poster="${asset(item, 'thumbnail')}"
      aria-label="${escapeText(item.title)}" controls>
      <source src="${asset(item, 'stream')}" type="${mediaType(item)}">
      <track kind="captions" src="${asset(item, 'captions')}" srclang="en" label="English">
    </video>
    <button type="button" class="play-fallback hidden" data-action="play" data-index="${index}" aria-label="Play ${escapeText(item.title)}">▶ Play</button>
    ${mobile ? `<div class="mobile-actions" role="group" aria-label="Video actions">
      <button type="button" data-action="like" data-index="${index}" aria-pressed="${Boolean(item.liked)}" aria-label="Like video"><span aria-hidden="true">♥</span><span class="action-label">Like</span></button>
      <button type="button" data-action="save" data-index="${index}" aria-pressed="${Boolean(item.saved)}" aria-label="Save video"><span aria-hidden="true">★</span><span class="action-label">Save</span></button>
      <button type="button" data-action="mute" data-index="${index}" aria-pressed="${muted}" aria-label="${muted ? 'Unmute video' : 'Mute video'}"><span aria-hidden="true">◖</span><span class="action-label">${muted ? 'Sound off' : 'Sound on'}</span></button>
    </div>` : ''}
  </div>`;
}

function nav(active, mobile) {
  let entries = mobile
    ? [['feed', 'Feed'], ['library', 'Library'], ['insights', 'Insights'], ['settings', 'Settings']]
    : [['feed', 'For You'], ['daily', 'Daily Videos'], ['weekly', 'Weekly Videos'], ['library', 'Library'], ['insights', 'Insights'], ['settings', 'Settings']];
  if (!state.settings.enable_insights) entries = entries.filter(([id]) => id !== 'insights');
  return `<nav class="${mobile ? 'bottom-nav' : 'side-nav'}" aria-label="Primary">${entries.map(([id, label]) => `<button type="button" data-tab="${id}" class="${active === id ? 'active' : ''}" ${active === id ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav>`;
}

function catalogEmptyCopy() {
  if (state.total > 0 && state.items.length === 0) {
    return {
      heading: 'Videos are hidden by settings',
      detail: 'Enable daily or weekly videos in the add-on configuration, then refresh this library.',
    };
  }
  const messages = {
    media_root_missing: {
      heading: 'Video storage is not mounted',
      detail: 'This app reads /share/personal_video_studio. The path /shared is different and is not used by Home Assistant.',
    },
    index_missing: {
      heading: 'Video index not found',
      detail: 'Run the Personal Video runner with /share/personal_video_studio as its output, then rebuild the index.',
    },
    index_invalid: {
      heading: 'Video index needs rebuilding',
      detail: 'The index could not be read safely. Run the runner’s rebuild-index command and refresh.',
    },
    index_too_large: {
      heading: 'Video index is too large',
      detail: 'Reduce or rebuild indexes/all.json before refreshing this private library.',
    },
    no_usable_entries: {
      heading: 'Completed video files are unavailable',
      detail: 'The index has no entry with a readable MP4 or WebM, thumbnail, and captions file. Rebuild it after generation finishes.',
    },
    empty: {
      heading: 'No completed videos yet',
      detail: 'Generate a daily or weekly video with the runner, then refresh this page.',
    },
  };
  return messages[state.catalog.state] || messages.empty;
}

function empty(heading, detail) {
  return `<section class="empty" role="status"><div class="empty-icon" aria-hidden="true">○</div><h1>${escapeText(heading)}</h1><p>${escapeText(detail)}</p><button type="button" data-refresh>Refresh library</button></section>`;
}

function catalogEmpty() {
  const copy = catalogEmptyCopy();
  return empty(copy.heading, copy.detail);
}

function statusRegion() {
  return '<div id="statusMessage" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>';
}

function mobileView() {
  let content = '';
  if (state.tab === 'feed') {
    content = state.items.length ? `<main id="main" class="mobile-feed">${state.items.map((item, index) => `<article class="feed-card" data-index="${index}">
      ${mediaMarkup(item, index, true)}
      <div class="caption-scrim"><span class="pill">${item.type}</span><h1>${escapeText(item.title)}</h1><p>${escapeText(item.description)}</p></div>
    </article>`).join('')}</main>` : `<main id="main">${catalogEmpty()}</main>`;
  } else if (state.tab === 'library') {
    const filtered = state.items.filter((item) => item.type === state.libraryType);
    const periodCopy = state.items.length ? {
      heading: `No ${state.libraryType} videos yet`,
      detail: `Generate a ${state.libraryType} video with the runner, then refresh this page.`,
    } : catalogEmptyCopy();
    content = `<main id="main" class="library"><header><h1>Library</h1><div class="segmented" role="group" aria-label="Video period"><button type="button" data-library="daily" class="${state.libraryType === 'daily' ? 'active' : ''}" aria-pressed="${state.libraryType === 'daily'}">Daily Videos</button><button type="button" data-library="weekly" class="${state.libraryType === 'weekly' ? 'active' : ''}" aria-pressed="${state.libraryType === 'weekly'}">Weekly Videos</button></div></header>${filtered.length ? `<div class="card-grid">${filtered.map(cardMarkup).join('')}</div>` : empty(periodCopy.heading, periodCopy.detail)}</main>`;
  } else if (state.tab === 'insights') {
    const daily = state.items.filter((item) => item.type === 'daily').length;
    const weekly = state.items.filter((item) => item.type === 'weekly').length;
    content = `<main id="main" class="panel"><h1>Private Insights</h1><p>These counts come only from browser-safe video metadata.</p><div class="stats"><div><strong>${daily}</strong><span>Daily reflections</span></div><div><strong>${weekly}</strong><span>Weekly reflections</span></div></div></main>`;
  } else {
    content = settingsMarkup(false);
  }
  return `${content}${nav(state.tab, true)}${statusRegion()}`;
}

function cardMarkup(item) {
  const index = state.items.indexOf(item);
  const title = escapeText(item.title);
  const date = formatDate(item.created_at);
  const duration = Math.max(0, Math.round(Number(item.duration_seconds) || 0));
  return `<button type="button" class="library-card" data-select="${index}" aria-label="Open ${title}, ${item.type}, ${escapeText(date)}"><img src="${asset(item, 'thumbnail')}" alt="" loading="lazy" decoding="async"><span class="pill">${item.type}</span><strong>${title}</strong><span>${duration} sec · ${escapeText(date)}</span></button>`;
}

function catalogStatusMarkup() {
  const labels = {
    ready: 'Ready',
    partial: 'Partially available',
    empty: 'Waiting for videos',
    media_root_missing: 'Storage not mounted',
    index_missing: 'Index missing',
    index_invalid: 'Index invalid',
    index_too_large: 'Index too large',
    no_usable_entries: 'Files unavailable',
  };
  const label = labels[state.catalog.state] || 'Unavailable';
  const expected = state.catalog.expected_index || '/share/personal_video_studio/indexes/all.json';
  return `<section class="diagnostic" aria-labelledby="libraryStatusHeading"><h2 id="libraryStatusHeading">Library status</h2><p><strong>${escapeText(label)}</strong> · ${Number(state.catalog.usable) || 0} usable video(s)</p><p>Expected index: <code>${escapeText(expected)}</code></p><p><code>/shared</code> is not an alias for <code>/share</code>.</p><button type="button" data-refresh>Refresh library</button></section>`;
}

function settingsMarkup(desktop) {
  const classes = desktop ? 'panel desktop-panel' : 'panel';
  return `<main id="main" class="${classes}"><h1>Settings</h1><p>Playback choices stay in this browser. Credentials are never sent to this viewer.</p>
    <div class="settings-stack">
      <label class="toggle"><input id="autoplaySetting" type="checkbox" ${state.settings.autoplay ? 'checked' : ''}> Autoplay the visible video when allowed</label>
      <label class="toggle"><input id="mutedSetting" type="checkbox" ${state.settings.start_muted ? 'checked' : ''}> Start videos muted</label>
    </div>
    <p class="privacy">Sharing is disabled because these videos may contain personal information. Reduced-motion system settings also suppress autoplay.</p>
    ${catalogStatusMarkup()}
  </main>`;
}

function desktopView() {
  const filtered = state.tab === 'daily' || state.tab === 'weekly' ? state.items.filter((item) => item.type === state.tab) : state.items;
  let body = '';
  if (state.tab === 'feed') {
    const item = state.items[state.selected];
    body = item ? `<main id="main" class="desktop-dashboard"><section class="desktop-player"><div class="eyebrow">FOR YOU · ${item.type.toUpperCase()}</div><h1>${escapeText(item.title)}</h1>${mediaMarkup(item, state.selected)}<p>${escapeText(item.description)}</p><div class="desktop-actions"><button type="button" data-action="like" data-index="${state.selected}" aria-pressed="${Boolean(item.liked)}">♥ Like</button><button type="button" data-action="save" data-index="${state.selected}" aria-pressed="${Boolean(item.saved)}">★ Save</button></div></section><aside><h2>Recent videos</h2>${state.items.slice(0, 6).map(cardMarkup).join('')}</aside></main>` : `<main id="main">${catalogEmpty()}</main>`;
  } else if (['daily', 'weekly', 'library'].includes(state.tab)) {
    const heading = state.tab === 'library' ? 'All Videos' : `${state.tab[0].toUpperCase() + state.tab.slice(1)} Videos`;
    const copy = state.tab === 'library' || state.items.length === 0 ? catalogEmptyCopy() : {
      heading: `No ${state.tab} videos yet`,
      detail: `Generate a ${state.tab} video with the runner, then refresh this page.`,
    };
    body = `<main id="main" class="desktop-library"><header><div class="eyebrow">PRIVATE LIBRARY</div><h1>${heading}</h1></header>${filtered.length ? `<div class="card-grid">${filtered.map(cardMarkup).join('')}</div>` : empty(copy.heading, copy.detail)}</main>`;
  } else if (state.tab === 'insights') {
    body = `<main id="main" class="panel desktop-panel"><div class="eyebrow">LOCAL METADATA ONLY</div><h1>Insights</h1><div class="stats"><div><strong>${state.items.filter((item) => item.type === 'daily').length}</strong><span>Daily videos</span></div><div><strong>${state.items.filter((item) => item.type === 'weekly').length}</strong><span>Weekly videos</span></div><div><strong>${state.items.filter((item) => item.liked).length}</strong><span>Liked</span></div></div></main>`;
  } else {
    body = settingsMarkup(true);
  }
  return `<div class="desktop-shell">${nav(state.tab, false)}${body}</div>${statusRegion()}`;
}

function stopPlayback() {
  playbackObserver?.disconnect();
  playbackObserver = null;
  document.querySelectorAll('video').forEach((video) => video.pause());
}

function render() {
  stopPlayback();
  document.getElementById('app').innerHTML = state.mobile ? mobileView() : desktopView();
  bind();
  if (state.mobile && state.tab === 'feed') {
    const feed = document.querySelector('.mobile-feed');
    if (feed) feed.scrollTop = state.selected * feed.clientHeight;
  }
  coordinatePlayback();
}

function announce(message) {
  const region = document.getElementById('statusMessage');
  if (region) region.textContent = message;
}

function syncMuteButton(video) {
  const button = document.querySelector(`[data-action="mute"][data-index="${video.dataset.index}"]`);
  if (!button) return;
  button.setAttribute('aria-pressed', String(video.muted));
  button.setAttribute('aria-label', video.muted ? 'Unmute video' : 'Mute video');
  const label = button.querySelector('.action-label');
  if (label) label.textContent = video.muted ? 'Sound off' : 'Sound on';
}

async function playVideo(video, userInitiated = false) {
  if (!video) return false;
  document.querySelectorAll('video').forEach((other) => { if (other !== video) other.pause(); });
  if (!userInitiated) video.muted = Boolean(state.settings.start_muted);
  syncMuteButton(video);
  try {
    await video.play();
    video.parentElement.querySelector('.play-fallback')?.classList.add('hidden');
    return true;
  } catch {
    video.parentElement.querySelector('.play-fallback')?.classList.remove('hidden');
    return false;
  }
}

function bind() {
  document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => {
    state.tab = button.dataset.tab;
    render();
  }));
  document.querySelectorAll('[data-library]').forEach((button) => button.addEventListener('click', () => {
    state.libraryType = button.dataset.library;
    render();
  }));
  document.querySelectorAll('[data-select]').forEach((button) => button.addEventListener('click', () => {
    state.selected = Number(button.dataset.select);
    state.tab = 'feed';
    render();
  }));
  document.querySelectorAll('[data-refresh]').forEach((button) => button.addEventListener('click', () => { void boot(true); }));
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', async () => {
    const index = Number(button.dataset.index);
    const item = state.items[index];
    const video = document.querySelector(`video[data-index="${index}"]`);
    if (button.dataset.action === 'play') {
      await playVideo(video, true);
      return;
    }
    if (button.dataset.action === 'mute' && video) {
      video.muted = !video.muted;
      syncMuteButton(video);
      announce(video.muted ? 'Video muted' : 'Video unmuted');
      return;
    }
    if (!item) return;
    try {
      if (button.dataset.action === 'like') {
        await preference(item, 'liked', !item.liked);
        button.setAttribute('aria-pressed', String(Boolean(item.liked)));
        announce(item.liked ? 'Video liked' : 'Video removed from likes');
      }
      if (button.dataset.action === 'save') {
        await preference(item, 'saved', !item.saved);
        button.setAttribute('aria-pressed', String(Boolean(item.saved)));
        announce(item.saved ? 'Video saved' : 'Video removed from saved items');
      }
    } catch (error) {
      button.title = error.message;
      announce(error.message);
    }
  }));
  const autoplaySetting = document.getElementById('autoplaySetting');
  autoplaySetting?.addEventListener('change', () => {
    state.settings.autoplay = autoplaySetting.checked;
    localStorage.setItem('personal-video-studio:v1:autoplay', String(autoplaySetting.checked));
    if (autoplaySetting.checked) coordinatePlayback();
    else stopPlayback();
    announce(autoplaySetting.checked ? 'Autoplay enabled' : 'Autoplay disabled');
  });
  const mutedSetting = document.getElementById('mutedSetting');
  mutedSetting?.addEventListener('change', () => {
    state.settings.start_muted = mutedSetting.checked;
    localStorage.setItem('personal-video-studio:v1:start-muted', String(mutedSetting.checked));
    document.querySelectorAll('video').forEach((video) => {
      video.muted = mutedSetting.checked;
      syncMuteButton(video);
    });
    announce(mutedSetting.checked ? 'Videos will start muted' : 'Videos may start with sound');
  });
  document.querySelectorAll('video').forEach((video) => {
    const item = state.items[Number(video.dataset.index)];
    const persistProgress = () => {
      if (item && Number.isFinite(video.currentTime)) preference(item, 'watched_seconds', Math.min(video.currentTime, 120)).catch(() => {});
    };
    video.addEventListener('pause', persistProgress);
    video.addEventListener('ended', persistProgress);
    video.addEventListener('volumechange', () => syncMuteButton(video));
    video.addEventListener('loadedmetadata', () => {
      const watched = Number(item?.watched_seconds);
      if (Number.isFinite(watched) && watched > 0 && watched < video.duration - 3) video.currentTime = watched;
    }, { once: true });
  });
}

function coordinatePlayback() {
  playbackObserver?.disconnect();
  playbackObserver = null;
  if (!state.settings.autoplay || reducedMotionQuery.matches) return;
  const videos = [...document.querySelectorAll('video')];
  if (!state.mobile) {
    void playVideo(videos[0]);
    return;
  }
  const feed = document.querySelector('.mobile-feed');
  if (!feed) return;
  playbackObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const video = entry.target.querySelector('video');
      if (entry.isIntersecting && entry.intersectionRatio >= 0.7) {
        state.selected = Number(entry.target.dataset.index);
        video.preload = 'auto';
        void playVideo(video);
      } else {
        video?.pause();
      }
    }
  }, { root: feed, threshold: [0.2, 0.7] });
  document.querySelectorAll('.feed-card').forEach((card) => playbackObserver.observe(card));
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) document.querySelectorAll('video').forEach((video) => video.pause());
});
viewportQuery.addEventListener('change', (event) => {
  state.mobile = event.matches;
  render();
});
reducedMotionQuery.addEventListener('change', () => render());

async function boot(showLoading = false) {
  stopPlayback();
  if (showLoading) {
    document.getElementById('app').innerHTML = '<div class="loading" role="status" aria-live="polite">Refreshing your private video library…</div>';
  }
  try {
    const requestOptions = { cache: 'no-store', credentials: 'same-origin' };
    const [videosResponse, settingsResponse] = await Promise.all([
      fetch(api('api/videos?page_size=50'), requestOptions),
      fetch(api('api/settings'), requestOptions),
    ]);
    if (!videosResponse.ok || !settingsResponse.ok) throw new Error('The private library could not be loaded.');
    const payload = await videosResponse.json();
    state.settings = await settingsResponse.json();
    state.catalog = payload.catalog || state.catalog;
    state.total = Number(payload.total) || 0;
    const items = Array.isArray(payload.items) ? payload.items : [];
    state.items = items.filter((item) => (item.type === 'daily' && state.settings.show_daily_videos) || (item.type === 'weekly' && state.settings.show_weekly_videos));
    state.tab = state.settings.default_tab || 'feed';
    if (state.tab === 'insights' && !state.settings.enable_insights) state.tab = 'feed';
    state.selected = Math.min(state.selected, Math.max(0, state.items.length - 1));
    const localMuted = localStorage.getItem('personal-video-studio:v1:start-muted');
    if (localMuted !== null) state.settings.start_muted = localMuted === 'true';
    const localAutoplay = localStorage.getItem('personal-video-studio:v1:autoplay');
    if (localAutoplay !== null) state.settings.autoplay = localAutoplay === 'true';
    render();
  } catch (error) {
    document.getElementById('app').innerHTML = `<section class="empty error" role="alert"><h1>Videos are temporarily unavailable</h1><p>${escapeText(error.message)}</p><button type="button" id="retryButton">Try again</button></section>`;
    document.getElementById('retryButton')?.addEventListener('click', () => { void boot(true); });
  }
}

void boot();
