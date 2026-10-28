/* ============================================================
   SCANE — Premium Streaming Platform v3.0
   Hash-based SPA Router + Full-Page Player (NO OVERLAY = NO BLACK SCREEN)
   Rutube Live Search | Subtitle Offset Control | Series Grouping Fix
   ============================================================ */
'use strict';

// ============================================================
// STATE
// ============================================================
const STATE = {
  watchlist: [],
  watchHistory: {},      // {id: {pos, dur, ts}}
  subtitlesEnabled: true,
  subtitleOffset: 0,     // seconds offset (+/-)
  volume: 1.0,
  muted: false,
  speed: 1.0,
  isLocked: false,
  controlsTimer: null,
  // Player
  hlsInstance: null,
  currentItem: null,
  currentEpisodes: [],
  currentEpIndex: -1,
  nextEpisodeData: null,
  nextEpTimer: null,
  // Browse
  browse: { page:1, loading:false, done:false, cat:'all', genre:'', q:'', sort:'default' },
  browseObserver: null,
  searchTimer: null,
  // Subtitle cue adjustment
  subTrackAdjusted: false,
};

// ============================================================
// ROUTER
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  loadPersistedState();
  initNavbar();
  initSearch();
  initWatchlistBadge();
  updateNavProfile();
  applySubSize();
  window.addEventListener('hashchange', route);
  route();
});

function route() {
  const raw = window.location.hash.replace('#', '') || 'home';
  const [pathStr, qs] = raw.split('?');
  const parts = pathStr.split('/');
  const params = parseQS(qs || '');

  // Highlight active nav
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const al = document.querySelector(`.nav-link[href="#${parts[0]}"]`);
  if (al) al.classList.add('active');

  switch (parts[0]) {
    case 'home': case '': renderHome(); break;
    case 'movie':         renderMoviePage(parts[1]); break;
    case 'show':          renderShowPage(parts[1]); break;
    case 'player':        renderPlayerPage(parts[1], params); break;
    case 'browse':        renderBrowsePage(params); break;
    case 'learn':         renderLearnPage(params); break;
    case 'actor':         renderActorPage(parts[1]); break;
    case 'hub':           renderCollectionHubPage(parts[1]); break;
    case 'profile':       renderProfilePage(); break;
    default:              renderHome();
  }
}

function navigate(hash) {
  window.location.hash = hash;
  window.scrollTo({top:0,behavior:'instant'});
}

function parseQS(str) {
  const p = {};
  if (!str) return p;
  str.split('&').forEach(x => { const [k,v] = x.split('='); if (k) p[k] = decodeURIComponent(v||''); });
  return p;
}

// ============================================================
// NAVBAR
// ============================================================
function initNavbar() {
  window.addEventListener('scroll', () => {
    document.getElementById('navbar').classList.toggle('scrolled', window.scrollY > 30);
  });
}
function toggleMobileMenu() { document.getElementById('mobileNavPanel').classList.toggle('open'); }
function closeMobileMenu() { document.getElementById('mobileNavPanel').classList.remove('open'); }

// ============================================================
// SEARCH OVERLAY (floating, Voice Search + Trending Quick Chips)
// ============================================================
function toggleSearchOverlay() {
  const ov = document.getElementById('searchOverlay');
  const si = document.getElementById('searchInput');
  ov.classList.toggle('open');
  if (ov.classList.contains('open')) {
    si.value = '';
    si.focus();
    renderDefaultSearchChips();
  }
}

function renderDefaultSearchChips() {
  const drop = document.getElementById('searchResultsDropdown');
  if (!drop) return;
  const trending = ['Breaking Bad', 'Fallout', 'Avatar', 'Spider-Man', 'Oppenheimer', 'Stranger Things', 'Interstellar', 'The Batman'];
  drop.innerHTML = `
    <div style="padding:14px 18px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-m);margin-bottom:10px">
        <i class="fa-solid fa-fire" style="color:var(--red)"></i> Trending Searches
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${trending.map(t => `
          <button class="se-cat-pill" style="padding:6px 13px;font-size:12.5px" onclick="document.getElementById('searchInput').value='${esc(t)}';liveSearch('${esc(t)}')">
            <i class="fa-solid fa-magnifying-glass" style="font-size:10px;opacity:.7"></i> ${esc(t)}
          </button>
        `).join('')}
      </div>
    </div>
  `;
  drop.classList.add('has-results');
}

function clearSearch() {
  const si = document.getElementById('searchInput');
  si.value = '';
  document.getElementById('searchClearBtn').classList.remove('visible');
  renderDefaultSearchChips();
  si.focus();
}

function startVoiceSearch() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = document.getElementById('searchMicBtn');
  const si = document.getElementById('searchInput');
  if (!SpeechRec) {
    showToast('🎙️ Voice search is not supported in this browser');
    return;
  }
  try {
    const rec = new SpeechRec();
    rec.lang = 'en-US';
    rec.interimResults = false;
    if (btn) btn.classList.add('listening');
    showToast('🎙️ Speak a movie or series title...');
    rec.onresult = (ev) => {
      if (btn) btn.classList.remove('listening');
      const spoken = (ev.results?.[0]?.[0]?.transcript || '').trim();
      if (spoken && si) {
        si.value = spoken;
        document.getElementById('searchClearBtn')?.classList.add('visible');
        liveSearch(spoken);
      }
    };
    rec.onerror = () => { if (btn) btn.classList.remove('listening'); };
    rec.onend = () => { if (btn) btn.classList.remove('listening'); };
    rec.start();
  } catch (e) {}
}

function initSearch() {
  const si = document.getElementById('searchInput');
  si.addEventListener('input', e => {
    const q = e.target.value.trim();
    document.getElementById('searchClearBtn').classList.toggle('visible', q.length > 0);
    clearTimeout(STATE.searchTimer);
    if (!q) { renderDefaultSearchChips(); return; }
    STATE.searchTimer = setTimeout(() => liveSearch(q), 320);
  });
  si.addEventListener('keydown', e => {
    if (e.key === 'Escape') toggleSearchOverlay();
    if (e.key === 'Enter') {
      const q = si.value.trim();
      if (q) { toggleSearchOverlay(); navigate(`browse?q=${encodeURIComponent(q)}`); }
    }
  });
}

async function liveSearch(q) {
  const drop = document.getElementById('searchResultsDropdown');
  drop.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-m)"><i class="fa-solid fa-circle-notch fa-spin"></i> Searching library & online catalog...</div>`;
  drop.classList.add('has-results');
  try {
    const [data, rt] = await Promise.all([
      api(`/api/search?q=${encodeURIComponent(q)}`),
      api(`/api/online-search?q=${encodeURIComponent(q)}`).catch(() => ({ items: [] }))
    ]);
    const items = data.items || [];
    const onlineItems = (rt.items || []).filter(o => !o.in_library && !items.some(l => String(l.tmdb_id) === String(o.tmdb_id)));

    renderSearchDrop(q, items.slice(0, 6), onlineItems.slice(0, 8), data.total || items.length);
  } catch(e) {
    drop.innerHTML = `<div class="search-no-results">Search error. Try again.</div>`;
  }
}

function renderSearchDrop(q, items, onlineItems, total) {
  const drop = document.getElementById('searchResultsDropdown');
  if (!items.length && !onlineItems.length) {
    drop.innerHTML = `<div class="search-no-results">
      <i class="fa-solid fa-face-frown" style="display:block;font-size:32px;margin-bottom:10px;opacity:0.3"></i>
      No results for "<strong>${esc(q)}</strong>"
    </div>`;
    return;
  }
  let html = '';
  if (items.length) {
    html += `<div style="padding:8px 16px;font-size:10px;color:var(--green);letter-spacing:0.6px;text-transform:uppercase;font-weight:700"><i class="fa-solid fa-circle-check"></i> Verified in Library</div>`;
    html += items.map(it => `
      <div class="search-result-item" onclick="srClick('${esc(it.id)}',${!!it.is_series},false)">
        <img class="search-result-poster" src="${esc(it.poster||'')}" alt="" onerror="this.style.display='none'">
        <div class="search-result-info">
          <div class="search-result-title">${esc(it.title)}</div>
          <div class="search-result-meta">${it.year||''} ${it.rating?`· ⭐ ${Number(it.rating).toFixed(1)}`:''} ${(it.genres||[]).slice(0,2).join(' · ')}</div>
        </div>
        <span class="search-result-badge ${it.is_series?'series':'movie'}">${it.is_series?'SERIES':'MOVIE'}</span>
      </div>
    `).join('');
  }
  if (onlineItems.length) {
    html += `<div style="padding:8px 16px;font-size:10px;color:var(--text-m);letter-spacing:0.6px;text-transform:uppercase;font-weight:700;border-top:1px solid var(--border)"><i class="fa-solid fa-cloud-arrow-down"></i> Search Online (Auto-Verify English Original)</div>`;
    html += onlineItems.map(it => `
      <div class="search-result-item" id="sro_${it.type}_${it.tmdb_id}" onclick="srResolveOnline('${it.type}',${it.tmdb_id},'${esc(it.title)}')">
        <img class="search-result-poster" src="${esc(it.poster||'')}" alt="" onerror="this.style.display='none'">
        <div class="search-result-info">
          <div class="search-result-title">${esc(it.title)}</div>
          <div class="search-result-meta">${it.year||''} ${it.rating?`· ⭐ ${Number(it.rating).toFixed(1)}`:''} · <span class="sro-status" style="color:#60a5fa">Click to verify & play</span></div>
        </div>
        <span class="search-result-badge ${it.is_series?'series':'movie'}">${it.is_series?'SERIES':'MOVIE'}</span>
      </div>
    `).join('');
  }
  if (total > items.length) {
    html += `<div class="search-see-all" onclick="srSeeAll('${esc(q)}')">
      <i class="fa-solid fa-magnifying-glass"></i> See all ${total} library results <i class="fa-solid fa-arrow-right"></i>
    </div>`;
  }
  drop.innerHTML = html;
  drop.classList.add('has-results');
}

async function srResolveOnline(type, tmdbId, title) {
  const row = document.getElementById(`sro_${type}_${tmdbId}`);
  const st = row ? row.querySelector('.sro-status') : null;
  if (st) { st.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Verifying exact English release...`; st.style.color = 'var(--gold)'; }
  showToast(`🔍 Searching verified English stream for "${title}"...`);
  try {
    const res = await api(`/api/resolve?type=${encodeURIComponent(type)}&tmdb_id=${encodeURIComponent(tmdbId)}`);
    if (res && res.found && res.id) {
      showToast(`✓ Verified! Opening "${title}"`);
      toggleSearchOverlay();
      if (res.is_series) navigate(`show/${res.id}`);
      else navigate(`movie/${res.id}`);
    } else {
      if (st) { st.textContent = 'Not available in English original'; st.style.color = 'var(--red)'; }
      showToast(`❌ Exact English original for "${title}" was not found`);
    }
  } catch(e) {
    if (st) { st.textContent = 'Verification failed'; st.style.color = 'var(--red)'; }
    showToast(`❌ Could not verify "${title}"`);
  }
}

function srClick(id, isSeries, rutubeOnly) {
  toggleSearchOverlay();
  if (isSeries) navigate(`show/${id}`);
  else navigate(`movie/${id}`);
}
function srSeeAll(q) { toggleSearchOverlay(); navigate(`browse?q=${encodeURIComponent(q)}`); }

// ============================================================
// HOME PAGE
// ============================================================
async function renderHome() {
  document.title = 'SCANE — Stream Movies & TV Series';
  setMain(`<div class="page-loading-spinner"><div class="spinner-ring-lg"></div></div>`);
  try {
    const [sec, feat] = await Promise.all([api('/api/sections'), api('/api/featured')]);
    const kidsFilter = m => !STATE.kidsMode || ((m.genres||[]).some(g=>/animation|family|comedy|adventure|fantasy/i.test(g)) && !(m.genres||[]).some(g=>/horror|crime|thriller/i.test(g)));
    const trending = (sec.trending || []).filter(kidsFilter);
    const hero = trending[0] || (sec.trending||[])[0] || {};
    const top10 = [...(sec.topRated||[]), ...(sec.trending||[])].filter(kidsFilter).slice(0, 10);

    // Build continue-watching section from history
    const histItems = Object.entries(STATE.watchHistory)
      .filter(([,v]) => v.pos > 10 && v.pos/v.dur < 0.95)
      .sort((a,b) => b[1].ts - a[1].ts)
      .slice(0,8)
      .map(([id,v]) => ({...v, id}));

    setMain(`<div class="home-page">
      ${buildHero(hero, trending)}
      ${buildCoverflow((feat.featured||[]).filter(kidsFilter))}
      <div class="sections-wrapper">
        ${buildCollectionsHubRow()}
        ${histItems.length ? buildContinueWatchingSection(histItems) : ''}
        ${buildTop10Section(top10)}
        ${buildSection('🔥 Trending <span>Now</span>', trending, 'popular')}
        ${buildSection('✨ New <span>Releases</span>', (sec.newReleases||[]).filter(kidsFilter), 'new')}
        ${buildSection('📺 Popular <span>TV Series</span>', (sec.tvSeries||[]).filter(kidsFilter), 'series')}
        ${buildSection('🎯 Recommended <span>For You</span>', (sec.recommended||[]).filter(kidsFilter), 'rec')}
        ${buildSection('⭐ Top <span>Rated</span>', (sec.topRated||[]).filter(kidsFilter), 'top')}
      </div>
      ${buildFooter()}
    </div>`);

    initHeroStrip(trending, hero);
    initCoverflow(feat.featured||[]);
    loadContinueWatchingPosters(histItems);

  } catch(err) {
    setMain(`<div style="text-align:center;padding:80px;color:#64748b">
      <i class="fa-solid fa-triangle-exclamation" style="font-size:48px;margin-bottom:16px"></i>
      <p>Failed to connect to server. Please try again.</p>
      <button class="btn-red" style="margin-top:20px" onclick="renderHome()">Retry</button>
    </div>`);
  }
}

function buildHero(hero, all) {
  return `<section class="hero">
    <div class="hero-bg" id="heroBg" style="background-image:url('${esc(hero.backdrop||hero.poster||'')}')"></div>
    <div class="hero-content">
      <div class="hero-pill"><i class="fa-solid fa-fire"></i> Featured</div>
      <h1 class="hero-title" id="heroTitle">${esc(hero.title||'')} ${hero.year?`(${hero.year})`:''}</h1>
      <p class="hero-synopsis" id="heroSynopsis">${esc(hero.overview||'')}</p>
      <div class="hero-meta" id="heroMeta">${heroMeta(hero)}</div>
      <div class="hero-btns" id="heroBtns">${heroBtns(hero)}</div>
    </div>
  </section>
  <div class="hero-strip-wrap">
    <div class="hero-strip" id="heroStrip"></div>
    <div class="strip-arrows">
      <button aria-label="Previous" onclick="document.getElementById('heroStrip').scrollBy({left:-200,behavior:'smooth'})"><i class="fa-solid fa-chevron-left"></i></button>
      <button aria-label="Next" onclick="document.getElementById('heroStrip').scrollBy({left:200,behavior:'smooth'})"><i class="fa-solid fa-chevron-right"></i></button>
    </div>
  </div>`;
}

function heroMeta(m) {
  return `
    ${m.rating?`<span class="badge badge-imdb"><i class="fa-solid fa-star"></i> ${Number(m.rating).toFixed(1)}</span>`:''}
    ${m.year?`<span class="badge">${m.year}</span>`:''}
    ${m.is_series?`<span class="badge">${m.seasons_count||1} Season${(m.seasons_count||1)>1?'s':''}</span>`:(m.duration_min?`<span class="badge">${fmtDur(m.duration_min)}</span>`:'')}
    <span class="badge badge-green"><i class="fa-solid fa-closed-captioning"></i> Interactive Subtitles</span>
    ${(m.genres||[]).slice(0,2).map(g=>`<span class="badge badge-genre">${esc(g)}</span>`).join('')}
  `;
}

function heroBtns(m) {
  const safeM = JSON.stringify({id:m.id,title:m.title,poster:m.poster,backdrop:m.backdrop,rating:m.rating,year:m.year,genres:m.genres,overview:m.overview,is_series:m.is_series,seasons_count:m.seasons_count,episodes_count:m.episodes_count,duration_min:m.duration_min}).replace(/"/g,'&quot;');
  return `
    <button class="btn-red" onclick="openMedia('${esc(m.id)}',${!!m.is_series})">
      <i class="fa-solid fa-play"></i> Watch Now
    </button>
    <button class="btn-glass" onclick="playItemTrailer('${esc(m.id)}','${esc(m.title)}')">
      <i class="fa-brands fa-youtube" style="color:var(--red)"></i> Trailer
    </button>
    <button class="btn-glass" onclick='toggleWL(${safeM})' title="Add to Watchlist">
      <i class="fa-solid fa-bookmark"></i> Watchlist
    </button>
  `;
}

function initHeroStrip(movies, active) {
  const strip = document.getElementById('heroStrip');
  if (!strip) return;
  const ph = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=300&q=60';
  strip.innerHTML = movies.slice(0,10).map(m => `
    <div class="strip-card ${m.id===active.id?'active':''}" id="sc_${m.id}"
         onclick="changeHero(${JSON.stringify(m).replace(/"/g,'&quot;')})">
      <img src="${esc(m.poster||ph)}" alt="${esc(m.title)}" loading="lazy" onerror="this.onerror=null;this.src='${ph}'">
    </div>
  `).join('');
}

function changeHero(m) {
  const bg = document.getElementById('heroBg');
  const ht = document.getElementById('heroTitle');
  const hs = document.getElementById('heroSynopsis');
  const hm = document.getElementById('heroMeta');
  const hb = document.getElementById('heroBtns');
  if (!bg) return;
  bg.style.backgroundImage = `url('${esc(m.backdrop||m.poster||'')}')`;
  ht.textContent = `${m.title} ${m.year?`(${m.year})`:''}`;
  hs.textContent = m.overview||'';
  hm.innerHTML = heroMeta(m);
  hb.innerHTML = heroBtns(m);
  document.querySelectorAll('.strip-card').forEach(c => c.classList.remove('active'));
  const sc = document.getElementById(`sc_${m.id}`);
  if (sc) sc.classList.add('active');
}

// Continue Watching Section (Direct Resume + Remaining Time + Remove Button)
function buildContinueWatchingSection(histItems) {
  if (!histItems.length) return '';
  return `<section class="content-section" id="cwSection">
    <div class="section-head">
      <h2 class="section-title">▶ Continue <span>Watching</span></h2>
    </div>
    <div class="cards-row" id="cwRow">
      ${histItems.map(h => {
        const remMin = h.dur && h.dur > h.pos ? Math.max(1, Math.round((h.dur - h.pos) / 60)) : 0;
        const metaText = remMin ? `${remMin}m left · ${pctLabel(h.pos, h.dur)}` : `${pctLabel(h.pos, h.dur)} watched`;
        return `
        <div class="movie-card cw-card" id="cwcard_${h.id}" data-hist-id="${h.id}"
             onclick="navigate('player/${esc(h.id)}')">
          <div class="card-poster-wrap">
            <button class="cw-remove-btn" onclick="event.stopPropagation();removeContinueWatching('${esc(h.id)}')" title="Remove from Continue Watching">
              <i class="fa-solid fa-xmark"></i>
            </button>
            <div class="cw-placeholder" style="height:240px;background:var(--bg-card);border-radius:10px;display:flex;align-items:center;justify-content:center">
              <i class="fa-solid fa-film" style="font-size:28px;color:var(--text-dim)"></i>
            </div>
            <div class="card-overlay"><div class="card-play-btn"><i class="fa-solid fa-play"></i></div></div>
            <div class="cw-progress-bar">
              <div class="cw-progress-fill" style="width:${Math.min(100,(h.pos/h.dur*100)).toFixed(0)}%"></div>
            </div>
          </div>
          <div class="card-caption">
            <div class="card-title">Loading...</div>
            <div class="card-meta"><span class="cw-meta-span">${metaText}</span></div>
          </div>
        </div>
      `;
      }).join('')}
    </div>
  </section>`;
}

function removeContinueWatching(id) {
  delete STATE.watchHistory[id];
  saveState();
  const card = document.getElementById(`cwcard_${id}`);
  if (card) card.remove();
  const row = document.getElementById('cwRow');
  if (row && !row.children.length) {
    const sec = document.getElementById('cwSection');
    if (sec) sec.remove();
  }
  showToast('Removed from Continue Watching');
}

function pctLabel(pos, dur) {
  if (!dur) return '';
  return `${Math.round((pos/dur)*100)}%`;
}

async function loadContinueWatchingPosters(histItems) {
  if (!histItems.length) return;
  const fallbackPoster = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=300&q=60';
  for (const h of histItems) {
    try {
      const item = await api(`/api/item/${h.id}`);
      const card = document.getElementById(`cwcard_${h.id}`);
      if (!item || item.error || !card) continue;
      _itemPreviewCache[item.id] = item;
      const ph = card.querySelector('.cw-placeholder');
      const title = card.querySelector('.card-title');
      const meta = card.querySelector('.cw-meta-span');
      if (ph) ph.outerHTML = `<img src="${esc(item.poster||fallbackPoster)}" alt="${esc(item.title)}" onerror="this.onerror=null;this.src='${fallbackPoster}'">`;
      const epPrefix = (item.season && item.episode) ? `S${item.season} E${item.episode} · ` : '';
      if (title) title.textContent = item.show_title || item.clean_title || item.title;
      const remMin = h.dur && h.dur > h.pos ? Math.max(1, Math.round((h.dur - h.pos) / 60)) : 0;
      if (meta) meta.textContent = `${epPrefix}${remMin ? `${remMin}m left` : `${pctLabel(h.pos, h.dur)} watched`}`;
      const showQuery = item.show_id ? `?showId=${encodeURIComponent(item.show_id)}` : '';
      card.onclick = () => navigate(`player/${item.id}${showQuery}`);
    } catch(e) {}
  }
}

// ============================================================
// COVERFLOW
// ============================================================
let cfIndex = 0, cfItems = [], cfTimer = null;

function buildCoverflow(featured) {
  return `<section class="coverflow-section">
    <div class="coverflow-stage"><div class="coverflow-track" id="cfTrack"></div></div>
    <div class="coverflow-dots" id="cfDots"></div>
  </section>`;
}

function initCoverflow(featured) {
  const track = document.getElementById('cfTrack');
  const dots = document.getElementById('cfDots');
  if (!track || !dots || !featured.length) return;
  const ph = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&q=60';
  cfItems = featured.slice(0,6);
  cfIndex = 0;
  track.innerHTML = cfItems.map((m,i) => `
    <div class="coverflow-slide" data-index="${i}" data-pos="${cfPos(i,0,cfItems.length)}"
         onclick="cfClick(${i},'${esc(m.id)}',${!!m.is_series})">
      <img src="${esc(m.backdrop||m.poster||ph)}" alt="${esc(m.title)}" loading="lazy" onerror="this.onerror=null;this.src='${ph}'">
    </div>
  `).join('');
  dots.innerHTML = cfItems.map((_,i) =>
    `<div class="coverflow-dot ${i===0?'active':''}" onclick="cfGo(${i})"></div>`
  ).join('');
  clearInterval(cfTimer);
  cfTimer = setInterval(() => { cfIndex=(cfIndex+1)%cfItems.length; cfUpdate(); }, 4500);
}

function cfPos(i, cur, total) {
  let d = i - cur;
  if (d < -Math.floor(total/2)) d += total;
  if (d > Math.floor(total/2)) d -= total;
  return ['−2','−1','0','1','2','hidden'][[...[-2,-1,0,1,2]].indexOf(d) >= 0 ? [...[-2,-1,0,1,2]].indexOf(d) : 5];
}

function cfUpdate() {
  document.querySelectorAll('.coverflow-slide').forEach(el => {
    const i = parseInt(el.dataset.index);
    let d = i - cfIndex;
    const total = cfItems.length;
    if (d < -Math.floor(total/2)) d += total;
    if (d > Math.floor(total/2)) d -= total;
    const posMap = {'-2':'-2','-1':'-1','0':'0','1':'1','2':'2'};
    el.dataset.pos = posMap[String(d)] ?? 'hidden';
  });
  document.querySelectorAll('.coverflow-dot').forEach((d,i) => d.classList.toggle('active', i===cfIndex));
}
function cfClick(idx, id, isSeries) { if(idx===cfIndex) openMedia(id,isSeries); else { cfIndex=idx; cfUpdate(); } }
function cfGo(idx) { cfIndex=idx; cfUpdate(); }

// ============================================================
// SECTION / CARD BUILDERS + TOP 10 + COLLECTIONS HUB
// ============================================================
function buildCollectionsHubRow() {
  const hubs = [
    { slug: 'marvel', name: 'MARVEL', sub: 'UNIVERSE', grad: 'linear-gradient(135deg,#991b1b,#e50914)', icon: 'fa-shield-halved' },
    { slug: 'dc', name: 'DC', sub: 'LEGENDS', grad: 'linear-gradient(135deg,#1e3a8a,#3b82f6)', icon: 'fa-bolt' },
    { slug: 'starwars', name: 'GALAXY', sub: 'SAGA', grad: 'linear-gradient(135deg,#1f2937,#f59e0b)', icon: 'fa-jedi' },
    { slug: 'animation', name: 'PIXAR &', sub: 'ANIMATION', grad: 'linear-gradient(135deg,#065f46,#10b981)', icon: 'fa-wand-magic-sparkles' },
    { slug: 'scifi', name: 'SCI-FI', sub: 'WORLDS', grad: 'linear-gradient(135deg,#4c1d95,#8b5cf6)', icon: 'fa-rocket' },
    { slug: 'crime', name: 'CRIME &', sub: 'MYSTERY', grad: 'linear-gradient(135deg,#111827,#4b5563)', icon: 'fa-user-secret' },
    { slug: 'horror', name: 'DARK &', sub: 'THRILLER', grad: 'linear-gradient(135deg,#450a0a,#991b1b)', icon: 'fa-ghost' },
    { slug: 'topimdb', name: 'IMDb 8.1+', sub: 'HALL OF FAME', grad: 'linear-gradient(135deg,#78350f,#f59e0b)', icon: 'fa-trophy' },
  ];
  return `<section class="content-section">
    <div class="section-head">
      <h2 class="section-title">🏛️ Franchises & <span>Collections</span></h2>
    </div>
    <div class="hubs-row">
      ${hubs.map(h => `
        <div class="hub-card" style="background:${h.grad}" onclick="navigate('hub/${h.slug}')">
          <i class="fa-solid ${h.icon} hub-icon"></i>
          <div class="hub-text">
            <div class="hub-name">${h.name}</div>
            <div class="hub-sub">${h.sub}</div>
          </div>
        </div>
      `).join('')}
    </div>
  </section>`;
}

function buildTop10Section(items) {
  if (!items?.length) return '';
  const ph = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=300&q=60';
  return `<section class="content-section">
    <div class="section-head">
      <h2 class="section-title">🏆 Top 10 <span>Today</span></h2>
    </div>
    <div class="top10-row">
      ${items.slice(0,10).map((it, idx) => `
        <div class="top10-card" onclick="openMedia('${esc(it.id)}',${!!it.is_series})">
          <span class="top10-num">${idx + 1}</span>
          <div class="top10-poster">
            <img src="${esc(it.poster||ph)}" alt="${esc(it.title)}" loading="lazy" onerror="this.onerror=null;this.src='${ph}'">
            ${it.rating?`<div class="card-rating-badge"><i class="fa-solid fa-star"></i>${Number(it.rating).toFixed(1)}</div>`:''}
          </div>
        </div>
      `).join('')}
    </div>
  </section>`;
}

function buildSection(title, items, cat) {
  if (!items?.length) return '';
  return `<section class="content-section">
    <div class="section-head">
      <h2 class="section-title">${title}</h2>
      <button class="see-all-btn" onclick="navigate('browse?cat=${cat}')">See All <i class="fa-solid fa-chevron-right fa-xs"></i></button>
    </div>
    <div class="cards-row">${items.slice(0,10).map(buildCard).join('')}</div>
  </section>`;
}

const _itemPreviewCache = {};
let _cardPreviewTimer = null;
let _cardPreviewHideTimer = null;

function buildCard(item) {
  if (item && item.id) _itemPreviewCache[item.id] = item;
  const isSer = !!item.is_series;
  const r = item.rating ? Number(item.rating).toFixed(1) : '';
  const ph = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=300&q=60';
  const hist = STATE.watchHistory[item.id];
  const pct = hist && hist.dur ? Math.min(100, hist.pos/hist.dur*100) : 0;

  return `<div class="movie-card"
    onclick="hideCardPreview(true);openMedia('${esc(item.id)}',${isSer})"
    onmouseenter="scheduleCardPreview(event,'${esc(item.id)}',${isSer})"
    onmouseleave="scheduleHideCardPreview()">
    <div class="card-poster-wrap">
      <img src="${esc(item.poster||ph)}" alt="${esc(item.title)}" loading="lazy" onerror="this.onerror=null;this.src='${ph}'">
      ${r?`<div class="card-rating-badge"><i class="fa-solid fa-star"></i>${r}</div>`:''}
      ${isSer?`<div class="card-series-ribbon">SERIES</div>`:''}
      <div class="card-overlay"><div class="card-play-btn"><i class="fa-solid fa-play"></i></div></div>
      ${pct>2?`<div class="card-progress-bar"><div style="width:${pct.toFixed(0)}%"></div></div>`:''}
    </div>
    <div class="card-caption">
      <div class="card-title">${esc(item.title)}</div>
      <div class="card-meta">
        ${item.year?`<span>${item.year}</span>`:''}
        ${isSer&&item.seasons_count?`<span>· ${item.seasons_count}S</span>`:''}
      </div>
    </div>
  </div>`;
}

function scheduleCardPreview(ev, id, isSer) {
  if (window.innerWidth < 900) return;
  clearTimeout(_cardPreviewTimer);
  clearTimeout(_cardPreviewHideTimer);
  const cardEl = ev.currentTarget;
  _cardPreviewTimer = setTimeout(() => showCardPreview(cardEl, id, isSer), 520);
}

function scheduleHideCardPreview() {
  clearTimeout(_cardPreviewTimer);
  _cardPreviewHideTimer = setTimeout(() => hideCardPreview(false), 180);
}

function hideCardPreview(immediate = false) {
  clearTimeout(_cardPreviewTimer);
  clearTimeout(_cardPreviewHideTimer);
  const pop = document.getElementById('cardHoverPreview');
  if (!pop) return;
  pop.style.display = 'none';
}

async function showCardPreview(cardEl, id, isSer) {
  const pop = document.getElementById('cardHoverPreview');
  if (!pop || !cardEl || !document.body.contains(cardEl)) return;

  let item = _itemPreviewCache[id];
  if (!item || !item.description) {
    try {
      const full = await api(`/api/item/${id}`);
      if (full && !full.error) {
        item = { ...(item || {}), ...full };
        _itemPreviewCache[id] = item;
      }
    } catch (e) {}
  }
  if (!item) return;

  const rect = cardEl.getBoundingClientRect();
  if (rect.width === 0 || rect.top < 40 || rect.bottom > window.innerHeight + 60) return;

  const ph = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&q=60';
  const imgUrl = item.backdrop || item.poster || ph;
  const r = item.rating ? Number(item.rating).toFixed(1) : '8.1';
  const genres = (item.genres || []).slice(0, 3).join(' · ') || (isSer ? 'TV Series' : 'Movie');
  const desc = (item.description || 'Stream in HD with interactive click-to-translate English subtitles.').slice(0, 125);
  const inWl = isInWatchlist(id);
  const playAction = isSer ? `openMedia('${esc(id)}', true)` : `navigate('player/${esc(id)}')`;

  pop.onmouseenter = () => clearTimeout(_cardPreviewHideTimer);
  pop.onmouseleave = () => hideCardPreview(true);

  pop.innerHTML = `
    <div class="chp-media" onclick="hideCardPreview(true);${playAction}">
      <img src="${esc(imgUrl)}" alt="${esc(item.title)}" onerror="this.onerror=null;this.src='${ph}'">
      <div class="chp-media-grad"></div>
      <div class="chp-badges">
        <span class="chp-imdb"><i class="fa-solid fa-star"></i> ${r}</span>
        ${item.year ? `<span class="chp-year">${item.year}</span>` : ''}
        <span class="chp-hd">HD · EN CC</span>
      </div>
    </div>
    <div class="chp-body">
      <div class="chp-title">${esc(item.title)}</div>
      <div class="chp-genres">${esc(genres)}</div>
      <div class="chp-desc">${esc(desc)}${desc.length >= 125 ? '...' : ''}</div>
      <div class="chp-actions">
        <button class="chp-btn-play" onclick="event.stopPropagation();hideCardPreview(true);${playAction}">
          <i class="fa-solid fa-play"></i> ${isSer ? 'Episodes' : 'Play'}
        </button>
        <button class="chp-btn-icon" onclick="event.stopPropagation();hideCardPreview(true);openTrailerModal('${esc(item.title)}','${item.year||''}')" title="Watch Trailer">
          <i class="fa-solid fa-film"></i>
        </button>
        <button class="chp-btn-icon ${inWl ? 'active' : ''}" onclick="event.stopPropagation();toggleWatchlist('${esc(id)}', this)" title="Watchlist">
          <i class="fa-${inWl ? 'solid' : 'regular'} fa-bookmark"></i>
        </button>
        <button class="chp-btn-icon" onclick="event.stopPropagation();hideCardPreview(true);openMedia('${esc(id)}',${isSer})" title="Details">
          <i class="fa-solid fa-chevron-right"></i>
        </button>
      </div>
    </div>
  `;

  const popW = 290;
  let left = rect.left + rect.width / 2 - popW / 2;
  left = Math.max(16, Math.min(window.innerWidth - popW - 16, left));
  let top = rect.top + window.scrollY - 24;

  pop.style.width = `${popW}px`;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.style.display = 'block';
}

function openMedia(id, isSeries) {
  hideCardPreview(true);
  if (isSeries) navigate(`show/${id}`);
  else navigate(`movie/${id}`);
}

// ============================================================
// MOVIE DETAIL PAGE
// ============================================================
function buildRelatedSections(rd) {
  if (!rd) return '';
  const parts = rd.parts || [];
  const universe = rd.universe || [];
  const related = rd.related || [];
  let html = '';

  if (parts.length > 1) {
    html += `<div class="similar-section">
      <div class="section-head"><h2 class="section-title"><i class="fa-solid fa-layer-group" style="color:var(--red);margin-right:8px"></i>${esc(rd.collectionName || 'All Parts in Order')} <span>(${parts.length} Movies)</span></h2></div>
      <div class="cards-row">${parts.map(p => buildPartCard(p)).join('')}</div>
    </div>`;
  }
  if (universe.length) {
    html += `<div class="similar-section">
      <div class="section-head"><h2 class="section-title"><i class="fa-solid fa-earth-americas" style="color:var(--blue);margin-right:8px"></i>In the Same <span>Universe</span></h2></div>
      <div class="cards-row">${universe.map(buildCard).join('')}</div>
    </div>`;
  }
  if (related.length) {
    html += `<div class="similar-section">
      <div class="section-head"><h2 class="section-title">More Like <span>This</span></h2></div>
      <div class="cards-row">${related.map(buildCard).join('')}</div>
    </div>`;
  }
  return html;
}

function buildPartCard(p) {
  const ph = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=300&q=60';
  const r = p.rating ? Number(p.rating).toFixed(1) : '';
  const click = p.available
    ? `openMedia('${esc(p.id)}',false)`
    : `srResolveOnline('movie',${p.tmdb_id},'${esc(p.title)}')`;
  return `<div class="movie-card ${p.current?'part-current':''}" onclick="${click}" style="${p.current?'outline:2px solid var(--red);border-radius:10px':''}">
    <div class="card-poster-wrap">
      <img src="${esc(p.poster||ph)}" alt="${esc(p.title)}" loading="lazy" onerror="this.src='${ph}'">
      ${r?`<div class="card-rating-badge"><i class="fa-solid fa-star"></i>${r}</div>`:''}
      <div class="card-series-ribbon" style="background:${p.current?'var(--red)':'rgba(0,0,0,0.8)'}">PART ${p.part}${p.current?' · NOW':''}</div>
      <div class="card-overlay"><div class="card-play-btn"><i class="fa-solid fa-${p.available?'play':'magnifying-glass'}"></i></div></div>
    </div>
    <div class="card-caption">
      <div class="card-title">${esc(p.title)}</div>
      <div class="card-meta">
        ${p.year?`<span>${p.year}</span>`:''}
        <span style="color:${p.available?'var(--green)':'var(--text-m)'}">· ${p.available?'Available':'Find Online'}</span>
      </div>
    </div>
  </div>`;
}

function buildExtrasHtml(ex, item) {
  if (!ex) return '';
  const cast = ex.cast || [];
  const metaPills = [];
  if (ex.director) metaPills.push(`<span class="extra-pill" onclick="navigate('actor/${ex.director.id}')" style="cursor:pointer"><i class="fa-solid fa-clapperboard"></i> Directed by <strong>${esc(ex.director.name)}</strong></span>`);
  if (ex.studios?.length) metaPills.push(`<span class="extra-pill"><i class="fa-solid fa-building"></i> ${esc(ex.studios.join(' · '))}</span>`);
  if (ex.countries?.length) metaPills.push(`<span class="extra-pill"><i class="fa-solid fa-globe"></i> ${esc(ex.countries.join(', '))}</span>`);
  if (ex.revenue > 1000000) metaPills.push(`<span class="extra-pill"><i class="fa-solid fa-sack-dollar"></i> Box Office: $${Math.round(ex.revenue/1e6)}M</span>`);

  const userStar = getUserRating(item.id);
  const isFav = isFavorite(item.id);

  let html = `<div class="extras-meta-bar">${metaPills.join('')}</div>`;
  if (cast.length) {
    html += `<div class="similar-section" style="padding-top:24px">
      <div class="section-head"><h2 class="section-title"><i class="fa-solid fa-users" style="color:var(--red);margin-right:8px"></i>Top <span>Cast</span></h2></div>
      <div class="cast-row">
        ${cast.map(c => `
          <div class="cast-card" onclick="navigate('actor/${c.id}')">
            <div class="cast-avatar">
              ${c.photo ? `<img src="${esc(c.photo)}" alt="${esc(c.name)}" loading="lazy">` : `<i class="fa-solid fa-user"></i>`}
            </div>
            <div class="cast-name">${esc(c.name)}</div>
            <div class="cast-role">${esc(c.character)}</div>
          </div>
        `).join('')}
      </div>
    </div>`;
  }
  return html;
}

async function renderMoviePage(id) {
  document.title = 'Loading... — SCANE';
  setMain(`<div class="page-loading-spinner"><div class="spinner-ring-lg"></div></div>`);
  try {
    const movie = await api(`/api/movie/${id}`);
    if (!movie || movie.error) throw new Error('Not found');
    // If it is actually a grouped show, go to show page
    if (movie.is_series && movie.episodes) { renderShowPage(id); return; }
    document.title = `${movie.title} — SCANE`;

    const [rd, ex] = await Promise.all([
      api(`/api/related/${id}`).catch(() => ({})),
      api(`/api/extras/${id}`).catch(() => ({})),
    ]);

    const inWl = STATE.watchlist.some(x => x.id===id);
    const isFav = isFavorite(id);
    const uStar = getUserRating(id);
    const hist = STATE.watchHistory[id];
    const pct = hist&&hist.dur ? Math.min(100,hist.pos/hist.dur*100).toFixed(0) : 0;
    const safeM = JSON.stringify({id:movie.id,title:movie.title,poster:movie.poster,year:movie.year,rating:movie.rating,is_series:false}).replace(/"/g,'&quot;');
    const ph = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=300&q=60';

    setMain(`<div class="detail-page">
      <div class="detail-hero" style="background-image:url('${esc(movie.backdrop||movie.poster||'')}')">
        <div class="detail-hero-topbar">
          <button class="back-btn" onclick="history.back()"><i class="fa-solid fa-arrow-left"></i> Back</button>
        </div>
      </div>
      <div class="detail-body">
        <div class="detail-poster">
          <img src="${esc(movie.poster||ph)}" alt="${esc(movie.title)}" onerror="this.onerror=null;this.src='${ph}'">
        </div>
        <div class="detail-info">
          <div style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap">
            <span class="badge badge-green"><i class="fa-solid fa-closed-captioning"></i> Interactive English Subtitles</span>
            ${ex.certification?`<span class="badge" style="border-color:rgba(255,255,255,0.3);font-weight:800">${esc(ex.certification)}</span>`:''}
          </div>
          <h1 class="detail-title">${esc(movie.title)}</h1>
          ${ex.tagline?`<div class="detail-tagline">"${esc(ex.tagline)}"</div>`:''}
          <div class="detail-meta">
            ${movie.rating?`<span class="badge badge-imdb"><i class="fa-solid fa-star"></i> ${Number(movie.rating).toFixed(1)}</span>`:''}
            ${movie.year?`<span class="badge"><i class="fa-regular fa-calendar"></i> ${movie.year}</span>`:''}
            ${movie.duration_min?`<span class="badge"><i class="fa-regular fa-clock"></i> ${fmtDur(movie.duration_min)}</span>`:''}
          </div>
          <div class="detail-genres">
            ${(movie.genres||[]).map(g=>`<span class="badge badge-genre" style="cursor:pointer" onclick="navigate('browse?genre=${encodeURIComponent(g.toLowerCase())}')">${esc(g)}</span>`).join('')}
          </div>
          <p class="detail-synopsis">${esc(movie.overview||'No synopsis available.')}</p>
          ${pct>2?`<div style="margin-bottom:18px">
            <div style="font-size:12px;color:var(--text-m);margin-bottom:6px">Continue watching · ${pct}% complete</div>
            <div style="height:4px;background:rgba(255,255,255,0.15);border-radius:2px;max-width:260px">
              <div style="height:100%;background:var(--red);width:${pct}%;border-radius:2px"></div>
            </div>
          </div>`:''}
          <div class="detail-action-row">
            <button class="btn-red" onclick="navigate('player/${id}')">
              <i class="fa-solid fa-play"></i> ${pct>2?'Continue Watching':'Watch Now'}
            </button>
            ${ex.trailerKey?`<button class="btn-glass" onclick="openTrailerKey('${esc(ex.trailerKey)}','${esc(movie.title)}')">
              <i class="fa-brands fa-youtube" style="color:var(--red)"></i> Trailer
            </button>`:`<button class="btn-glass" onclick="playItemTrailer('${esc(id)}','${esc(movie.title)}')">
              <i class="fa-brands fa-youtube" style="color:var(--red)"></i> Trailer
            </button>`}
            <button class="btn-glass" id="wlBtn_${id}" onclick='toggleWL(${safeM})'>
              <i class="fa-solid fa-${inWl?'check':'plus'}"></i> ${inWl?'In Watchlist':'Watchlist'}
            </button>
            <button class="btn-glass ${isFav?'fav-active':''}" id="favBtn_${id}" onclick='toggleFav(${safeM})' title="Favorite">
              <i class="fa-${isFav?'solid':'regular'} fa-heart" style="color:${isFav?'var(--red)':'inherit'}"></i>
            </button>
            <div class="star-rater" title="Your Rating">
              ${[1,2,3,4,5].map(st=>`<i class="fa-${st<=uStar?'solid':'regular'} fa-star" onclick="setUserRating('${esc(id)}',${st})"></i>`).join('')}
            </div>
          </div>
          ${buildExtrasHtml(ex, movie)}
        </div>
      </div>
      ${buildRelatedSections(rd)}
      ${buildFooter()}
    </div>`);
  } catch(err) {
    setMain(`<div style="text-align:center;padding:80px 24px;color:#64748b">
      <i class="fa-solid fa-circle-exclamation" style="font-size:48px;color:var(--red);margin-bottom:16px"></i>
      <p style="margin-bottom:20px">Movie not found.</p>
      <button class="btn-glass" onclick="history.back()"><i class="fa-solid fa-arrow-left"></i> Go Back</button>
    </div>`);
  }
}
// ============================================================
// TV SHOW DETAIL PAGE - COMPLETE REWRITE
// ============================================================
async function renderShowPage(showId) {
  document.title = 'Loading... — SCANE';
  setMain(`<div class="page-loading-spinner"><div class="spinner-ring-lg"></div></div>`);
  try {
    const show = await api(`/api/series/${showId}`);
    document.title = `${show.title} — SCANE`;
    const inWl = STATE.watchlist.some(x => x.id === show.id);
    const firstEp = (show.episodes||[])[0];
    const safeWl = JSON.stringify({id:show.id,title:show.title,poster:show.poster,year:show.year,rating:show.rating,is_series:true}).replace(/"/g,'&quot;');
    const ph = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=300&q=60';

    // Find the last episode watched (for "Continue" button)
    let resumeEp = null;
    for (const ep of (show.episodes||[])) {
      const h = STATE.watchHistory[ep.id];
      if (h && h.pos > 10) { resumeEp = ep; break; }
    }
    const playEp = resumeEp || firstEp;
    const playLabel = resumeEp ? `Continue S${resumeEp.season} E${resumeEp.episode}` : (firstEp ? 'Play S1 E1' : 'Watch Now');

    const [rd, ex] = await Promise.all([
      api(`/api/related/${show.id}`).catch(() => ({})),
      api(`/api/extras/${show.id}`).catch(() => ({})),
    ]);
    const isFav = isFavorite(show.id);
    const uStar = getUserRating(show.id);

    setMain(`<div class="detail-page">
      <div class="detail-hero" style="background-image:url('${esc(show.backdrop||show.poster||'')}')">
        <div class="detail-hero-topbar">
          <button class="back-btn" onclick="history.back()"><i class="fa-solid fa-arrow-left"></i> Back</button>
        </div>
      </div>
      <div class="detail-body">
        <div class="detail-poster">
          <img src="${esc(show.poster||ph)}" alt="${esc(show.title)}" onerror="this.onerror=null;this.src='${ph}'">
        </div>
        <div class="detail-info">
          <div style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap">
            <span class="badge" style="background:rgba(59,130,246,0.2);border-color:rgba(59,130,246,0.35);color:#60a5fa">
              <i class="fa-solid fa-tv"></i> TV SERIES
            </span>
            <span class="badge badge-green"><i class="fa-solid fa-closed-captioning"></i> Interactive English Subtitles</span>
            ${ex.certification?`<span class="badge" style="border-color:rgba(255,255,255,0.3);font-weight:800">${esc(ex.certification)}</span>`:''}
          </div>
          <h1 class="detail-title">${esc(show.title)}</h1>
          ${ex.tagline?`<div class="detail-tagline">"${esc(ex.tagline)}"</div>`:''}
          <div class="detail-meta">
            ${show.rating ? `<span class="badge badge-imdb"><i class="fa-solid fa-star"></i> ${Number(show.rating).toFixed(1)}</span>` : ''}
            ${show.year ? `<span class="badge">${show.year}</span>` : ''}
            <span class="badge">${show.seasons_count||1} Season${(show.seasons_count||1)>1?'s':''}</span>
            <span class="badge">${show.episodes_count||0} Episodes</span>
          </div>
          <div class="detail-genres">
            ${(show.genres||[]).map(g=>`<span class="badge badge-genre" style="cursor:pointer" onclick="navigate('browse?genre=${encodeURIComponent(g.toLowerCase())}')">${esc(g)}</span>`).join('')}
          </div>
          <p class="detail-synopsis">${esc(show.overview||'')}</p>
          <div class="detail-action-row">
            ${playEp ? `<button class="btn-red" onclick="navigate('player/${esc(playEp.id)}?showId=${esc(showId)}')">
              <i class="fa-solid fa-play"></i> ${esc(playLabel)}
            </button>` : ''}
            ${ex.trailerKey?`<button class="btn-glass" onclick="openTrailerKey('${esc(ex.trailerKey)}','${esc(show.title)}')">
              <i class="fa-brands fa-youtube" style="color:var(--red)"></i> Trailer
            </button>`:`<button class="btn-glass" onclick="playItemTrailer('${esc(show.id)}','${esc(show.title)}')">
              <i class="fa-brands fa-youtube" style="color:var(--red)"></i> Trailer
            </button>`}
            <button class="btn-glass" id="wlBtn_${show.id}" onclick='toggleWL(${safeWl})'>
              <i class="fa-solid fa-${inWl?'check':'plus'}"></i> ${inWl?'In Watchlist':'Watchlist'}
            </button>
            ${show.tmdb_id ? `<button class="btn-glass" id="scanEpsBtn" onclick="scanShowEpisodesOnline(${show.tmdb_id},'${esc(showId)}','${esc(show.title)}')" title="Scan online for all seasons & episodes">
              <i class="fa-solid fa-cloud-arrow-down"></i> All Episodes
            </button>` : ''}
            <button class="btn-glass ${isFav?'fav-active':''}" id="favBtn_${show.id}" onclick='toggleFav(${safeWl})' title="Favorite">
              <i class="fa-${isFav?'solid':'regular'} fa-heart" style="color:${isFav?'var(--red)':'inherit'}"></i>
            </button>
            <div class="star-rater" title="Your Rating">
              ${[1,2,3,4,5].map(st=>`<i class="fa-${st<=uStar?'solid':'regular'} fa-star" onclick="setUserRating('${esc(show.id)}',${st})"></i>`).join('')}
            </div>
          </div>
          ${buildExtrasHtml(ex, show)}
        </div>
      </div>
      <!-- Season Tabs -->
      <div class="seasons-tabs-bar" id="seasonTabs">
        ${(show.seasons||[1]).map((s,i)=>`
          <button class="season-tab ${i===0?'active':''}" onclick="switchSeason(${s},this)"
                  id="stab_${s}">Season ${s}</button>
        `).join('')}
      </div>
      <div id="seasonContent" class="season-content">
        <div class="page-loading-spinner" style="height:160px"><div class="spinner-ring-lg"></div></div>
      </div>
      ${buildRelatedSections(rd)}
      ${buildFooter()}
    </div>`);

    // Store show data globally for tab switching
    window.showData = show;
    renderSeason(show.seasons?.[0]||1, show);

    // Auto-scan online if show has <= 2 episodes and hasn't been scanned yet
    if (show.tmdb_id && (show.episodes_count || 0) <= 2) {
      if (!STATE._scannedShows) STATE._scannedShows = {};
      if (!STATE._scannedShows[show.tmdb_id]) {
        STATE._scannedShows[show.tmdb_id] = true;
        scanShowEpisodesOnline(show.tmdb_id, showId, show.title, true);
      }
    }

  } catch(err) {
    setMain(`<div style="text-align:center;padding:80px 24px;color:#64748b">
      <i class="fa-solid fa-circle-exclamation" style="font-size:48px;color:var(--red);margin-bottom:16px"></i>
      <p style="margin-bottom:20px">Series not found.</p>
      <button class="btn-glass" onclick="history.back()"><i class="fa-solid fa-arrow-left"></i> Go Back</button>
    </div>`);
  }
}

async function scanShowEpisodesOnline(tmdbId, showId, title, silent = false) {
  const btn = document.getElementById('scanEpsBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Scanning Seasons...`;
  }
  if (!silent) showToast(`🔍 Scanning all seasons & episodes for "${title}"...`);
  try {
    const r = await api(`/api/resolve?type=tv&tmdb_id=${encodeURIComponent(tmdbId)}`);
    if (r && r.found && r.added > 0) {
      showToast(`✓ Added ${r.added} new episode(s) for "${title}"!`);
      renderShowPage(r.id || showId);
      return;
    } else if (!silent) {
      showToast(`✓ All available episodes for "${title}" are already loaded`);
    }
  } catch (e) {
    if (!silent) showToast('Could not scan episodes right now');
  }
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-check"></i> All Episodes Checked`;
  }
}

function switchSeason(sNum, btn) {
  document.querySelectorAll('.season-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderSeason(sNum, window.showData);
}

function renderSeason(sNum, show) {
  const sc = document.getElementById('seasonContent');
  if (!sc || !show) return;
  const sd = (show.seasonsDetails||{})[String(sNum)] || {};
  const eps = (show.episodes||[]).filter(e => e.season === sNum);

  sc.innerHTML = `
    <div class="season-overview-box">
      <h4>
        <i class="fa-solid fa-film" style="color:var(--red)"></i>
        ${esc(sd.name || `Season ${sNum}`)}
        ${sd.rating ? `<span class="badge badge-imdb" style="margin-left:6px;font-size:11px"><i class="fa-solid fa-star"></i> ${Number(sd.rating).toFixed(1)}</span>` : ''}
        <span style="color:var(--text-m);font-size:13px;font-weight:400;margin-left:8px">${eps.length} Episodes</span>
      </h4>
      <p>${esc(sd.overview || `${show.title} · Season ${sNum}`)}</p>
    </div>
    <div class="episodes-list">
      ${eps.map(ep => buildEpCard(ep, show)).join('')}
    </div>
  `;
}

function buildEpCard(ep, show) {
  const hist = STATE.watchHistory[ep.id];
  const pct = hist && ep.duration_min ? Math.min(100, hist.pos/(ep.duration_min*60)*100).toFixed(0) : 0;
  const ph = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=300&q=60';
  const still = ep.episode_still || ep.poster || show.poster || ph;
  const name = ep.episode_name || ep.clean_title || `Episode ${ep.episode}`;
  const rating = ep.episode_rating ? Number(ep.episode_rating).toFixed(1) : '';
  const dur = ep.duration_min ? `${Math.round(ep.duration_min)} min` : '';
  const overview = ep.episode_overview || ep.overview || '';

  return `<div class="ep-card ${pct>2?'has-progress':''}" onclick="navigate('player/${esc(ep.id)}?showId=${esc(show.id)}')">
    <div class="ep-still">
      <img src="${esc(still)}" alt="${esc(name)}" loading="lazy" onerror="this.onerror=null;this.src='${esc(show.poster||ph)}'">
      <div class="ep-still-play"><i class="fa-solid fa-play"></i></div>
      ${pct>2 ? `<div class="ep-progress-bar"><div style="width:${pct}%"></div></div>` : ''}
    </div>
    <div class="ep-info">
      <div class="ep-num-meta">
        <span class="ep-num">S${ep.season} E${ep.episode}</span>
        ${rating ? `<span class="ep-rating"><i class="fa-solid fa-star"></i> ${rating}</span>` : ''}
        ${dur ? `<span class="ep-duration"><i class="fa-regular fa-clock"></i> ${dur}</span>` : ''}
        ${pct>2 ? `<span style="font-size:11px;color:var(--green)">▶ ${pct}% watched</span>` : ''}
      </div>
      <div class="ep-name">${esc(name)}</div>
      ${overview ? `<div class="ep-synopsis">${esc(overview)}</div>` : ''}
    </div>
  </div>`;
}
// ============================================================
// FULL-PAGE PLAYER (Clean iOS Liquid Glass + Interactive Subtitles)
// ============================================================
async function renderPlayerPage(videoId, params = {}) {
  if (!videoId) { navigate('home'); return; }
  hideCardPreview(true);
  const showId = params.showId || '';
  const fromRutube = params.fromRutube === '1';

  // Watch Party / Timestamp Link Sync
  if (params.t && !isNaN(Number(params.t))) {
    const startSec = Math.max(0, Number(params.t));
    const existing = STATE.watchHistory[videoId] || {};
    STATE.watchHistory[videoId] = { pos: startSec, dur: existing.dur || 3600, ts: Date.now() };
    saveState();
    if (params.party === '1') {
      setTimeout(() => showToast(`🎉 Joined Watch Party at ${fmtTime(startSec)}`), 600);
    }
  }

  document.title = 'Loading... — SCANE';
  document.getElementById('navbar').style.display = 'none';

  setMain(`<div class="player-page" id="playerPage">
    <canvas id="pvAmbient" class="player-ambient"></canvas>
    <video id="pvid" class="player-video" playsinline crossorigin="anonymous"></video>

    <!-- Loader -->
    <div class="player-loader" id="pvLoader">
      <div class="spinner-ring-lg"></div>
      <p id="pvLoaderText">Connecting to stream...</p>
    </div>

    <!-- Error -->
    <div class="player-error" id="pvError" style="display:none">
      <i class="fa-solid fa-circle-exclamation"></i>
      <p id="pvErrorText">Stream unavailable</p>
      <div style="display:flex;gap:12px;margin-top:16px">
        <button class="btn-red-sm" onclick="retryPlayer()"><i class="fa-solid fa-rotate-right"></i> Retry</button>
        <button class="btn-glass-sm" onclick="navigate('home')"><i class="fa-solid fa-house"></i> Home</button>
      </div>
    </div>

    <!-- Tap zones -->
    <div class="tap-zone tap-left" id="ptapL"><div class="tap-pill" id="tpL"><i class="fa-solid fa-rotate-left"></i> 10s</div></div>
    <div class="tap-zone tap-center" id="ptapC"></div>
    <div class="tap-zone tap-right" id="ptapR"><div class="tap-pill" id="tpR"><i class="fa-solid fa-rotate-right"></i> 10s</div></div>

    <!-- Episode sidebar -->
    <div class="ep-sidebar" id="pSidebar">
      <div class="ep-sidebar-header">
        <span>Episodes</span>
        <button onclick="document.getElementById('pSidebar').classList.remove('open')">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="ep-sidebar-list" id="pSidebarList"></div>
    </div>

    <!-- Interactive Transcript & Dictionary Sidebar -->
    <div class="ep-sidebar transcript-sidebar" id="pTranscript" onclick="event.stopPropagation()">
      <div class="ep-sidebar-header">
        <span><i class="fa-solid fa-book-open"></i> Interactive Transcript</span>
        <button onclick="document.getElementById('pTranscript').classList.remove('open')">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="tr-tip">Click any line to jump · Click any word to translate</div>
      <div class="dict-popup" id="dictPopup" style="display:none"></div>
      <div class="ep-sidebar-list" id="pTranscriptList">
        <div style="padding:20px;color:var(--text-d);font-size:13px">Loading subtitles...</div>
      </div>
    </div>

    <!-- SCENE ENGLISH: Optional Studio Dock (Closed by default) -->
    <div class="ep-sidebar se-player-dock" id="sePlayerDock" onclick="event.stopPropagation()">
      <div class="ep-sidebar-header">
        <span><i class="fa-solid fa-graduation-cap" style="color:var(--red)"></i> Scene Practice</span>
        <button onclick="document.getElementById('sePlayerDock').classList.remove('open')">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="se-dock-tabs" id="seDockTabs"></div>
      <div class="se-dock-body" id="seDockBody"></div>
    </div>

    <!-- SINGLE INTERACTIVE SUBTITLE OVERLAY & COMPACT TRANSLATION CARD -->
    <div class="se-sub-overlay" id="seSubOverlay" style="display:none" onclick="event.stopPropagation()"></div>
    <div class="se-sub-mode-bar" id="seSubModeBar" style="display:none" onclick="event.stopPropagation()"></div>
    <div class="se-word-popup" id="seWordPopup" style="display:none" onclick="event.stopPropagation()"></div>

    <!-- Subtitle offset popup -->
    <div class="sub-offset-popup" id="subOffsetPop" style="display:none" onclick="event.stopPropagation()">
      <div class="sub-offset-title"><i class="fa-solid fa-closed-captioning"></i> Subtitle Sync & Track</div>
      <div class="sub-offset-row">
        <button onclick="adjustSubOffset(-0.5)"><i class="fa-solid fa-minus"></i> 0.5s</button>
        <span id="subOffsetVal">0.0s</span>
        <button onclick="adjustSubOffset(0.5)">+0.5s <i class="fa-solid fa-plus"></i></button>
      </div>
      <button class="sub-offset-reset" onclick="resetSubOffset()">Reset Offset</button>
      <div class="sub-alt-list" id="subAltList" style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px"></div>
    </div>

    <!-- Quality menu -->
    <div class="speed-menu" id="pQualMenu" style="display:none;right:155px" onclick="event.stopPropagation()">
      <div class="speed-menu-title">Stream Quality</div>
      <div id="pQualList"><button class="active">Auto (HD)</button></div>
    </div>

    <!-- Speed menu -->
    <div class="speed-menu" id="pSpeedMenu" style="display:none" onclick="event.stopPropagation()">
      <div class="speed-menu-title">Playback Speed</div>
      ${[0.5,0.75,1.0,1.25,1.5,2.0].map(s=>`<button onclick="setSpeed(${s})">${s}x${s===1.0?' <span class="normal-label">Normal</span>':''}</button>`).join('')}
    </div>

    <!-- Clean Liquid Glass Settings Dropdown (Replaces 13 top-bar icons) -->
    <div class="player-more-menu" id="pMoreMenu" style="display:none" onclick="event.stopPropagation()">
      <button class="pm-item" id="pvQualBtn" onclick="closePlayerMoreMenu();toggleQualMenu()">
        <span class="pm-item-left"><i class="fa-solid fa-sliders"></i> Video Quality</span>
        <span class="pm-item-val" id="pvQualLabel">Auto</span>
      </button>
      <button class="pm-item" id="pvSpeedBtn" onclick="closePlayerMoreMenu();toggleSpeedMenu()">
        <span class="pm-item-left"><i class="fa-solid fa-gauge-high"></i> Playback Speed</span>
        <span class="pm-item-val" id="pvSpeedLabel">1x</span>
      </button>
      <button class="pm-item" onclick="closePlayerMoreMenu();toggleSubOffsetPop()">
        <span class="pm-item-left"><i class="fa-solid fa-closed-captioning"></i> Subtitle Sync</span>
        <span class="pm-item-val">±0.5s</span>
      </button>
      <button class="pm-item" id="pvTrBtn" onclick="closePlayerMoreMenu();toggleTranscriptSidebar()">
        <span class="pm-item-left"><i class="fa-solid fa-book-open"></i> Full Transcript</span>
        <span class="pm-item-val">Open</span>
      </button>
      <div class="pm-divider"></div>
      <button class="pm-item" id="pvBoostBtn" onclick="toggleAudioBoost()">
        <span class="pm-item-left"><i class="fa-solid fa-ear-listen"></i> Audio Boost</span>
        <span class="pm-item-val" id="pvBoostLabel">100%</span>
      </button>
      <button class="pm-item" id="pvLoopBtn" onclick="toggleAbLoop()">
        <span class="pm-item-left"><i class="fa-solid fa-repeat"></i> Scene Loop (A-B)</span>
        <span class="pm-item-val" id="pvLoopLabel">Off</span>
      </button>
      <button class="pm-item" id="pvAmbientBtn" onclick="toggleAmbientMode()">
        <span class="pm-item-left"><i class="fa-solid fa-wand-magic-sparkles"></i> Ambient Glow</span>
        <span class="pm-item-val">Cinema</span>
      </button>
      <button class="pm-item" id="pvSleepBtn" onclick="cycleSleepTimer()">
        <span class="pm-item-left"><i class="fa-solid fa-moon"></i> Sleep Timer</span>
        <span class="pm-item-val" id="pvSleepLabel">Off</span>
      </button>
      <div class="pm-divider"></div>
      <button class="pm-item" onclick="closePlayerMoreMenu();shareWatchPartyLink()">
        <span class="pm-item-left"><i class="fa-solid fa-users-viewfinder"></i> Watch Party</span>
        <span class="pm-item-val">Share Link</span>
      </button>
      <button class="pm-item" onclick="closePlayerMoreMenu();takeVideoScreenshot()">
        <span class="pm-item-left"><i class="fa-solid fa-camera"></i> Save Frame</span>
      </button>
      <button class="pm-item" onclick="closePlayerMoreMenu();togglePiP()">
        <span class="pm-item-left"><i class="fa-solid fa-clone"></i> Picture in Picture</span>
      </button>
      <button class="pm-item" onclick="closePlayerMoreMenu();document.getElementById('kbShortcuts').style.display='flex'">
        <span class="pm-item-left"><i class="fa-solid fa-keyboard"></i> Shortcuts</span>
        <span class="pm-item-val">?</span>
      </button>
    </div>

    <!-- Center play/pause flash indicator -->
    <div class="center-flash" id="pvFlash" style="display:none"><i class="fa-solid fa-play" id="pvFlashIcon"></i></div>

    <!-- Skip Intro button -->
    <button class="skip-intro-btn" id="pvSkipIntro" style="display:none" onclick="event.stopPropagation(); seekBy(85); this.style.display='none'">
      <i class="fa-solid fa-forward-fast"></i> Skip Intro
    </button>

    <!-- Controls -->
    <div class="player-controls" id="pvCtrl">

      <!-- Top bar (Minimalist: Back + Title on left; Subtitles + Episodes + Settings on right) -->
      <div class="pctrl-top" onclick="event.stopPropagation()">
        <div class="pctrl-top-left">
          <button class="ctrl-btn-icon" onclick="closePlayerPage()" title="Back">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="player-title-wrap">
            <div class="player-show-title" id="pvShowTitle"></div>
            <div class="player-ep-title" id="pvEpTitle"></div>
          </div>
        </div>
        <div class="pctrl-top-right">
          <button class="ctrl-btn-icon" id="pvSubBtn" onclick="toggleSubtitles()" title="Subtitles (Click any word to translate)">
            <i class="fa-solid fa-closed-captioning"></i>
          </button>
          <button class="ctrl-btn-icon ep-sidebar-btn" id="pvEpBtn" style="display:none" onclick="document.getElementById('pSidebar').classList.toggle('open')" title="Episodes">
            <i class="fa-solid fa-list-ul"></i>
          </button>
          <button class="ctrl-btn-icon" id="pvMoreBtn" onclick="togglePlayerMoreMenu(event)" title="Settings & Tools">
            <i class="fa-solid fa-gear"></i>
          </button>
        </div>
      </div>

      <!-- Bottom bar -->
      <div class="pctrl-bottom" onclick="event.stopPropagation()">
        <!-- Scrubber -->
        <div class="scrubber-wrap">
          <span class="time-label" id="pvCurTime">0:00</span>
          <div class="scrubber-track" id="pvScrub">
            <div class="scrubber-buffer" id="pvBuf"></div>
            <div class="scrubber-fill" id="pvFill"></div>
            <div class="scrubber-thumb" id="pvThumb"></div>
            <div class="scrubber-tooltip" id="pvTip">0:00</div>
          </div>
          <span class="time-label" id="pvDur">0:00</span>
        </div>
        <!-- Buttons row -->
        <div class="ctrl-row">
          <div class="ctrl-left">
            <button class="ctrl-btn-icon" id="pvLockBtn" onclick="toggleLock()" title="Lock controls">
              <i class="fa-solid fa-lock-open" id="pvLockIcon"></i>
            </button>
            <div class="volume-wrap">
              <button class="ctrl-btn-icon" onclick="toggleMuteP()"><i class="fa-solid fa-volume-high" id="pvVolIcon"></i></button>
              <input type="range" class="vol-slider" id="pvVolSlider" min="0" max="1" step="0.05" value="1">
            </div>
          </div>
          <div class="ctrl-center">
            <button class="ctrl-btn-icon" id="pvPrevBtn" onclick="playPrevEp()" title="Previous">
              <i class="fa-solid fa-backward-step"></i>
            </button>
            <button class="ctrl-btn-icon seek-btn" onclick="seekBy(-10)">
              <i class="fa-solid fa-rotate-left"></i><span>10</span>
            </button>
            <button class="play-pause-btn" id="pvPlayBtn" onclick="togglePlay()">
              <i class="fa-solid fa-play" id="pvPlayIcon"></i>
            </button>
            <button class="ctrl-btn-icon seek-btn" onclick="seekBy(10)">
              <i class="fa-solid fa-rotate-right"></i><span>10</span>
            </button>
            <button class="ctrl-btn-icon" id="pvNextBtn" onclick="playNextEp()" title="Next">
              <i class="fa-solid fa-forward-step"></i>
            </button>
          </div>
          <div class="ctrl-right">
            <button class="ctrl-btn-icon ep-sidebar-btn" id="pvEpBtnB" style="display:none" onclick="document.getElementById('pSidebar').classList.toggle('open')">
              <i class="fa-solid fa-list"></i><span class="ctrl-btn-label">Episodes</span>
            </button>
            <button class="ctrl-btn-icon" onclick="toggleFullscreen()" title="Fullscreen">
              <i class="fa-solid fa-expand" id="pvFsIcon"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- Next ep banner -->
      <div class="next-ep-banner" id="pvNextBanner" style="display:none">
        <div class="next-ep-content"><span>Up Next</span><strong id="pvNextTitle"></strong></div>
        <button class="btn-red-sm" onclick="playNextEp()"><i class="fa-solid fa-forward-step"></i> Play</button>
        <button class="btn-glass-sm" onclick="document.getElementById('pvNextBanner').style.display='none'">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <!-- Keyboard Shortcuts Overlay -->
      <div class="kb-shortcuts-overlay" id="kbShortcuts" style="display:none" onclick="this.style.display='none'">
        <div class="kb-shortcuts-panel" onclick="event.stopPropagation()">
          <div class="kb-shortcuts-header">
            <span><i class="fa-solid fa-keyboard"></i> Keyboard Shortcuts</span>
            <button onclick="document.getElementById('kbShortcuts').style.display='none'"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="kb-shortcuts-grid">
            <div class="kb-item"><kbd>Space</kbd><span>Play / Pause</span></div>
            <div class="kb-item"><kbd>←</kbd><span>-10 seconds</span></div>
            <div class="kb-item"><kbd>→</kbd><span>+10 seconds</span></div>
            <div class="kb-item"><kbd>↑ ↓</kbd><span>Volume</span></div>
            <div class="kb-item"><kbd>F</kbd><span>Fullscreen</span></div>
            <div class="kb-item"><kbd>M</kbd><span>Mute</span></div>
            <div class="kb-item"><kbd>C</kbd><span>Subtitles</span></div>
            <div class="kb-item"><kbd>N</kbd><span>Next Episode</span></div>
            <div class="kb-item"><kbd>?</kbd><span>This Help</span></div>
            <div class="kb-item"><kbd>ESC</kbd><span>Exit Player</span></div>
          </div>
        </div>
      </div>
</div><!-- /controls -->
  </div>`); // end player-page

  // Initialize player with this video
  await initFullPagePlayer(videoId, showId, fromRutube);
  if (typeof attachSceneEnglishToPlayer === 'function') {
    attachSceneEnglishToPlayer(videoId, params && params.learn === '1');
  }
}

function togglePlayerMoreMenu(e) {
  if (e) e.stopPropagation();
  const m = document.getElementById('pMoreMenu');
  if (!m) return;
  const isOpen = m.style.display !== 'none';
  ['pQualMenu', 'pSpeedMenu', 'subOffsetPop'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  m.style.display = isOpen ? 'none' : 'flex';
}

function closePlayerMoreMenu() {
  const m = document.getElementById('pMoreMenu');
  if (m) m.style.display = 'none';
}

function shareWatchPartyLink() {
  if (!PV.videoId) return;
  const cur = Math.floor(PV.vid?.currentTime || 0);
  const showPart = PV.showId ? `&showId=${encodeURIComponent(PV.showId)}` : '';
  const url = `${location.origin}${location.pathname}#player/${encodeURIComponent(PV.videoId)}?t=${cur}&party=1${showPart}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      showToast(`🔗 Watch Party link copied (${fmtTime(cur)})!`);
    }).catch(() => {
      showToast(`🔗 Share URL: #player/${PV.videoId}?t=${cur}&party=1`);
    });
  } else {
    showToast(`🔗 Share URL: #player/${PV.videoId}?t=${cur}&party=1`);
  }
}

// ============================================================
// FULL-PAGE PLAYER LOGIC
// ============================================================
const PV = {}; // Player vars

async function initFullPagePlayer(videoId, showId, fromRutube) {
  const vid = document.getElementById('pvid');
  if (!vid) return;

  PV.vid = vid;
  PV.videoId = videoId;
  PV.showId = showId;
  PV.hls = null;
  PV.eps = [];
  PV.epIdx = -1;
  PV.nextEp = null;
  PV.subOffset = STATE.subtitleOffset || 0;
  PV.locked = false;
  PV.ctrlTimer = null;

  // Set volume/muted from state
  vid.volume = STATE.volume;
  vid.muted = STATE.muted;
  document.getElementById('pvVolSlider').value = STATE.volume;
  updateVolIconP();

  // Load episodes if showId provided
  if (showId) {
    try {
      const show = await api(`/api/series/${showId}`);
      PV.eps = show.episodes || [];
      PV.epIdx = PV.eps.findIndex(e => e.id === videoId);
      if (PV.eps.length > 1) {
        renderPlayerSidebar();
        document.getElementById('pvEpBtn').style.display = 'flex';
        document.getElementById('pvEpBtnB').style.display = 'flex';
      }
    } catch(e) {}
  }

  // Set titles
  await loadAndPlayVideo(videoId);

  // Events
  initPlayerEvents();
  initTapZones();
  document.getElementById('pvCtrl').addEventListener('mousemove', showCtrl);
  document.getElementById('pvCtrl').addEventListener('touchstart', showCtrl, {passive:true});
  document.getElementById('pvCtrl').addEventListener('click', e => {
    if (e.target === document.getElementById('pvCtrl')) togglePlay();
  });
}

async function loadAndPlayVideo(videoId) {
  showPvLoader('Connecting to stream...');
  hidePvError();

  // Titles
  const ep = PV.eps.find(e=>e.id===videoId);
  if (ep) {
    const show = window.showData;
    document.getElementById('pvShowTitle').textContent = ep.showTitle || (show?.title) || ep.clean_title || ep.title;
    document.getElementById('pvEpTitle').textContent = `S${ep.season} E${ep.episode} · ${ep.episode_name||ep.clean_title||ep.title}`;
    document.title = `${ep.episode_name||ep.title} — SCANE`;
  }

  // Destroy old HLS
  destroyPvHls();

  try {
    const stream = await api(`/api/stream/${videoId}`);
    if (!stream.success || !stream.streamUrl) throw new Error(stream.error || 'No stream URL');

    PV.nextEp = stream.nextEpisode || null;
    PV.videoId = videoId;

    // Update titles from stream data if not from episodes
    if (!ep) {
      document.getElementById('pvShowTitle').textContent = stream.cleanTitle || stream.title || '';
      document.getElementById('pvEpTitle').textContent = stream.season ? `S${stream.season} E${stream.episode}` : '';
      document.title = `${stream.cleanTitle||stream.title} — SCANE`;
    }

    // Update next/prev
    updateNavBtns();

    // Attach subtitles & load interactive subtitle cues for this video
    attachPvSubtitles(stream.subtitleUrl);
    if (typeof attachSceneEnglishToPlayer === 'function') {
      attachSceneEnglishToPlayer(videoId, false);
    }

    // HLS
    const vid = PV.vid;
    if (Hls.isSupported()) {
      const resumePos = getResumePos(videoId);
      PV.hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 60,
        maxBufferLength: 30,
        startPosition: resumePos,
        debug: false,
      });
      PV.hls.loadSource(stream.streamUrl);
      PV.hls.attachMedia(vid);

      PV.hls.on(Hls.Events.MANIFEST_PARSED, (_, mdata) => {
        hidePvLoader();
        vid.volume = STATE.volume;
        vid.muted = STATE.muted;
        vid.playbackRate = STATE.speed;
        vid.play().then(() => setPlayIconP(false)).catch(() => setPlayIconP(true));
        // Re-apply subtitles after manifest
        setTimeout(() => applySubMode(), 300);
        highlightSidebarEp(videoId);
        // Populate quality levels
        buildQualityMenu(mdata?.levels || PV.hls.levels || []);
      });

      PV.hls.on(Hls.Events.ERROR, (ev, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR) {
          PV.hls.startLoad();
        } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
          PV.hls.recoverMediaError();
        } else {
          hidePvLoader();
          showPvError(`Stream error: ${d.details}`);
        }
      });

      PV.hls.on(Hls.Events.FRAG_LOADED, hidePvLoader);

    } else if (vid.canPlayType('application/vnd.apple.mpegurl')) {
      vid.src = stream.streamUrl;
      vid.addEventListener('loadedmetadata', () => {
        hidePvLoader();
        const rp = getResumePos(videoId);
        if (rp > 0) vid.currentTime = rp;
        vid.play().then(() => setPlayIconP(false)).catch(() => setPlayIconP(true));
      }, {once:true});
    } else {
      throw new Error('HLS not supported in this browser. Please use Chrome or Firefox.');
    }

  } catch(err) {
    hidePvLoader();
    showPvError(err.message);
  }
}

function attachPvSubtitles(subUrl) {
  const vid = PV.vid;
  // Remove existing tracks
  Array.from(vid.querySelectorAll('track')).forEach(t => t.remove());
  if (subUrl) {
    const tr = document.createElement('track');
    tr.kind = 'subtitles';
    tr.label = 'English';
    tr.srclang = 'en';
    tr.src = subUrl;
    tr.default = true;
    vid.appendChild(tr);
    PV.hasSubtitles = true;
    // Wait for track to load, then apply mode and offset
    tr.addEventListener('load', () => {
      applySubMode();
      if (STATE.subtitleOffset !== 0) applySubtitleOffset();
      buildTranscriptSidebar();
    });
    tr.addEventListener('error', () => {
      console.warn('[SUB] Track failed to load:', subUrl);
      PV.hasSubtitles = false;
      updateSubBtnP();
    });
  } else {
    PV.hasSubtitles = false;
  }
  applySubMode();
  updateSubBtnP();
}

function applySubMode() {
  const vid = PV.vid;
  if (!vid) return;
  // Always hide native browser cues because #seSubOverlay renders the single clickable English subtitle
  for (let i = 0; i < vid.textTracks.length; i++) {
    vid.textTracks[i].mode = 'hidden';
  }
  const seOverlay = document.getElementById('seSubOverlay');
  if (seOverlay) {
    seOverlay.style.display = STATE.subtitlesEnabled ? 'flex' : 'none';
  }
}

function updateSubBtnP() {
  const btn = document.getElementById('pvSubBtn');
  if (!btn) return;
  const on = STATE.subtitlesEnabled;
  btn.classList.toggle('active', on);
  btn.title = on ? 'Subtitles: ON (Click any word to translate)' : 'Subtitles: OFF';
}

function toggleSubtitles() {
  STATE.subtitlesEnabled = !STATE.subtitlesEnabled;
  applySubMode();
  updateSubBtnP();
  saveState();
  showToast(STATE.subtitlesEnabled ? '💬 Subtitles ON' : '🔇 Subtitles OFF');
}

// Subtitle offset (sync fix)
async function toggleSubOffsetPop() {
  const pop = document.getElementById('subOffsetPop');
  const open = pop.style.display === 'none';
  pop.style.display = open ? 'block' : 'none';
  updateSubOffsetLabel();
  if (open && PV.videoId) {
    const listEl = document.getElementById('subAltList');
    if (listEl && !listEl.dataset.loaded) {
      listEl.innerHTML = `<div style="font-size:11px;color:var(--text-d)">Loading subtitle tracks...</div>`;
      try {
        const d = await api(`/api/subtitle-list/${PV.videoId}`);
        const items = d.items || [];
        listEl.dataset.loaded = '1';
        if (!items.length) {
          listEl.innerHTML = `<div style="font-size:11px;color:var(--text-d)">No alternative tracks</div>`;
        } else {
          listEl.innerHTML = `<div style="font-size:10px;color:var(--text-d);text-transform:uppercase;margin-bottom:5px;font-weight:700">Switch Subtitle Track</div>` +
            items.map((s, idx) => `<button class="sub-alt-btn ${idx===0?'active':''}" onclick="switchSubtitleTrack('${esc(s.url)}',this)">${esc(s.label)}</button>`).join('');
        }
      } catch(e) {
        listEl.innerHTML = '';
      }
    }
  }
}

function switchSubtitleTrack(url, btn) {
  STATE.subtitleOffset = 0;
  PV.subOffset = 0;
  updateSubOffsetLabel();
  attachPvSubtitles(url);
  STATE.subtitlesEnabled = true;
  applySubMode();
  updateSubBtnP();
  document.querySelectorAll('.sub-alt-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  showToast('💬 Switched English subtitle track');
}

function toggleQualMenu() {
  const m = document.getElementById('pQualMenu');
  if (m) m.style.display = m.style.display === 'none' ? 'block' : 'none';
}

function buildQualityMenu(levels) {
  const list = document.getElementById('pQualList');
  if (!list) return;
  if (!levels || levels.length <= 1) {
    list.innerHTML = `<button class="active" onclick="setQualityLevel(-1,'Auto')">Auto (HD)</button>`;
    return;
  }
  const seen = new Set();
  const rows = [`<button class="active" data-q="-1" onclick="setQualityLevel(-1,'Auto')">Auto</button>`];
  levels.forEach((lv, i) => {
    const h = lv.height || 0;
    const label = h ? `${h}p` : `Level ${i+1}`;
    if (seen.has(label)) return;
    seen.add(label);
    rows.push(`<button data-q="${i}" onclick="setQualityLevel(${i},'${label}')">${label}${h>=1080?' <span class="normal-label">FHD</span>':h>=720?' <span class="normal-label">HD</span>':''}</button>`);
  });
  list.innerHTML = rows.join('');
}

function setQualityLevel(idx, label) {
  if (PV.hls) PV.hls.currentLevel = idx;
  const lbl = document.getElementById('pvQualLabel');
  if (lbl) lbl.textContent = label;
  const m = document.getElementById('pQualMenu');
  if (m) {
    m.style.display = 'none';
    m.querySelectorAll('button').forEach(b => b.classList.toggle('active', String(b.dataset.q) === String(idx)));
  }
  showToast(`🎬 Quality: ${label}`);
}

function takeVideoScreenshot() {
  const vid = PV.vid;
  if (!vid || !vid.videoWidth) { showToast('Video not ready'); return; }
  try {
    const c = document.createElement('canvas');
    c.width = vid.videoWidth;
    c.height = vid.videoHeight;
    c.getContext('2d').drawImage(vid, 0, 0, c.width, c.height);
    c.toBlob(blob => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `lumenflix-${PV.videoId}-${Math.round(vid.currentTime)}s.png`;
      a.click();
      showToast('📸 Frame saved!');
    });
  } catch(e) {
    showToast('Screenshot unavailable for this stream');
  }
}

// Interactive Transcript & Click-to-Translate Dictionary
function toggleTranscriptSidebar() {
  const sb = document.getElementById('pTranscript');
  if (!sb) return;
  sb.classList.toggle('open');
  if (sb.classList.contains('open')) buildTranscriptSidebar();
}

function buildTranscriptSidebar() {
  const list = document.getElementById('pTranscriptList');
  const vid = PV.vid;
  if (!list || !vid) return;
  const track = vid.textTracks && vid.textTracks[0];
  if (!track || !track.cues || !track.cues.length) {
    list.innerHTML = `<div style="padding:20px;color:var(--text-d);font-size:13px">No subtitle transcript available for this video.</div>`;
    return;
  }
  const cues = Array.from(track.cues);
  list.innerHTML = cues.map((c, idx) => {
    const clean = (c.text || '').replace(/<[^>]+>/g, '').trim();
    const words = clean.split(/\s+/).map(w => {
      const pure = w.replace(/[^a-zA-Z'-]/g, '');
      return pure.length > 2
        ? `<span class="tr-word" onclick="event.stopPropagation();lookupWord('${esc(pure)}')">${esc(w)}</span>`
        : esc(w);
    }).join(' ');
    return `<div class="tr-cue" id="trCue_${idx}" data-start="${c.startTime}" data-end="${c.endTime}" onclick="if(PV.vid)PV.vid.currentTime=${c.startTime}">
      <span class="tr-time">${fmtTime(c.startTime)}</span>
      <span class="tr-text">${words}</span>
    </div>`;
  }).join('');
}

function highlightTranscriptCue(curTime) {
  const sb = document.getElementById('pTranscript');
  if (!sb || !sb.classList.contains('open')) return;
  const rows = sb.querySelectorAll('.tr-cue');
  let activeEl = null;
  rows.forEach(r => {
    const s = parseFloat(r.dataset.start), e = parseFloat(r.dataset.end);
    const on = curTime >= s && curTime <= e;
    r.classList.toggle('active', on);
    if (on) activeEl = r;
  });
  if (activeEl && PV._lastTrActive !== activeEl) {
    PV._lastTrActive = activeEl;
    activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

async function lookupWord(word) {
  const pop = document.getElementById('dictPopup');
  if (!pop) return;
  if (PV.vid && !PV.vid.paused) PV.vid.pause();
  pop.style.display = 'block';
  pop.innerHTML = `<div class="dict-head"><strong>${esc(word)}</strong><button onclick="document.getElementById('dictPopup').style.display='none'"><i class="fa-solid fa-xmark"></i></button></div><div class="dict-body">Looking up definition...</div>`;
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`);
    const data = await res.json();
    if (!Array.isArray(data) || !data[0]) throw new Error('No entry');
    const entry = data[0];
    const phonetic = entry.phonetic || (entry.phonetics?.find(p => p.text)?.text) || '';
    const meanings = (entry.meanings || []).slice(0, 2).map(m => {
      const def = m.definitions?.[0]?.definition || '';
      const ex = m.definitions?.[0]?.example || '';
      return `<div class="dict-meaning"><span class="dict-pos">${esc(m.partOfSpeech)}</span> ${esc(def)}${ex ? `<div class="dict-ex">"${esc(ex)}"</div>` : ''}</div>`;
    }).join('');
    pop.innerHTML = `<div class="dict-head"><div><strong>${esc(entry.word)}</strong> <span class="dict-phon">${esc(phonetic)}</span></div><button onclick="document.getElementById('dictPopup').style.display='none'"><i class="fa-solid fa-xmark"></i></button></div><div class="dict-body">${meanings}</div>`;
  } catch (e) {
    pop.innerHTML = `<div class="dict-head"><strong>${esc(word)}</strong><button onclick="document.getElementById('dictPopup').style.display='none'"><i class="fa-solid fa-xmark"></i></button></div><div class="dict-body">No dictionary definition found for "${esc(word)}".</div>`;
  }
}

// Audio Boost / Night Dialogue Mode (Web Audio API)
function toggleAudioBoost() {
  const vid = PV.vid;
  if (!vid) return;
  const levels = [1, 1.8, 2.6];
  PV.boostIdx = ((PV.boostIdx || 0) + 1) % levels.length;
  const gainVal = levels[PV.boostIdx];
  try {
    if (!vid._audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaElementSource(vid);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -28;
      comp.knee.value = 30;
      comp.ratio.value = 8;
      const gain = ctx.createGain();
      src.connect(comp);
      comp.connect(gain);
      gain.connect(ctx.destination);
      vid._audioCtx = ctx;
      vid._gainNode = gain;
    }
    if (vid._audioCtx.state === 'suspended') vid._audioCtx.resume();
    vid._gainNode.gain.value = gainVal;
  } catch (e) {}
  const lbl = document.getElementById('pvBoostLabel');
  const btn = document.getElementById('pvBoostBtn');
  if (lbl) lbl.textContent = `${Math.round(gainVal * 100)}%`;
  if (btn) btn.classList.toggle('active', gainVal > 1);
  showToast(gainVal > 1 ? `🔊 Night Dialogue Boost: ${Math.round(gainVal * 100)}%` : '🔊 Audio Boost: Normal (100%)');
}

// Ambient Cinema Glow Mode
function toggleAmbientMode() {
  PV.ambientOn = !PV.ambientOn;
  const c = document.getElementById('pvAmbient');
  const btn = document.getElementById('pvAmbientBtn');
  if (btn) btn.classList.toggle('active', PV.ambientOn);
  if (c) c.classList.toggle('active', PV.ambientOn);
  clearInterval(PV.ambientTimer);
  if (PV.ambientOn && c && PV.vid) {
    c.width = 64; c.height = 36;
    const ctx = c.getContext('2d');
    PV.ambientTimer = setInterval(() => {
      if (PV.vid && !PV.vid.paused) {
        try { ctx.drawImage(PV.vid, 0, 0, 64, 36); } catch(e) {}
      }
    }, 180);
  }
  showToast(PV.ambientOn ? '✨ Ambient Cinema Glow ON' : 'Ambient Glow OFF');
}

// A-B Scene Loop (great for repeating English dialogue)
function toggleAbLoop() {
  const vid = PV.vid;
  if (!vid) return;
  const lbl = document.getElementById('pvLoopLabel');
  const btn = document.getElementById('pvLoopBtn');
  if (PV.loopA == null) {
    PV.loopA = vid.currentTime;
    PV.loopB = null;
    if (lbl) lbl.textContent = 'A';
    if (btn) btn.classList.add('active');
    showToast(`🔁 Loop Start (A) set at ${fmtTime(PV.loopA)}`);
  } else if (PV.loopB == null) {
    PV.loopB = Math.max(PV.loopA + 2, vid.currentTime);
    if (lbl) lbl.textContent = 'A-B';
    showToast(`🔁 Looping ${fmtTime(PV.loopA)} → ${fmtTime(PV.loopB)}`);
  } else {
    PV.loopA = null;
    PV.loopB = null;
    if (lbl) lbl.textContent = '';
    if (btn) btn.classList.remove('active');
    showToast('🔁 A-B Loop cleared');
  }
}

// Sleep Timer
function cycleSleepTimer() {
  const mins = [0, 15, 30, 60];
  PV.sleepIdx = ((PV.sleepIdx || 0) + 1) % mins.length;
  const m = mins[PV.sleepIdx];
  clearTimeout(PV.sleepTimer);
  const lbl = document.getElementById('pvSleepLabel');
  const btn = document.getElementById('pvSleepBtn');
  if (lbl) lbl.textContent = m ? `${m}m` : '';
  if (btn) btn.classList.toggle('active', m > 0);
  if (m > 0) {
    PV.sleepTimer = setTimeout(() => {
      if (PV.vid && !PV.vid.paused) PV.vid.pause();
      showToast('🌙 Sleep timer paused playback');
    }, m * 60000);
    showToast(`🌙 Sleep timer set for ${m} minutes`);
  } else {
    showToast('🌙 Sleep timer OFF');
  }
}

function adjustSubOffset(delta) {
  STATE.subtitleOffset = Math.round((STATE.subtitleOffset + delta) * 10) / 10;
  PV.subOffset = STATE.subtitleOffset;
  applySubtitleOffset();
  updateSubOffsetLabel();
  showToast(`⏱ Subtitle offset: ${STATE.subtitleOffset >= 0 ? '+' : ''}${STATE.subtitleOffset.toFixed(1)}s`);
}

function resetSubOffset() {
  STATE.subtitleOffset = 0;
  PV.subOffset = 0;
  applySubtitleOffset();
  updateSubOffsetLabel();
  showToast('⏱ Subtitle offset reset');
}

function updateSubOffsetLabel() {
  const el = document.getElementById('subOffsetVal');
  if (el) el.textContent = `${STATE.subtitleOffset >= 0 ? '+' : ''}${STATE.subtitleOffset.toFixed(1)}s`;
}

function applySubtitleOffset() {
  // WebVTT cue timing adjustment via textTrack cues
  const vid = PV.vid;
  if (!vid) return;
  for (let t = 0; t < vid.textTracks.length; t++) {
    const track = vid.textTracks[t];
    if (!track.cues || track.cues.length === 0) continue;
    // Store original times on first adjustment
    if (!track._originalCues) {
      track._originalCues = Array.from(track.cues).map(c => ({
        id: c.id, start: c.startTime, end: c.endTime
      }));
    }
    const offset = STATE.subtitleOffset;
    const cues = Array.from(track.cues);
    const origCues = track._originalCues;
    for (let i = 0; i < cues.length; i++) {
      const orig = origCues[i];
      if (orig) {
        cues[i].startTime = Math.max(0, orig.start + offset);
        cues[i].endTime = Math.max(0, orig.end + offset);
      }
    }
  }
}

function destroyPvHls() {
  if (PV.hls) { try { PV.hls.destroy(); } catch(e) {} PV.hls = null; }
  clearInterval(PV.ambientTimer);
  clearTimeout(PV.sleepTimer);
  PV.loopA = null; PV.loopB = null;
  const vid = PV.vid;
  if (!vid) return;
  vid.pause();
  vid.removeAttribute('src');
  while (vid.firstChild) vid.removeChild(vid.firstChild);
  vid.load();
  setPlayIconP(true);
}

function closePlayerPage() {
  savePvProgress();
  destroyPvHls();
  if (document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  document.getElementById('navbar').style.display = '';
  window.showData = null;
  history.back();
}

function retryPlayer() {
  if (PV.videoId) loadAndPlayVideo(PV.videoId);
}

// ============================================================
// PLAYER EVENTS
// ============================================================
function initPlayerEvents() {
  const vid = PV.vid;
  vid.addEventListener('timeupdate', onPvTime);
  vid.addEventListener('progress', onPvProgress);
  vid.addEventListener('ended', onPvEnded);
  vid.addEventListener('waiting', () => showPvLoader('Buffering...'));
  vid.addEventListener('playing', hidePvLoader);
  vid.addEventListener('canplay', hidePvLoader);
  vid.addEventListener('pause', () => setPlayIconP(true));
  vid.addEventListener('play', () => setPlayIconP(false));

  // Scrubber with Live Subtitle Cue Preview
  const scrub = document.getElementById('pvScrub');
  let dragging = false;
  scrub.addEventListener('mousedown', e => { dragging = true; doScrub(e); });
  scrub.addEventListener('mousemove', e => {
    const rect = scrub.getBoundingClientRect();
    const pct = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const tip = document.getElementById('pvTip');
    if (vid.duration) {
      const hoverSec = pct * vid.duration;
      const tStr = fmtTime(hoverSec);
      let cueSnippet = '';
      if (typeof getSubtitleSnippetAtTime === 'function') {
        cueSnippet = getSubtitleSnippetAtTime(hoverSec);
      }
      if (cueSnippet) {
        tip.innerHTML = `<div class="pv-tip-time">${tStr}</div><div class="pv-tip-cue">"${esc(cueSnippet)}"</div>`;
      } else {
        tip.textContent = tStr;
      }
      tip.style.left = `${pct*100}%`;
      tip.style.display = 'block';
    }
    if (dragging) doScrub(e);
  });
  scrub.addEventListener('mouseleave', () => document.getElementById('pvTip').style.display = 'none');
  scrub.addEventListener('click', doScrub);
  document.addEventListener('mousemove', e => { if (dragging) doScrub(e); });
  document.addEventListener('mouseup', () => dragging = false);

  // Touch scrub
  scrub.addEventListener('touchstart', e => { e.preventDefault(); dragging=true; doScrubT(e); }, {passive:false});
  document.addEventListener('touchmove', e => { if(dragging) doScrubT(e); }, {passive:true});
  document.addEventListener('touchend', () => dragging=false);

  // Volume
  document.getElementById('pvVolSlider').addEventListener('input', e => {
    STATE.volume = parseFloat(e.target.value);
    vid.volume = STATE.volume;
    STATE.muted = STATE.volume === 0;
    vid.muted = STATE.muted;
    updateVolIconP();
    saveState();
  });

  // Keyboard
  document.addEventListener('keydown', handlePlayerKeys);

  // Fullscreen change
  document.addEventListener('fullscreenchange', () => {
    const ic = document.getElementById('pvFsIcon');
    if (ic) ic.className = document.fullscreenElement ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
  });
}

function doScrub(e) {
  const rect = document.getElementById('pvScrub').getBoundingClientRect();
  const pct = clamp((e.clientX - rect.left) / rect.width, 0, 1);
  if (PV.vid.duration) PV.vid.currentTime = pct * PV.vid.duration;
}
function doScrubT(e) {
  const rect = document.getElementById('pvScrub').getBoundingClientRect();
  const pct = clamp((e.touches[0].clientX - rect.left) / rect.width, 0, 1);
  if (PV.vid.duration) PV.vid.currentTime = pct * PV.vid.duration;
}

let _lastSaveT = 0;
function onPvTime() {
  const vid = PV.vid;
  const cur = vid.currentTime || 0;
  const dur = vid.duration || 0;
  const ct = document.getElementById('pvCurTime');
  const dt = document.getElementById('pvDur');
  const fill = document.getElementById('pvFill');
  const thumb = document.getElementById('pvThumb');
  if (ct) ct.textContent = fmtTime(cur);
  if (dt) dt.textContent = fmtTime(dur);
  if (dur > 0) {
    const p = (cur/dur)*100;
    if (fill) fill.style.width = `${p}%`;
    if (thumb) thumb.style.left = `${p}%`;
  }
  // Auto-save progress every 8s
  const now = Date.now();
  if (cur > 5 && now - _lastSaveT > 8000) { savePvProgress(); _lastSaveT = now; }
  // Skip intro button (shown between 10s and 85s if enabled)
  const sk = document.getElementById('pvSkipIntro');
  if (sk) {
    const showSkip = STATE.skipIntro !== false && dur > 600 && cur >= 10 && cur <= 85;
    sk.style.display = showSkip ? 'inline-flex' : 'none';
  }
  // Next ep banner at 90%
  const nb = document.getElementById('pvNextBanner');
  if (PV.nextEp && dur > 0 && cur/dur > 0.9 && nb && nb.style.display === 'none') {
    const nt = document.getElementById('pvNextTitle');
    if (nt) nt.textContent = PV.nextEp.clean_title || PV.nextEp.title;
    nb.style.display = 'flex';
  }

  // Apply subtitle offset if cues just loaded
  if (STATE.subtitleOffset !== 0) applySubtitleOffset();

  // A-B Loop check
  if (PV.loopA != null && PV.loopB != null && cur >= PV.loopB) {
    vid.currentTime = PV.loopA;
  }

  // Highlight active transcript cue
  highlightTranscriptCue(cur);

  // Scene English interactive subtitle & loop sync
  if (typeof onSePlayerTimeUpdate === 'function') {
    onSePlayerTimeUpdate(cur);
  }
}

function onPvProgress() {
  const vid = PV.vid;
  if (!vid.duration || !vid.buffered.length) return;
  const buf = vid.buffered.end(vid.buffered.length-1);
  const el = document.getElementById('pvBuf');
  if (el) el.style.width = `${(buf/vid.duration)*100}%`;
}

function onPvEnded() {
  setPlayIconP(true);
  if (PV.nextEp && STATE.autoplay !== false) {
    showToast('▶ Loading next episode...');
    setTimeout(playNextEp, 1800);
  }
}

function togglePlay() {
  if (PV.locked) return;
  const vid = PV.vid;
  if (!vid) return;
  if (vid.paused) { vid.play().catch(()=>{}); flashCenterIcon('fa-play'); }
  else { vid.pause(); flashCenterIcon('fa-pause'); }
  showCtrl();
}

function flashCenterIcon(icon) {
  const f = document.getElementById('pvFlash');
  const ic = document.getElementById('pvFlashIcon');
  if (!f || !ic) return;
  ic.className = `fa-solid ${icon}`;
  f.style.display = 'flex';
  f.classList.remove('pop');
  void f.offsetWidth;
  f.classList.add('pop');
  clearTimeout(f._t);
  f._t = setTimeout(() => { f.style.display = 'none'; }, 520);
}

function setPlayIconP(paused) {
  const ic = document.getElementById('pvPlayIcon');
  if (ic) {
    ic.className = paused ? 'fa-solid fa-play' : 'fa-solid fa-pause';
    ic.style.marginLeft = paused ? '2px' : '0';
  }
}

function seekBy(s) {
  if (!PV.vid || PV.locked) return;
  PV.vid.currentTime = clamp(PV.vid.currentTime + s, 0, PV.vid.duration || 0);
  showCtrl();
}

function toggleMuteP() {
  STATE.muted = !STATE.muted;
  PV.vid.muted = STATE.muted;
  if (!STATE.muted && STATE.volume === 0) { STATE.volume = 0.5; PV.vid.volume = 0.5; }
  document.getElementById('pvVolSlider').value = STATE.muted ? 0 : STATE.volume;
  updateVolIconP();
  saveState();
}

function updateVolIconP() {
  const ic = document.getElementById('pvVolIcon');
  if (!ic) return;
  const muted = STATE.muted || PV.vid?.muted || PV.vid?.volume === 0;
  ic.className = muted ? 'fa-solid fa-volume-xmark' : (STATE.volume < 0.4 ? 'fa-solid fa-volume-low' : 'fa-solid fa-volume-high');
}

function toggleLock() {
  PV.locked = !PV.locked;
  STATE.isLocked = PV.locked;
  const ic = document.getElementById('pvLockIcon');
  if (ic) ic.className = PV.locked ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open';
  const ctrl = document.getElementById('pvCtrl');
  if (ctrl) ctrl.classList.toggle('locked', PV.locked);
  showToast(PV.locked ? '🔒 Controls locked' : '🔓 Controls unlocked');
}

function toggleFullscreen() {
  const page = document.getElementById('playerPage');
  if (!document.fullscreenElement) {
    (page || document.documentElement).requestFullscreen().catch(()=>{});
  } else {
    document.exitFullscreen().catch(()=>{});
  }
}

function togglePiP() {
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(()=>{});
  } else if (PV.vid?.requestPictureInPicture) {
    PV.vid.requestPictureInPicture().catch(() => showToast('PiP not supported'));
  }
}

function toggleSpeedMenu() {
  const m = document.getElementById('pSpeedMenu');
  if (m) m.style.display = m.style.display === 'none' ? 'block' : 'none';
}

function setSpeed(s) {
  STATE.speed = s;
  if (PV.vid) PV.vid.playbackRate = s;
  const lbl = document.getElementById('pvSpeedLabel');
  if (lbl) lbl.textContent = `${s}x`;
  const m = document.getElementById('pSpeedMenu');
  if (m) {
    m.style.display = 'none';
    m.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.textContent.startsWith(String(s))));
  }
  showToast(`⚡ Speed: ${s}x`);
}

// Controls auto-hide
function showCtrl() {
  if (PV.locked) return;
  const ctrl = document.getElementById('pvCtrl');
  if (ctrl) ctrl.classList.remove('hidden');
  clearTimeout(PV.ctrlTimer);
  if (PV.vid && !PV.vid.paused) {
    PV.ctrlTimer = setTimeout(() => {
      const sb = document.getElementById('pSidebar');
      const sm = document.getElementById('pSpeedMenu');
      if (!sb?.classList.contains('open') && sm?.style.display === 'none') {
        ctrl?.classList.add('hidden');
      }
    }, 3200);
  }
}

// Episode navigation
function renderPlayerSidebar() {
  const list = document.getElementById('pSidebarList');
  if (!list || !PV.eps.length) return;
  list.innerHTML = PV.eps.map((ep, i) => {
    const isActive = ep.id === PV.videoId;
    const hist = STATE.watchHistory[ep.id];
    const pct = hist && ep.duration_min ? Math.min(100, hist.pos/(ep.duration_min*60)*100).toFixed(0) : 0;
    return `<div class="sb-ep-item ${isActive?'active':''}" id="sbep_${ep.id}"
               onclick="switchEpFromSidebar(${i})">
      <div class="sb-ep-thumb">
        <img src="${esc(ep.episode_still||ep.poster||'')}" alt="" loading="lazy" onerror="this.style.display='none'">
        <div class="sb-ep-progress"><div class="sb-ep-progress-fill" style="width:${isActive?'45':pct}%"></div></div>
      </div>
      <div class="sb-ep-info">
        <div class="sb-ep-num">S${ep.season} E${ep.episode}</div>
        <div class="sb-ep-title">${esc(ep.episode_name||ep.clean_title||`Episode ${ep.episode}`)}</div>
        ${ep.duration_min?`<div class="sb-ep-dur">${Math.round(ep.duration_min)} min</div>`:''}
      </div>
    </div>`;
  }).join('');
  highlightSidebarEp(PV.videoId);
}

function highlightSidebarEp(id) {
  document.querySelectorAll('.sb-ep-item').forEach(el => {
    el.classList.toggle('active', el.id === `sbep_${id}`);
  });
  // Scroll active into view
  const active = document.getElementById(`sbep_${id}`);
  if (active) active.scrollIntoView({block:'center', behavior:'smooth'});
}

function switchEpFromSidebar(idx) {
  savePvProgress();
  const ep = PV.eps[idx];
  if (!ep) return;
  PV.epIdx = idx;
  loadAndPlayVideo(ep.id);
}

function playNextEp() {
  const nb = document.getElementById('pvNextBanner');
  if (nb) nb.style.display = 'none';
  if (PV.nextEp) {
    const idx = PV.eps.findIndex(e => e.id === PV.nextEp.id);
    if (idx >= 0) switchEpFromSidebar(idx);
    else { PV.epIdx = -1; loadAndPlayVideo(PV.nextEp.id); }
  }
}

function playPrevEp() {
  const prevIdx = PV.epIdx > 0 ? PV.epIdx - 1 : -1;
  if (prevIdx >= 0) switchEpFromSidebar(prevIdx);
}

function updateNavBtns() {
  const prevBtn = document.getElementById('pvPrevBtn');
  const nextBtn = document.getElementById('pvNextBtn');
  const hasPrev = PV.epIdx > 0;
  const hasNext = !!PV.nextEp;
  if (prevBtn) { prevBtn.style.opacity = hasPrev ? '1' : '0.3'; prevBtn.style.pointerEvents = hasPrev ? 'auto' : 'none'; }
  if (nextBtn) { nextBtn.style.opacity = hasNext ? '1' : '0.3'; nextBtn.style.pointerEvents = hasNext ? 'auto' : 'none'; }
}

// Save progress
function savePvProgress() {
  if (!PV.vid || !PV.videoId) return;
  const pos = PV.vid.currentTime || 0;
  const dur = PV.vid.duration || 0;
  if (pos > 5) {
    STATE.watchHistory[PV.videoId] = {pos, dur, ts: Date.now()};
    saveState();
  }
}

// Keyboard
function handlePlayerKeys(e) {
  const pp = document.getElementById('playerPage');
  if (!pp) return;
  if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  switch(e.key) {
    case ' ': case 'k': e.preventDefault(); togglePlay(); showCtrl(); break;
    case '[':
      e.preventDefault();
      if (typeof seekToAdjacentCue === 'function') seekToAdjacentCue(-1);
      break;
    case ']':
      e.preventDefault();
      if (typeof seekToAdjacentCue === 'function') seekToAdjacentCue(1);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (e.shiftKey && typeof seekToAdjacentCue === 'function') seekToAdjacentCue(-1);
      else { seekBy(-10); showCtrl(); }
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (e.shiftKey && typeof seekToAdjacentCue === 'function') seekToAdjacentCue(1);
      else { seekBy(10); showCtrl(); }
      break;
    case 'ArrowUp': e.preventDefault();
      STATE.volume = clamp(STATE.volume + 0.1, 0, 1);
      if (PV.vid) PV.vid.volume = STATE.volume;
      const vs = document.getElementById('pvVolSlider');
      if (vs) vs.value = STATE.volume;
      updateVolIconP();
      showToast(`🔊 Volume: ${Math.round(STATE.volume*100)}%`);
      break;
    case 'ArrowDown': e.preventDefault();
      STATE.volume = clamp(STATE.volume - 0.1, 0, 1);
      if (PV.vid) PV.vid.volume = STATE.volume;
      const vs2 = document.getElementById('pvVolSlider');
      if (vs2) vs2.value = STATE.volume;
      updateVolIconP();
      showToast(`🔊 Volume: ${Math.round(STATE.volume*100)}%`);
      break;
    case 'f': case 'F': e.preventDefault(); toggleFullscreen(); break;
    case 'm': case 'M': e.preventDefault(); toggleMuteP(); break;
    case 'c': case 'C': e.preventDefault(); toggleSubtitles(); break;
    case 'n': case 'N': e.preventDefault(); playNextEp(); break;
    case 'p': case 'P': e.preventDefault(); playPrevEp(); break;
    case '?': {
      const kb = document.getElementById('kbShortcuts');
      if (kb) kb.style.display = kb.style.display === 'none' ? 'flex' : 'none';
      break;
    }
    case 'Escape': {
      const sp = document.getElementById('pSpeedMenu');
      const sop = document.getElementById('subOffsetPop');
      const kb = document.getElementById('kbShortcuts');
      if (kb?.style.display !== 'none') { kb.style.display = 'none'; }
      else if (sp?.style.display !== 'none') { sp.style.display = 'none'; }
      else if (sop?.style.display !== 'none') { sop.style.display = 'none'; }
      else closePlayerPage();
      break;
    }
  }
}

// Tap zones
function initTapZones() {
  const tl = document.getElementById('ptapL');
  const tr_el = document.getElementById('ptapR');
  const tc = document.getElementById('ptapC');
  if (!tl) return;

  let ltap = 0, rtap = 0, ctap = 0;

  // Left zone: double tap = -10s, single tap = show controls
  tl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (PV.locked) { showToast('🔒 Controls locked'); return; }
    const now = Date.now();
    if (now - ltap < 350) {
      seekBy(-10);
      showPill(document.getElementById('tpL'));
    } else {
      showCtrl();
    }
    ltap = now;
  });

  // Right zone: double tap = +10s, single tap = show controls
  tr_el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (PV.locked) { showToast('🔒 Controls locked'); return; }
    const now = Date.now();
    if (now - rtap < 350) {
      seekBy(10);
      showPill(document.getElementById('tpR'));
    } else {
      showCtrl();
    }
    rtap = now;
  });

  // Center zone: single tap = toggle play, double tap = fullscreen
  tc.addEventListener('click', (e) => {
    e.stopPropagation();
    if (PV.locked) { showToast('🔒 Controls locked'); return; }
    const now = Date.now();
    if (now - ctap < 350) {
      toggleFullscreen();
    } else {
      togglePlay();
      showCtrl();
    }
    ctap = now;
  });
}

function showPill(el) {
  if (!el) return;
  el.style.display = 'flex';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 700);
}

// PV Loader helpers
function showPvLoader(msg) {
  const l = document.getElementById('pvLoader');
  const lt = document.getElementById('pvLoaderText');
  if (l) l.style.display = 'flex';
  if (lt) lt.textContent = msg||'Loading...';
}
function hidePvLoader() {
  const l = document.getElementById('pvLoader');
  if (l) l.style.display = 'none';
}
function showPvError(msg) {
  const e = document.getElementById('pvError');
  const et = document.getElementById('pvErrorText');
  if (e) e.style.display = 'flex';
  if (et) et.textContent = msg||'Stream unavailable';
}
function hidePvError() {
  const e = document.getElementById('pvError');
  if (e) e.style.display = 'none';
}

// ============================================================
// BROWSE PAGE (Infinite Scroll)
// ============================================================
async function renderBrowsePage(params = {}) {
  document.title = 'Browse — SCANE';
  STATE.browse = {
    page:1, loading:false, done:false,
    cat: params.cat || (params.q ? 'all' : 'all'),
    genre: params.genre || '',
    q: params.q || '',
    sort: params.sort || 'default',
    decade: params.decade || '',
    minRating: params.minRating || '',
    maxDur: params.maxDur || ''
  };
  if (STATE.browseObserver) { STATE.browseObserver.disconnect(); STATE.browseObserver = null; }

  const genres = ['Action','Animation','Sci-Fi','Comedy','Crime','Drama','Thriller','Horror','Adventure','Mystery','Family'];
  const cats = [{v:'all',l:'All'},{v:'movies',l:'Movies'},{v:'series',l:'TV Series'}];

  setMain(`<div class="browse-page">
    <div class="browse-filter-bar">
      <div class="filter-tabs">
        ${cats.map(c=>`<button class="filter-tab ${STATE.browse.cat===c.v?'active':''}"
          onclick="setBrowseFilter('cat','${c.v}',this)">${c.l}</button>`).join('')}
      </div>
      <div class="genre-filter-pills">
        ${genres.map(g=>`<button class="genre-pill ${STATE.browse.genre===g.toLowerCase()?'active':''}"
          onclick="setBrowseFilter('genre','${g.toLowerCase()}',this)">${g}</button>`).join('')}
      </div>
      <div class="browse-selects-wrap" style="display:flex;gap:8px;flex-wrap:wrap">
        <select class="sort-select" onchange="setBrowseFilter('decade',this.value,null)">
          <option value="">All Eras</option>
          <option value="2020s" ${STATE.browse.decade==='2020s'?'selected':''}>2020s</option>
          <option value="2010s" ${STATE.browse.decade==='2010s'?'selected':''}>2010s</option>
          <option value="2000s" ${STATE.browse.decade==='2000s'?'selected':''}>2000s</option>
          <option value="classic" ${STATE.browse.decade==='classic'?'selected':''}>Classic (&lt;2000)</option>
        </select>
        <select class="sort-select" onchange="setBrowseFilter('minRating',this.value,null)">
          <option value="">Any Rating</option>
          <option value="7" ${STATE.browse.minRating==='7'?'selected':''}>⭐ 7.0+ Good</option>
          <option value="8" ${STATE.browse.minRating==='8'?'selected':''}>⭐ 8.0+ Great</option>
          <option value="8.5" ${STATE.browse.minRating==='8.5'?'selected':''}>⭐ 8.5+ Masterpiece</option>
        </select>
        <select class="sort-select" onchange="setBrowseFilter('maxDur',this.value,null)">
          <option value="">Any Runtime</option>
          <option value="90" ${STATE.browse.maxDur==='90'?'selected':''}>&lt; 90 min</option>
          <option value="120" ${STATE.browse.maxDur==='120'?'selected':''}>&lt; 2 hours</option>
        </select>
        <select class="sort-select" id="sortSel" onchange="setBrowseFilter('sort',this.value,null)">
          <option value="default" ${STATE.browse.sort==='default'?'selected':''}>Sort: Default</option>
          <option value="rating" ${STATE.browse.sort==='rating'?'selected':''}>Top Rated</option>
          <option value="year" ${STATE.browse.sort==='year'?'selected':''}>Newest</option>
          <option value="alpha" ${STATE.browse.sort==='alpha'?'selected':''}>A – Z</option>
        </select>
      </div>
    </div>
    <div class="browse-content">
      ${STATE.browse.q ? `<div class="browse-query-title">Results for "<span>${esc(STATE.browse.q)}</span>"</div>` : ''}
      <div class="results-count" id="bCount"></div>
      <div class="browse-grid" id="bGrid"></div>
      <div id="bOnlineWrap" style="margin-top:32px"></div>
      <div class="browse-loader" id="bLoader" style="display:none">
        <div class="spinner-ring-lg"></div> Loading more...
      </div>
      <div id="bSentinel"></div>
    </div>
    ${buildFooter()}
  </div>`);

  await loadMoreBrowse();

  const sentinel = document.getElementById('bSentinel');
  if (sentinel) {
    STATE.browseObserver = new IntersectionObserver(ents => {
      if (ents[0].isIntersecting) loadMoreBrowse();
    }, {rootMargin:'300px', threshold:0.01});
    STATE.browseObserver.observe(sentinel);
  }
}

async function loadMoreBrowse() {
  if (STATE.browse.loading || STATE.browse.done) return;
  STATE.browse.loading = true;
  const loader = document.getElementById('bLoader');
  if (loader) loader.style.display = 'flex';
  const {page,cat,genre,q,sort,decade,minRating,maxDur} = STATE.browse;
  try {
    let url = `/api/movies?page=${page}&limit=28&category=${cat}`;
    if (genre) url += `&genre=${encodeURIComponent(genre)}`;
    if (q) url += `&q=${encodeURIComponent(q)}`;
    if (decade) url += `&decade=${encodeURIComponent(decade)}`;
    if (minRating) url += `&minRating=${encodeURIComponent(minRating)}`;
    if (maxDur) url += `&maxDur=${encodeURIComponent(maxDur)}`;
    if (STATE.kidsMode) url += `&kids=1`;
    let data = await api(url);
    let items = data.items || [];
    if (sort === 'rating') items = [...items].sort((a,b)=>(b.rating||0)-(a.rating||0));
    else if (sort === 'year') items = [...items].sort((a,b)=>(String(b.year||0)).localeCompare(String(a.year||0)));
    else if (sort === 'alpha') items = [...items].sort((a,b)=>a.title.localeCompare(b.title));

    const grid = document.getElementById('bGrid');
    const count = document.getElementById('bCount');
    if (page === 1 && count) count.textContent = `${data.total} title${data.total!==1?'s':''} found`;
    if (grid) items.forEach(m => { const d=document.createElement('div'); d.innerHTML=buildCard(m); grid.appendChild(d.firstElementChild); });

    // When searching by query, also display online catalog matches that can be verified & played on-demand
    if (page === 1 && q) {
      const onlineWrap = document.getElementById('bOnlineWrap');
      if (onlineWrap) {
        api(`/api/online-search?q=${encodeURIComponent(q)}`).then(rt => {
          const online = (rt.items || []).filter(o => !o.in_library && !items.some(l => String(l.tmdb_id) === String(o.tmdb_id)));
          if (!online.length) return;
          const ph = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=300&q=60';
          onlineWrap.innerHTML = `
            <div class="section-head" style="padding:0 0 14px"><h2 class="section-title"><i class="fa-solid fa-cloud-arrow-down" style="color:var(--red)"></i> Available <span>Online</span> (${online.length})</h2></div>
            <div class="browse-grid">${online.map(c => `
              <div class="movie-card" onclick='resolveAndPlayOnline(${JSON.stringify({type:c.type,tmdb_id:c.tmdb_id,title:c.title,is_series:c.is_series}).replace(/'/g,"&#39;")})'>
                <div class="card-poster">
                  <img src="${esc(c.poster||ph)}" alt="${esc(c.title)}" loading="lazy" onerror="this.onerror=null;this.src='${ph}'">
                  <div class="card-badge badge-new">${c.is_series ? 'SERIES' : 'MOVIE'}</div>
                  ${c.rating ? `<div class="card-rating"><i class="fa-solid fa-star"></i> ${Number(c.rating).toFixed(1)}</div>` : ''}
                  <div class="card-overlay"><div class="card-play-btn"><i class="fa-solid fa-play"></i></div></div>
                </div>
                <div class="card-info">
                  <div class="card-title">${esc(c.title)}</div>
                  <div class="card-sub"><span>${c.year || ''}</span><span style="color:#60a5fa">· Stream Online</span></div>
                </div>
              </div>
            `).join('')}</div>`;
        }).catch(() => {});
      }
    }
    STATE.browse.page++;
    STATE.browse.loading = false;
    if (loader) loader.style.display = 'none';
    if (!items.length || items.length < 28 || STATE.browse.page > data.totalPages) {
      STATE.browse.done = true;
      if (STATE.browseObserver) { STATE.browseObserver.disconnect(); STATE.browseObserver = null; }
    }
  } catch(e) {
    STATE.browse.loading = false;
    if (loader) loader.style.display = 'none';
  }
}

function setBrowseFilter(key, val, btn) {
  if (key==='genre' && STATE.browse.genre===val) {
    STATE.browse.genre = '';
    document.querySelectorAll('.genre-pill').forEach(p=>p.classList.remove('active'));
    resetBrowse(); return;
  }
  STATE.browse[key] = val;
  if (key==='cat') { document.querySelectorAll('.filter-tab').forEach(t=>t.classList.remove('active')); if(btn) btn.classList.add('active'); }
  if (key==='genre') { document.querySelectorAll('.genre-pill').forEach(p=>p.classList.remove('active')); if(btn) btn.classList.add('active'); }
  resetBrowse();
}

function resetBrowse() {
  const grid = document.getElementById('bGrid');
  const count = document.getElementById('bCount');
  if (grid) grid.innerHTML = '';
  if (count) count.textContent = '';
  STATE.browse.page = 1; STATE.browse.done = false; STATE.browse.loading = false;
  loadMoreBrowse();
}

// ============================================================
// WATCHLIST
// ============================================================
function toggleWL(item) {
  const idx = STATE.watchlist.findIndex(x=>x.id===item.id);
  if (idx>=0) { STATE.watchlist.splice(idx,1); showToast(`Removed "${item.title}" from Watchlist`); }
  else { STATE.watchlist.push({id:item.id,title:item.title,poster:item.poster,year:item.year,rating:item.rating,is_series:item.is_series}); showToast(`"${item.title}" added to Watchlist ✓`); }
  initWatchlistBadge();
  saveState();
  const btn = document.getElementById(`wlBtn_${item.id}`);
  if (btn) {
    const inWl = STATE.watchlist.some(x=>x.id===item.id);
    btn.innerHTML = `<i class="fa-solid fa-${inWl?'check':'plus'}"></i> ${inWl?'In Watchlist':'Watchlist'}`;
  }
}

function initWatchlistBadge() {
  const b = document.getElementById('wlBadge');
  if (!b) return;
  const n = STATE.watchlist.length;
  b.textContent = n;
  b.style.display = n > 0 ? 'flex' : 'none';
}

function openWatchlistModal() {
  const m = document.getElementById('watchlistModal');
  if (!m) return;
  renderWatchlistBody();
  m.classList.add('open');
}
function closeWatchlistModal() {
  const m = document.getElementById('watchlistModal');
  if (m) m.classList.remove('open');
}
document.addEventListener('click', e => {
  const m = document.getElementById('watchlistModal');
  if (e.target === m) closeWatchlistModal();
});

function renderWatchlistBody() {
  const body = document.getElementById('watchlistBody');
  if (!body) return;
  if (!STATE.watchlist.length) {
    body.innerHTML = `<div class="wl-empty"><i class="fa-solid fa-bookmark"></i><p>Your watchlist is empty</p><p style="font-size:13px;margin-top:6px;color:var(--text-dim)">Add movies and shows to watch later</p></div>`;
    return;
  }
  const ph = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=300&q=60';
  body.innerHTML = STATE.watchlist.map(m=>`
    <div class="wl-item">
      <img src="${esc(m.poster||ph)}" alt="${esc(m.title)}" onerror="this.onerror=null;this.src='${ph}'">
      <div class="wl-item-info">
        <div class="wl-item-title">${esc(m.title)}</div>
        <div class="wl-item-meta">${m.year||''} ${m.rating?`· ⭐ ${Number(m.rating).toFixed(1)}`:''} ${m.is_series?'· TV Series':'· Movie'}</div>
      </div>
      <button class="wl-item-play" onclick="closeWatchlistModal(); openMedia('${esc(m.id)}',${!!m.is_series})">
        <i class="fa-solid fa-play"></i>
      </button>
    </div>
  `).join('');
}

// ============================================================
// UTILITIES
// ============================================================
async function api(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function setMain(html) {
  const mv = document.getElementById('mainView');
  document.removeEventListener('keydown', handlePlayerKeys);
  if (mv) mv.innerHTML = html;
  if (document.getElementById('playerPage')) {
    document.addEventListener('keydown', handlePlayerKeys);
  } else {
    document.getElementById('navbar').style.display = '';
  }
}

function fmtTime(s) {
  if (!s || isNaN(s) || s<0) return '0:00';
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), ss=Math.floor(s%60);
  if (h>0) return `${h}:${pad(m)}:${pad(ss)}`;
  return `${m}:${pad(ss)}`;
}

function fmtDur(min) {
  if (!min) return '';
  const h=Math.floor(min/60), m=Math.round(min%60);
  return h>0 ? `${h}h ${m}m` : `${m}m`;
}

function pad(n) { return String(n).padStart(2,'0'); }
function clamp(v,mn,mx) { return Math.max(mn,Math.min(mx,v)); }

function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 2800);
}

function getResumePos(id) {
  const h = STATE.watchHistory[id];
  if (!h || !h.pos || h.pos < 10) return 0;
  if (h.dur && h.pos/h.dur > 0.93) return 0;
  return h.pos;
}

function buildFooter() {
  return `<footer class="site-footer">
    <div class="footer-brand">
      <div class="logo-play-icon" style="width:28px;height:28px;font-size:11px"><i class="fa-solid fa-play"></i></div>
      LUMEN<strong style="color:var(--red)">FLIX</strong>
    </div>
    <span class="footer-copy">&copy; 2025 LumenFlix · Scene English. All rights reserved.</span>
    <div class="footer-links">
      <a onclick="navigate('browse')">Browse</a>
      <a onclick="navigate('browse?cat=movies')">Movies</a>
      <a onclick="navigate('browse?cat=series')">TV Series</a>
      <a onclick="navigate('learn')">Scene English</a>
    </div>
  </footer>`;
}

// ============================================================
// PROFILE PAGE
// ============================================================
function getProfile() {
  try { return JSON.parse(localStorage.getItem('lf_profile') || 'null') || { name: 'Guest', avatar: '#e50914' }; }
  catch(e) { return { name: 'Guest', avatar: '#e50914' }; }
}
function saveProfile(p) { localStorage.setItem('lf_profile', JSON.stringify(p)); updateNavProfile(); }
function getSubscription() {
  try {
    return JSON.parse(localStorage.getItem('lf_subscription') || 'null') || {
      planId: 'vip4k',
      planName: 'SCANE VIP 4K Ultra',
      priceUzs: '89,000 UZS / oy',
      priceUsd: '$9.99 / mo',
      status: 'Active',
      method: 'Uzcard •••• 8600',
      renewsAt: '2026-11-28',
      invoices: [
        { id: 'INV-2026-10', date: '2026-10-28', plan: 'SCANE VIP 4K Ultra', amount: '89,000 UZS', status: 'Paid' }
      ]
    };
  } catch (e) {
    return { planId: 'vip4k', planName: 'SCANE VIP 4K Ultra', priceUzs: '89,000 UZS / oy', status: 'Active', method: 'Uzcard •••• 8600', renewsAt: '2026-11-28', invoices: [] };
  }
}

function saveSubscription(sub) {
  localStorage.setItem('lf_subscription', JSON.stringify(sub));
  updateNavProfile();
}

function updateNavProfile() {
  const p = getProfile();
  const sub = getSubscription();
  const initials = (p.name || 'G').trim().slice(0, 2).toUpperCase();
  document.querySelectorAll('.profile-avatar, .profile-avatar-lg').forEach(el => {
    el.textContent = initials;
    el.style.background = `linear-gradient(135deg, ${p.avatar}, #7c3aed)`;
  });
  const nm = document.querySelector('.profile-name');
  if (nm) nm.textContent = p.name;
  const ps = document.querySelector('.profile-sub');
  if (ps) ps.textContent = sub.planName || 'All titles unlocked';
  const vl = document.getElementById('vipNavLabel');
  if (vl) vl.textContent = sub.planId === 'free' ? 'UPGRADE' : (sub.planId === 'plus' ? 'PLUS HD' : 'VIP 4K');
}

const SUB_PLANS = [
  {
    id: 'free',
    name: 'Basic Starter',
    badge: 'FREE',
    priceUzs: '0 UZS / oy',
    priceUsd: '$0 / mo',
    quality: '720p HD',
    devices: '1 Device',
    features: ['Standard Movie & Series Catalog', 'English Subtitles', '1 Profile', 'Standard Audio']
  },
  {
    id: 'plus',
    name: 'Cinema Plus HD',
    badge: 'POPULAR',
    priceUzs: '49,000 UZS / oy',
    priceUsd: '$4.99 / mo',
    quality: '1080p Full HD',
    devices: '2 Devices',
    features: ['Full Catalog + Online Stream Finder', 'Interactive English Transcript & Dictionary', 'Night Dialogue Audio Boost (260%)', '2 Profiles + Kids Safe Mode']
  },
  {
    id: 'vip4k',
    name: 'SCANE VIP 4K Ultra',
    badge: 'BEST VALUE · 4K HDR',
    priceUzs: '89,000 UZS / oy',
    priceUsd: '$9.99 / mo',
    quality: '4K Ultra HD + HDR',
    devices: '4 Devices Simultaneously',
    features: ['Unlimited Instant Online Movie & Series Verification', '4K Ultra HD + Ambient Cinema Glow', 'Interactive English Dictionary + A-B Scene Loop', 'Up to 5 Family Profiles + Priority Servers']
  }
];

function openSubscriptionModal(preselectPlanId) {
  const m = document.getElementById('subscriptionModal');
  const body = document.getElementById('subscriptionModalBody');
  if (!m || !body) return;
  const cur = getSubscription();
  const selId = preselectPlanId || cur.planId || 'vip4k';
  STATE._checkoutPlan = selId;
  STATE._checkoutMethod = STATE._checkoutMethod || 'Payme';

  const selPlan = SUB_PLANS.find(p => p.id === selId) || SUB_PLANS[2];
  const methods = [
    { id: 'Payme', icon: 'fa-wallet', label: 'Payme' },
    { id: 'Click', icon: 'fa-bolt', label: 'Click Evolution' },
    { id: 'Uzcard', icon: 'fa-credit-card', label: 'Uzcard' },
    { id: 'Humo', icon: 'fa-credit-card', label: 'Humo' },
    { id: 'Visa', icon: 'fa-brands fa-cc-visa', label: 'Visa / Mastercard' }
  ];

  body.innerHTML = `
    <div class="sub-current-banner">
      <div>
        <span class="sub-status-pill"><i class="fa-solid fa-circle-check"></i> ${esc(cur.status || 'Active')}</span>
        <h4>Current Plan: <strong>${esc(cur.planName)}</strong> (${esc(cur.priceUzs)})</h4>
        <p>Payment method: ${esc(cur.method || 'Uzcard')} · Next billing date: ${esc(cur.renewsAt || '2026-11-28')}</p>
      </div>
    </div>

    <div class="sub-plans-grid">
      ${SUB_PLANS.map(pl => `
        <div class="sub-plan-card ${pl.id === selId ? 'selected' : ''} ${pl.id === cur.planId ? 'current' : ''}" onclick="openSubscriptionModal('${pl.id}')">
          <div class="sub-plan-badge">${esc(pl.badge)}</div>
          <div class="sub-plan-name">${esc(pl.name)}</div>
          <div class="sub-plan-price">${esc(pl.priceUzs)}<span>${esc(pl.priceUsd)}</span></div>
          <div class="sub-plan-meta"><i class="fa-solid fa-tv"></i> ${esc(pl.quality)} · ${esc(pl.devices)}</div>
          <ul class="sub-plan-features">
            ${pl.features.map(f => `<li><i class="fa-solid fa-check"></i> ${esc(f)}</li>`).join('')}
          </ul>
          <button class="btn-red-sm" style="width:100%;justify-content:center;margin-top:auto">
            ${pl.id === cur.planId ? '<i class="fa-solid fa-circle-check"></i> Current Plan' : 'Select Plan'}
          </button>
        </div>
      `).join('')}
    </div>

    <div class="sub-checkout-box">
      <h4><i class="fa-solid fa-shield-halved" style="color:var(--green)"></i> Instant Upgrade / Payment Method for <span>${esc(selPlan.name)}</span></h4>
      <div class="pay-methods-row">
        ${methods.map(pm => `
          <button class="pay-method-btn ${STATE._checkoutMethod === pm.id ? 'active' : ''}" onclick="STATE._checkoutMethod='${pm.id}'; openSubscriptionModal('${selId}')">
            <i class="fa-solid ${pm.icon}"></i> ${esc(pm.label)}
          </button>
        `).join('')}
      </div>
      <div class="pay-form-row">
        <input type="text" class="pay-input" id="payCardInput" placeholder="${STATE._checkoutMethod === 'Payme' || STATE._checkoutMethod === 'Click' ? 'Phone number: +998 90 123 45 67' : 'Card number: 8600 •••• •••• 1234'}" value="+998 90 123 45 67">
        <input type="text" class="pay-input" id="payPromoInput" placeholder="Promo code (try LUMEN2026)" style="max-width:210px">
        <button class="btn-red" onclick="completePlanCheckout('${selPlan.id}')">
          <i class="fa-solid fa-bolt"></i> Activate ${esc(selPlan.name)} (${esc(selPlan.priceUzs)})
        </button>
      </div>
    </div>
  `;
  m.classList.add('open');
}

function closeSubscriptionModal() {
  const m = document.getElementById('subscriptionModal');
  if (m) m.classList.remove('open');
}

function completePlanCheckout(planId) {
  const pl = SUB_PLANS.find(p => p.id === planId) || SUB_PLANS[2];
  const promo = (document.getElementById('payPromoInput')?.value || '').trim().toUpperCase();
  const card = (document.getElementById('payCardInput')?.value || '').trim() || '8600 •••• 4412';
  const cur = getSubscription();
  const discounted = promo === 'LUMEN2026' || promo === 'VIP100';
  const amount = discounted && pl.id !== 'free' ? '0 UZS (Promo 100% OFF)' : pl.priceUzs;

  const nextDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const inv = {
    id: `INV-${Math.floor(100000 + Math.random() * 900000)}`,
    date: new Date().toISOString().slice(0, 10),
    plan: pl.name,
    amount,
    status: 'Paid'
  };
  const updated = {
    planId: pl.id,
    planName: pl.name,
    priceUzs: pl.priceUzs,
    priceUsd: pl.priceUsd,
    status: 'Active',
    method: `${STATE._checkoutMethod || 'Payme'} (${card.slice(-9)})`,
    renewsAt: nextDate,
    invoices: [inv, ...(cur.invoices || [])].slice(0, 8)
  };
  saveSubscription(updated);
  closeSubscriptionModal();
  showToast(`👑 ${pl.name} activated! ${discounted ? '(Promo LUMEN2026 applied)' : ''}`);
  if (window.location.hash.startsWith('#profile')) renderProfilePage();
}

async function renderProfilePage() {
  document.title = 'My Profile & VIP Subscription — SCANE';
  const p = getProfile();
  const sub = getSubscription();
  const profiles = getProfilesList();
  const colors = ['#e50914', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b'];
  const histEntries = Object.entries(STATE.watchHistory).sort((a, b) => b[1].ts - a[1].ts);
  const totalSec = histEntries.reduce((s, [, v]) => s + (v.pos || 0), 0);
  const finished = histEntries.filter(([, v]) => v.dur && v.pos / v.dur > 0.9).length;

  setMain(`<div class="profile-page">
    <div class="profile-hero">
      <div class="profile-big-avatar" style="background:linear-gradient(135deg,${p.avatar},#7c3aed)">${esc((p.name||'G').slice(0,2).toUpperCase())}</div>
      <div class="profile-hero-info">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <input class="profile-name-input" id="profName" value="${esc(p.name)}" maxlength="24" onchange="saveProfile({...getProfile(), name: this.value || 'Guest'}); renderProfilePage()">
          <span class="vip-badge-gold"><i class="fa-solid fa-crown"></i> ${esc(sub.planName)}</span>
        </div>
        <div class="profile-colors">
          ${colors.map(c => `<button class="color-dot ${c===p.avatar?'active':''}" style="background:${c}" onclick="saveProfile({...getProfile(), avatar:'${c}'}); renderProfilePage()"></button>`).join('')}
        </div>
      </div>
    </div>
    <div class="profile-stats">
      <div class="stat-card"><i class="fa-solid fa-clock"></i><b>${Math.round(totalSec/3600*10)/10}h</b><span>Watch time</span></div>
      <div class="stat-card"><i class="fa-solid fa-play"></i><b>${histEntries.length}</b><span>Titles started</span></div>
      <div class="stat-card"><i class="fa-solid fa-circle-check"></i><b>${finished}</b><span>Completed</span></div>
      <div class="stat-card"><i class="fa-solid fa-bookmark"></i><b>${STATE.watchlist.length}</b><span>In watchlist</span></div>
    </div>

    <!-- Subscription & Billing Card -->
    <div class="profile-section">
      <div class="section-head">
        <h2 class="section-title"><i class="fa-solid fa-crown" style="color:#f5b50a"></i> Subscription & <span>Billing (Obuna)</span></h2>
        <button class="btn-red-sm" onclick="openSubscriptionModal()"><i class="fa-solid fa-bolt"></i> Change Plan / Payment</button>
      </div>
      <div class="sub-overview-card">
        <div class="sub-ov-left">
          <div class="sub-ov-badge">${esc(sub.status || 'Active')}</div>
          <h3>${esc(sub.planName)} <span>(${esc(sub.priceUzs)})</span></h3>
          <p><i class="fa-solid fa-credit-card"></i> Payment Method: <strong>${esc(sub.method)}</strong> · Next Renewal: <strong>${esc(sub.renewsAt)}</strong></p>
          <div class="sub-perks-chips">
            <span><i class="fa-solid fa-check"></i> 4K Ultra HD + HDR</span>
            <span><i class="fa-solid fa-check"></i> Interactive English Dictionary</span>
            <span><i class="fa-solid fa-check"></i> Night Audio Boost</span>
            <span><i class="fa-solid fa-check"></i> Instant Online Stream Finder</span>
          </div>
        </div>
        <div class="sub-ov-right">
          <button class="btn-glass-sm" onclick="openSubscriptionModal()">Manage Plan</button>
        </div>
      </div>
      ${(sub.invoices || []).length ? `
        <div class="invoices-box">
          <div class="invoices-title">Billing History & Receipts</div>
          ${sub.invoices.map(inv => `
            <div class="invoice-row">
              <span><strong>${esc(inv.id)}</strong> · ${esc(inv.date)}</span>
              <span>${esc(inv.plan)}</span>
              <span><strong>${esc(inv.amount)}</strong></span>
              <span class="inv-paid"><i class="fa-solid fa-circle-check"></i> ${esc(inv.status)}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>

    <!-- Family & Multi-Profiles Management -->
    <div class="profile-section">
      <div class="section-head">
        <h2 class="section-title"><i class="fa-solid fa-users"></i> Family <span>Profiles</span> (${profiles.length}/5)</h2>
        <button class="btn-glass-sm" onclick="addNewProfilePrompt()"><i class="fa-solid fa-plus"></i> Add Profile</button>
      </div>
      <div class="ps-grid" style="margin-top:0">
        ${profiles.map((pr, idx) => `
          <div class="ps-card ${pr.name === p.name ? 'active' : ''}" onclick="switchActiveProfile(${idx})">
            <div class="ps-avatar" style="background:linear-gradient(135deg,${pr.avatar},#7c3aed)">${esc(pr.name.slice(0,2).toUpperCase())}</div>
            <div class="ps-name">${esc(pr.name)}</div>
            ${pr.kids ? `<span class="ps-badge">KIDS</span>` : `<span style="font-size:11px;color:var(--text-d)">Standard</span>`}
            ${profiles.length > 1 ? `<button class="ps-del-btn" title="Remove profile" onclick="event.stopPropagation();deleteProfileIdx(${idx})"><i class="fa-solid fa-trash"></i></button>` : ''}
          </div>
        `).join('')}
      </div>
    </div>

    <div class="profile-section">
      <div class="section-head"><h2 class="section-title">My <span>Favorites</span> ♥</h2></div>
      ${(STATE.favorites||[]).length ? `<div class="browse-grid">${STATE.favorites.map(buildCard).join('')}</div>`
        : `<div class="wl-empty"><i class="fa-solid fa-heart"></i><p>No favorites yet</p></div>`}
    </div>

    <div class="profile-section">
      <div class="section-head"><h2 class="section-title">My <span>Watchlist</span></h2></div>
      ${STATE.watchlist.length ? `<div class="browse-grid">${STATE.watchlist.map(buildCard).join('')}</div>`
        : `<div class="wl-empty"><i class="fa-solid fa-bookmark"></i><p>Your watchlist is empty</p></div>`}
    </div>

    <div class="profile-section">
      <div class="section-head"><h2 class="section-title">Playback <span>Settings</span></h2></div>
      <div class="settings-list">
        <label class="setting-row"><span><i class="fa-solid fa-closed-captioning"></i> Subtitles on by default</span>
          <input type="checkbox" ${STATE.subtitlesEnabled?'checked':''} onchange="STATE.subtitlesEnabled=this.checked;saveState()"></label>
        <label class="setting-row"><span><i class="fa-solid fa-forward"></i> Autoplay next episode</span>
          <input type="checkbox" ${STATE.autoplay!==false?'checked':''} onchange="STATE.autoplay=this.checked;localStorage.setItem('lf_autoplay',this.checked)"></label>
        <label class="setting-row"><span><i class="fa-solid fa-forward-fast"></i> Skip intro button</span>
          <input type="checkbox" ${STATE.skipIntro!==false?'checked':''} onchange="STATE.skipIntro=this.checked;localStorage.setItem('lf_skipintro',this.checked)"></label>
        <div class="setting-row"><span><i class="fa-solid fa-text-height"></i> Subtitle size</span>
          <select class="sort-select" onchange="STATE.subSize=this.value;localStorage.setItem('lf_subsize',this.value);applySubSize()">
            ${['small','medium','large','xlarge'].map(s=>`<option value="${s}" ${(STATE.subSize||'medium')===s?'selected':''}>${s[0].toUpperCase()+s.slice(1)}</option>`).join('')}
          </select></div>
      </div>
    </div>

    <div class="profile-section">
      <div class="section-head">
        <h2 class="section-title">Watch <span>History</span></h2>
        ${histEntries.length?`<button class="see-all-btn" onclick="if(confirm('Clear all watch history?')){STATE.watchHistory={};saveState();renderProfilePage()}"><i class="fa-solid fa-trash"></i> Clear</button>`:''}
      </div>
      <div id="profHistory" class="browse-grid"></div>
    </div>
    ${buildFooter()}
  </div>`);

  // Load history item details
  const grid = document.getElementById('profHistory');
  for (const [id, v] of histEntries.slice(0, 24)) {
    try {
      const it = await api(`/api/item/${id}`);
      if (!grid || !it || it.error) continue;
      const d = document.createElement('div');
      d.innerHTML = buildCard(it);
      grid.appendChild(d.firstElementChild);
    } catch(e) {}
  }
}

function applySubSize() {
  const map = { small: '0.85em', medium: '1.1em', large: '1.4em', xlarge: '1.8em' };
  let st = document.getElementById('subSizeStyle');
  if (!st) { st = document.createElement('style'); st.id = 'subSizeStyle'; document.head.appendChild(st); }
  st.textContent = `::cue{font-size:${map[STATE.subSize||'medium']} !important}`;
}
// ============================================================
// ACTOR PAGE, COLLECTION HUBS, TRAILERS, SURPRISE, KIDS & PROFILES
// ============================================================
async function renderActorPage(personId) {
  setMain(`<div class="page-loader"><div class="spinner-ring-lg"></div><p>Loading actor profile...</p></div>`);
  try {
    const a = await api(`/api/actor/${personId}`);
    if (!a || a.error) throw new Error(a?.error || 'Not found');
    document.title = `${a.name} — SCANE`;
    setMain(`<div class="actor-page">
      <div class="actor-hero">
        <button class="back-btn" onclick="history.back()" style="position:static;margin-bottom:18px"><i class="fa-solid fa-arrow-left"></i> Back</button>
        <div class="actor-hero-grid">
          <div class="actor-photo-wrap">
            ${a.photo ? `<img src="${esc(a.photo)}" alt="${esc(a.name)}">` : `<div class="actor-photo-fallback"><i class="fa-solid fa-user"></i></div>`}
          </div>
          <div class="actor-info">
            <h1 class="detail-title">${esc(a.name)}</h1>
            <div class="detail-meta-row" style="margin-bottom:14px">
              ${a.known_for ? `<span class="meta-chip">${esc(a.known_for)}</span>` : ''}
              ${a.birthday ? `<span class="meta-chip"><i class="fa-solid fa-cake-candles"></i> ${esc(a.birthday)}</span>` : ''}
              ${a.place_of_birth ? `<span class="meta-chip"><i class="fa-solid fa-location-dot"></i> ${esc(a.place_of_birth)}</span>` : ''}
            </div>
            <p class="detail-synopsis" style="max-width:780px">${esc(a.biography || 'Biography not available.')}</p>
          </div>
        </div>
      </div>
      <div class="browse-content">
        ${(a.inLibrary || []).length ? `
          <div class="section-head" style="padding:0 0 14px"><h2 class="section-title">Available to <span>Stream Now</span> (${a.inLibrary.length})</h2></div>
          <div class="browse-grid" style="margin-bottom:36px">${a.inLibrary.map(buildCard).join('')}</div>
        ` : ''}
        ${(a.online || []).length ? `
          <div class="section-head" style="padding:0 0 14px"><h2 class="section-title">More Known <span>Credits</span> (Click to Find Stream)</h2></div>
          <div class="browse-grid">${a.online.map(c => `
            <div class="card" onclick='resolveAndPlayOnline(${JSON.stringify({tmdb_id:c.tmdb_id,title:c.title,year:c.year,is_series:c.is_series,poster:c.poster}).replace(/'/g,"&#39;")})'>
              <div class="card-poster">
                ${c.poster ? `<img src="${esc(c.poster)}" alt="${esc(c.title)}" loading="lazy">` : ''}
                <div class="card-type-badge badge-movie">${c.is_series?'SERIES':'MOVIE'}</div>
                ${c.rating ? `<div class="card-rating"><i class="fa-solid fa-star"></i> ${c.rating}</div>` : ''}
                <div class="card-overlay"><div class="card-play-circle"><i class="fa-solid fa-magnifying-glass"></i></div></div>
              </div>
              <div class="card-title">${esc(c.title)}</div>
              <div class="card-sub"><span>${c.year||''}</span>${c.character?`<span>· as ${esc(c.character)}</span>`:''}</div>
            </div>
          `).join('')}</div>
        ` : ''}
      </div>
      ${buildFooter()}
    </div>`);
  } catch (e) {
    setMain(`<div class="page-loader"><p>Actor profile unavailable.</p><button class="btn-play" onclick="history.back()">Go Back</button></div>`);
  }
}

async function renderCollectionHubPage(slug) {
  setMain(`<div class="page-loader"><div class="spinner-ring-lg"></div><p>Loading collection...</p></div>`);
  const metaMap = {
    marvel:    { title: 'Marvel Cinematic Universe', sub: 'Superheroes, Avengers & Multiverse Saga', grad: 'linear-gradient(135deg,#991b1b,#450a0a)' },
    dc:        { title: 'DC Universe', sub: 'Gotham, Metropolis & Justice League Legends', grad: 'linear-gradient(135deg,#1e3a8a,#0f172a)' },
    starwars:  { title: 'Star Wars Galaxy', sub: 'A Long Time Ago in a Galaxy Far, Far Away...', grad: 'linear-gradient(135deg,#ca8a04,#090d16)' },
    animation: { title: 'Animation Studio Showcase', sub: 'Pixar, DreamWorks, Illumination & Anime Classics', grad: 'linear-gradient(135deg,#0284c7,#1e1b4b)' },
    scifi:     { title: 'Sci-Fi & Cyberpunk Worlds', sub: 'Time Travel, Space Exploration & Dystopian Futures', grad: 'linear-gradient(135deg,#6d28d9,#090d16)' },
    crime:     { title: 'Crime, Mafia & Thrillers', sub: 'Heists, Detectives & Underworld Dramas', grad: 'linear-gradient(135deg,#334155,#090d16)' },
    horror:    { title: 'Dark & Supernatural', sub: 'Chilling Horror, Mystery & Psychological Thrillers', grad: 'linear-gradient(135deg,#047857,#090d16)' },
    topimdb:   { title: 'IMDb 8.1+ Hall of Fame', sub: 'Critically Acclaimed Cinema Masterpieces', grad: 'linear-gradient(135deg,#b45309,#090d16)' },
  };
  const info = metaMap[slug] || { title: slug.toUpperCase(), sub: 'Curated Collection', grad: 'linear-gradient(135deg,#e50914,#090d16)' };
  document.title = `${info.title} — SCANE`;
  try {
    const d = await api(`/api/collection-hub?slug=${encodeURIComponent(slug)}`);
    const items = d.items || [];
    setMain(`<div class="hub-page">
      <div class="hub-hero" style="background:${info.grad}">
        <button class="back-btn" onclick="history.back()" style="position:static;margin-bottom:16px"><i class="fa-solid fa-arrow-left"></i> Back</button>
        <h1 class="detail-title">${esc(info.title)}</h1>
        <p class="detail-synopsis">${esc(info.sub)} · <strong>${items.length}</strong> verified titles</p>
      </div>
      <div class="browse-content">
        <div class="browse-grid">${items.map(buildCard).join('')}</div>
      </div>
      ${buildFooter()}
    </div>`);
  } catch (e) {
    setMain(`<div class="page-loader"><p>Collection unavailable.</p><button class="btn-play" onclick="navigate('home')">Home</button></div>`);
  }
}

async function playItemTrailer(id, title) {
  showToast('🎬 Finding official trailer...');
  try {
    const ex = await api(`/api/extras/${id}`);
    if (ex && ex.trailerKey) {
      openTrailerKey(ex.trailerKey, `${title} — Official Trailer`);
    } else {
      showToast('Official trailer not available for this title');
    }
  } catch (e) {
    showToast('Trailer unavailable');
  }
}

function openTrailerKey(key, title) {
  const m = document.getElementById('trailerModal');
  const f = document.getElementById('trailerFrameWrap');
  const t = document.getElementById('trailerModalTitle');
  if (!m || !f) return;
  if (t) t.textContent = title || 'Official Trailer';
  f.innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(key)}?autoplay=1&rel=0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>`;
  m.classList.add('open');
}

function closeTrailerModal() {
  const m = document.getElementById('trailerModal');
  const f = document.getElementById('trailerFrameWrap');
  if (f) f.innerHTML = '';
  if (m) m.classList.remove('open');
}

async function surpriseMe() {
  showToast('🎲 Picking a random top-rated title for you...');
  try {
    const d = await api(`/api/movies?category=top&limit=80${STATE.kidsMode ? '&kids=1' : ''}`);
    const items = d.items || [];
    if (!items.length) return;
    const pick = items[Math.floor(Math.random() * items.length)];
    openMedia(pick.id, !!pick.is_series);
  } catch (e) {}
}

function toggleKidsMode() {
  STATE.kidsMode = !STATE.kidsMode;
  localStorage.setItem('lf_kids', String(STATE.kidsMode));
  const btn = document.getElementById('kidsModeBtn');
  if (btn) btn.classList.toggle('active', STATE.kidsMode);
  showToast(STATE.kidsMode ? '🧒 Kids & Family Safe Mode ON' : 'Kids Mode OFF');
  route();
}

// Multi-Profile Switcher
function getProfilesList() {
  try {
    return JSON.parse(localStorage.getItem('lf_profiles_list') || 'null') || [
      { name: 'Main VIP', avatar: '#e50914', kids: false },
      { name: 'Cinema Fan', avatar: '#3b82f6', kids: false },
      { name: 'English Learner', avatar: '#10b981', kids: false },
      { name: 'Kids', avatar: '#f59e0b', kids: true }
    ];
  } catch (e) {
    return [{ name: 'Guest', avatar: '#e50914', kids: false }];
  }
}

function openProfileSwitcher() {
  const m = document.getElementById('profileSwitcherModal');
  const grid = document.getElementById('profileSwitcherGrid');
  if (!m || !grid) return;
  const list = getProfilesList();
  const cur = getProfile();
  grid.innerHTML = list.map((p, idx) => `
    <div class="ps-card ${p.name === cur.name ? 'active' : ''}" onclick="switchActiveProfile(${idx})">
      <div class="ps-avatar" style="background:linear-gradient(135deg,${p.avatar},#7c3aed)">${esc(p.name.slice(0,2).toUpperCase())}</div>
      <div class="ps-name">${esc(p.name)}</div>
      ${p.kids ? `<span class="ps-badge">KIDS</span>` : ''}
    </div>
  `).join('');
  m.classList.add('open');
}

function closeProfileSwitcher() {
  const m = document.getElementById('profileSwitcherModal');
  if (m) m.classList.remove('open');
}

function switchActiveProfile(idx) {
  const list = getProfilesList();
  const p = list[idx];
  if (!p) return;
  saveProfile({ name: p.name, avatar: p.avatar });
  STATE.kidsMode = !!p.kids;
  localStorage.setItem('lf_kids', String(STATE.kidsMode));
  const btn = document.getElementById('kidsModeBtn');
  if (btn) btn.classList.toggle('active', STATE.kidsMode);
  closeProfileSwitcher();
  showToast(`👋 Welcome back, ${p.name}!`);
  route();
}

function addNewProfilePrompt() {
  const list = getProfilesList();
  if (list.length >= 5) { showToast('Maximum 5 profiles allowed on VIP 4K plan'); return; }
  const name = prompt('Enter new profile name:', 'Family Member');
  if (!name || !name.trim()) return;
  const isKids = confirm('Enable Kids & Family Safe Mode for this profile?');
  const colors = ['#8b5cf6', '#ec4899', '#06b6d4', '#10b981', '#f59e0b'];
  list.push({ name: name.trim().slice(0, 20), avatar: colors[list.length % colors.length], kids: isKids });
  localStorage.setItem('lf_profiles_list', JSON.stringify(list));
  showToast(`✓ Profile "${name.trim()}" created`);
  renderProfilePage();
}

function deleteProfileIdx(idx) {
  const list = getProfilesList();
  if (list.length <= 1) return;
  const removed = list.splice(idx, 1)[0];
  localStorage.setItem('lf_profiles_list', JSON.stringify(list));
  showToast(`Removed profile "${removed.name}"`);
  renderProfilePage();
}

async function resolveAndPlayOnline(obj) {
  if (!obj || !obj.tmdb_id) return;
  const type = obj.type || (obj.is_series ? 'tv' : 'movie');
  showToast(`🔍 Finding & verifying stream for "${obj.title || 'title'}"...`);
  try {
    const res = await api(`/api/resolve?type=${encodeURIComponent(type)}&tmdb_id=${encodeURIComponent(obj.tmdb_id)}`);
    if (res && res.found && res.id) {
      showToast(`✓ Stream verified! Opening "${obj.title}"`);
      openMedia(res.id, !!res.is_series);
    } else {
      showToast(`❌ Stream for "${obj.title}" is not yet available`);
    }
  } catch (e) {
    showToast(`❌ Could not verify "${obj.title}"`);
  }
}

// Favorites & User Star Ratings
function isFavorite(id) {
  return (STATE.favorites || []).some(x => x.id === id);
}

function toggleFav(item) {
  if (!STATE.favorites) STATE.favorites = [];
  const idx = STATE.favorites.findIndex(x => x.id === item.id);
  if (idx >= 0) {
    STATE.favorites.splice(idx, 1);
    showToast(`Removed "${item.title}" from Favorites`);
  } else {
    STATE.favorites.push({ id: item.id, title: item.title, poster: item.poster, year: item.year, rating: item.rating, is_series: item.is_series });
    showToast(`♥ Added "${item.title}" to Favorites!`);
  }
  saveState();
  const btn = document.getElementById(`favBtn_${item.id}`);
  if (btn) {
    const on = isFavorite(item.id);
    btn.classList.toggle('fav-active', on);
    btn.innerHTML = `<i class="fa-solid fa-heart" style="color:${on ? '#e50914' : 'inherit'}"></i>`;
  }
}

function getUserRating(id) {
  return (STATE.userRatings || {})[id] || 0;
}

function setUserRating(id, stars) {
  if (!STATE.userRatings) STATE.userRatings = {};
  STATE.userRatings[id] = stars;
  saveState();
  const wrap = document.getElementById(`rater_${id}`);
  if (wrap) {
    wrap.querySelectorAll('i').forEach((ic, idx) => {
      ic.className = `${idx < stars ? 'fa-solid' : 'fa-regular'} fa-star`;
    });
  }
  showToast(`⭐ You rated this ${stars}/5 stars!`);
}

// State persistence
function loadPersistedState() {
  try {
    STATE.watchlist = JSON.parse(localStorage.getItem('lf_wl')||'[]');
    STATE.favorites = JSON.parse(localStorage.getItem('lf_favs')||'[]');
    STATE.userRatings = JSON.parse(localStorage.getItem('lf_ratings')||'{}');
    STATE.watchHistory = JSON.parse(localStorage.getItem('lf_hist')||'{}');
    STATE.subtitlesEnabled = localStorage.getItem('lf_subs') !== 'false';
    STATE.subtitleOffset = parseFloat(localStorage.getItem('lf_suboff') || '0');
    STATE.volume = parseFloat(localStorage.getItem('lf_vol') || '1');
    STATE.muted = localStorage.getItem('lf_muted') === 'true';
    STATE.speed = parseFloat(localStorage.getItem('lf_speed') || '1');
    STATE.autoplay = localStorage.getItem('lf_autoplay') !== 'false';
    STATE.skipIntro = localStorage.getItem('lf_skipintro') !== 'false';
    STATE.subSize = localStorage.getItem('lf_subsize') || 'medium';
    STATE.kidsMode = localStorage.getItem('lf_kids') === 'true';
    const kb = document.getElementById('kidsModeBtn');
    if (kb) kb.classList.toggle('active', STATE.kidsMode);
  } catch(e) {}
}

function saveState() {
  try {
    localStorage.setItem('lf_wl', JSON.stringify(STATE.watchlist));
    localStorage.setItem('lf_favs', JSON.stringify(STATE.favorites || []));
    localStorage.setItem('lf_ratings', JSON.stringify(STATE.userRatings || {}));
    localStorage.setItem('lf_hist', JSON.stringify(STATE.watchHistory));
    localStorage.setItem('lf_subs', String(STATE.subtitlesEnabled));
    localStorage.setItem('lf_suboff', String(STATE.subtitleOffset));
    localStorage.setItem('lf_vol', String(STATE.volume));
    localStorage.setItem('lf_muted', String(STATE.muted));
    localStorage.setItem('lf_speed', String(STATE.speed));
  } catch(e) {}
}
