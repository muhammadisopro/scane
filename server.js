const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const sceneEnglish = require('./scene_english');

function readBodyJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MOVIES_FILE = path.join(__dirname, 'movies.json');
const SERIES_CACHE_FILE = path.join(__dirname, 'series_enriched.json');

const TMDB_API_KEY = 'e6d52d32ce458e7125d6f0dfdc0e9307';

let rawMoviesDb = [];
let moviesOnly = [];
let showsMap = new Map();
let showsList = [];
let allCatalog = [];
let episodeToNextMap = new Map();
let seriesCache = {};
let lastMtime = 0;
const SHOW_META_FILE = path.join(__dirname, 'show_meta_cache.json');
let showMetaCache = {};
try { if (fs.existsSync(SHOW_META_FILE)) showMetaCache = JSON.parse(fs.readFileSync(SHOW_META_FILE, 'utf-8')); } catch (e) {}

const crypto = require('crypto');
const os = require('os');
const STREAM_CACHE_FILE = path.join(__dirname, 'stream_cache.json');
let streamCache = {};
try { if (fs.existsSync(STREAM_CACHE_FILE)) streamCache = JSON.parse(fs.readFileSync(STREAM_CACHE_FILE, 'utf-8')); } catch (e) {}

// ============================================================
// PLATFORM DB: AUTHENTICATION (USERS) & COMPLAINTS (REPORTS)
// ============================================================
const PLATFORM_DB_FILE = path.join(process.env.VERCEL ? os.tmpdir() : __dirname, 'platform_db.json');
function hashPassword(pw) {
  return crypto.createHash('sha256').update(String(pw || '') + '_scane_salt').digest('hex');
}
let platformDb = {
  users: [
    {
      id: 'usr_admin',
      name: 'SCANE Admin',
      email: 'admin@scane.tv',
      username: 'admin',
      passwordHash: hashPassword('admin123'),
      role: 'admin',
      plan: 'vip',
      createdAt: '2026-10-28T00:00:00Z'
    }
  ],
  sessions: {}, // token -> userId
  reports: [],  // { id, videoId, mediaId, title, reason, details, userEmail, status, createdAt, suggestedAlt }
  googleClientId: '324819070960-vdpa542cusb5tq68p9mgm67hrncoi209.apps.googleusercontent.com'
};

function loadPlatformDb() {
  try {
    if (fs.existsSync(PLATFORM_DB_FILE)) {
      const saved = JSON.parse(fs.readFileSync(PLATFORM_DB_FILE, 'utf-8'));
      if (Array.isArray(saved.users) && saved.users.length) platformDb.users = saved.users;
      if (saved.sessions) platformDb.sessions = saved.sessions;
      if (Array.isArray(saved.reports)) platformDb.reports = saved.reports;
      if (saved.googleClientId) platformDb.googleClientId = saved.googleClientId;
    }
  } catch (e) {}
  // Always ensure default admin exists
  if (!platformDb.users.some(u => u.username === 'admin' || u.email === 'admin@scane.tv')) {
    platformDb.users.unshift({
      id: 'usr_admin',
      name: 'SCANE Admin',
      email: 'admin@scane.tv',
      username: 'admin',
      passwordHash: hashPassword('admin123'),
      role: 'admin',
      plan: 'vip',
      createdAt: new Date().toISOString()
    });
  }
}
function savePlatformDb() {
  try {
    fs.writeFileSync(PLATFORM_DB_FILE, JSON.stringify(platformDb, null, 2));
  } catch (e) {}
}
loadPlatformDb();

function sanitizeUser(u) {
  if (!u) return null;
  const { passwordHash, ...safe } = u;
  return safe;
}

function getAuthUserFromReq(req, parsedUrl) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim() || (parsedUrl.query && parsedUrl.query.token) || '';
  if (!token) return null;
  const uid = platformDb.sessions[token];
  if (!uid) return null;
  return platformDb.users.find(u => u.id === uid) || null;
}

function loadSeriesCache() {
  try {
    if (fs.existsSync(SERIES_CACHE_FILE)) {
      seriesCache = JSON.parse(fs.readFileSync(SERIES_CACHE_FILE, 'utf-8'));
    }
  } catch (e) {}
}

function loadMovies(force = false) {
  try {
    if (fs.existsSync(MOVIES_FILE)) {
      const stats = fs.statSync(MOVIES_FILE);
      if (force || stats.mtimeMs !== lastMtime) {
        rawMoviesDb = JSON.parse(fs.readFileSync(MOVIES_FILE, 'utf-8'));
        lastMtime = stats.mtimeMs;
        loadSeriesCache();

        moviesOnly = [];
        showsMap = new Map();
        showsList = [];
        episodeToNextMap = new Map();

        // 1. Filmlar va Seriallarni ajratish — bitta serial = bitta card
        const tmdbKeyByTitle = new Map();
        for (const item of rawMoviesDb) {
          if (!item.is_series) { moviesOnly.push(item); continue; }
          const rawT = item.raw_title || item.title || '';
          // Show name = raw title before "season N" / "episode N"
          let base = (item.clean_title && !/\b(season|episode|s\d+e\d+)\b/i.test(item.clean_title) && !/[а-яёА-ЯЁ]/.test(item.clean_title))
            ? item.clean_title.trim()
            : rawT.split(/\s+(?:season|episode)\s+\d+/i)[0].replace(/\(.*?\)/g, '').trim();
          if (!base) base = (item.clean_title || item.title || '').split(/\s{2,}/)[0].trim();
          base = base.replace(/\s{2,}.*/, '').trim();

          const sMatch = rawT.match(/season\s*(\d+)/i);
          const eMatch = rawT.match(/episode\s*(\d+)/i);
          item.season = sMatch ? parseInt(sMatch[1], 10) : (parseInt(item.season, 10) || 1);
          item.episode = eMatch ? parseInt(eMatch[1], 10) : (parseInt(item.episode, 10) || 1);
          const nameMatch = rawT.match(/«([^»]+)»/);
          if (nameMatch) item.raw_episode_name = nameMatch[1];

          const titleKey = base.toLowerCase().replace(/[^a-z0-9]/g, '');
          let showKey;
          if (item.tmdb_id) { showKey = 'tv' + item.tmdb_id; tmdbKeyByTitle.set(titleKey, showKey); }
          else showKey = tmdbKeyByTitle.get(titleKey) || ('t_' + titleKey);
          item.show_key = showKey;

          if (!showsMap.has(showKey)) {
            const extra = showMetaCache[titleKey] || {};
            showsMap.set(showKey, {
              id: 'show_' + base.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
              title: base,
              clean_title: base,
              is_series: true,
              is_animation: /animated/i.test(rawT),
              overview: item.overview || extra.overview || '',
              poster: item.poster || extra.poster || '',
              backdrop: item.backdrop || extra.backdrop || item.poster || '',
              rating: item.rating || extra.rating || null,
              year: item.year || (rawT.match(/(\d{4})\)/) || [])[1] || '',
              genres: (item.genres && item.genres.length) ? item.genres : (extra.genres || ['Drama']),
              tmdb_id: item.tmdb_id || extra.tmdb_id || null,
              imdb_id: item.imdb_id || extra.imdb_id || null,
              episodes: []
            });
          }
          const sh = showsMap.get(showKey);
          if (!sh.poster && item.poster) sh.poster = item.poster;
          // Avoid duplicate episodes (same S/E uploaded twice)
          if (!sh.episodes.some(e => e.season === item.season && e.episode === item.episode)) sh.episodes.push(item);
        }
        // Merge title-keyed groups into tmdb groups discovered later
        for (const [k, sh] of [...showsMap.entries()]) {
          if (!k.startsWith('t_')) continue;
          const tk = tmdbKeyByTitle.get(k.slice(2));
          if (tk && showsMap.has(tk)) {
            const target = showsMap.get(tk);
            for (const e of sh.episodes) if (!target.episodes.some(x => x.season === e.season && x.episode === e.episode)) target.episodes.push(e);
            showsMap.delete(k);
          }
        }

        // Serial qismlarini saralash va TMDB epizod ma'lumotlari bilan boyitish
        for (const [key, show] of showsMap.entries()) {
          show.episodes.sort((a, b) => {
            if (a.season !== b.season) return a.season - b.season;
            return a.episode - b.episode;
          });

          const seasonsSet = new Set(show.episodes.map(e => e.season));
          show.seasons = Array.from(seasonsSet).sort((a, b) => a - b);
          show.seasons_count = show.seasons.length;
          show.episodes_count = show.episodes.length;

          // Har bir qismga individual reyting, nom va rasm biriktirish
          for (let i = 0; i < show.episodes.length; i++) {
            const curEp = show.episodes[i];
            const cacheKey = `${show.tmdb_id}_s${curEp.season}`;
            const sData = seriesCache[cacheKey];

            if (sData && sData.episodes && sData.episodes[String(curEp.episode)]) {
              const epTmdb = sData.episodes[String(curEp.episode)];
              curEp.episode_name = epTmdb.name || curEp.raw_episode_name || `Episode ${curEp.episode}`;
              curEp.episode_rating = epTmdb.rating || show.rating;
              curEp.episode_still = epTmdb.still || curEp.poster;
              curEp.episode_overview = epTmdb.overview || curEp.overview;
            } else {
              curEp.episode_name = curEp.raw_episode_name || `Episode ${curEp.episode}`;
              curEp.episode_rating = null;
              curEp.episode_still = show.backdrop || curEp.poster || '';
              curEp.episode_overview = '';
            }

            const nextEp = i + 1 < show.episodes.length ? show.episodes[i + 1] : null;
            if (nextEp) {
              episodeToNextMap.set(curEp.id, {
                id: nextEp.id,
                title: nextEp.title,
                clean_title: nextEp.episode_name || nextEp.clean_title,
                season: nextEp.season,
                episode: nextEp.episode,
                showTitle: show.title,
                showId: show.id
              });
            }
          }

          showsList.push(show);
        }

        allCatalog = [...showsList, ...moviesOnly];

        console.log(`[BAZA] Jami: ${rawMoviesDb.length} ta video (${moviesOnly.length} ta film, ${showsList.length} ta serial) tayyorlandi.`);
      }
    }
  } catch (e) {
    console.error('[BAZA XATOLIK]', e.message);
  }
}

loadMovies();

const verify = require('./verify.js');
const resolveInFlight = new Map();
function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  return res.end(JSON.stringify(obj));
}
function persistDb() {
  try {
    const clean = rawMoviesDb.map(({ show_key, episode_name, episode_rating, episode_still, episode_overview, raw_episode_name, ...r }) => r);
    fs.writeFileSync(MOVIES_FILE, JSON.stringify(clean, null, 1));
  } catch (e) { console.error('[DB SAVE]', e.message); }
}

// HTTPS so'rov yordamchisi
function fetchUrl(targetUrl, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(targetUrl);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://rutube.ru/',
      ...customHeaders
    };

    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(targetUrl, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, customHeaders).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200 && res.statusCode !== 206) {
        return reject(new Error(`HTTP Status ${res.statusCode}`));
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        body: Buffer.concat(chunks),
        headers: res.headers,
        statusCode: res.statusCode
      }));
    });

    req.on('error', reject);
    req.setTimeout(14000, () => {
      req.destroy();
      reject(new Error('Ulanish vaqti tugadi (Timeout)'));
    });
  });
}

function srtToVtt(srtContent) {
  // Normalize line endings
  let text = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Remove BOM if present
  text = text.replace(/^\uFEFF/, '');

  // Remove HTML tags from subtitle text
  text = text.replace(/<[^>]+>/g, '');

  // Convert SRT timestamps to VTT (comma → dot)
  text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

  // Strip sequence numbers at the start of each block (VTT doesn't require them but they cause issues)
  // Keep the structure: number line → timestamp line → text → blank
  // We need to clean up any malformed blocks
  const blocks = text.trim().split(/\n\n+/);
  const cleanBlocks = blocks.map(block => {
    const lines = block.trim().split('\n');
    // Remove leading sequence number if present
    let start = 0;
    if (lines[0] && /^\d+$/.test(lines[0].trim())) start = 1;
    return lines.slice(start).join('\n');
  }).filter(b => b.includes('-->'));

  return 'WEBVTT\n\n' + cleanBlocks.join('\n\n');
}

async function resolveRutubeStream(videoId) {
  const optionsUrl = `https://rutube.ru/api/play/options/${videoId}/?format=json`;
  const res = await fetchUrl(optionsUrl);
  const data = JSON.parse(res.body.toString('utf-8'));

  const balancer = data.video_balancer || {};
  const masterM3u8 = balancer.m3u8 || balancer.default;

  return {
    title: data.title,
    duration: data.duration,
    m3u8: masterM3u8
  };
}

// Subtitle source cache (in-memory, lasts process lifetime)
const subtitleCache = new Map();

/**
 * Returns English subtitles ranked by how well they fit THIS video:
 * 1) subtitle's movie length closest to the actual stream duration (same cut/release => in sync)
 * 2) hearing-impaired versions last, 3) most downloaded.
 */
async function getEnglishSubtitleList(imdbId, season = null, episode = null, durationSec = 0) {
  if (!imdbId) return [];
  const imdbNumber = String(imdbId).replace(/^tt/, '');
  const cacheKey = imdbNumber + '_' + (season || 0) + '_' + (episode || 0);
  let list = subtitleCache.get(cacheKey);
  if (!list) {
    list = [];
    try {
      const u = season && episode
        ? 'https://rest.opensubtitles.org/search/episode-' + episode + '/imdbid-' + imdbNumber + '/season-' + season + '/sublanguageid-eng'
        : 'https://rest.opensubtitles.org/search/imdbid-' + imdbNumber + '/sublanguageid-eng';
      const r = await fetchUrl(u, { 'User-Agent': 'VLSub 0.10.2' });
      const data = JSON.parse(r.body.toString('utf-8'));
      if (Array.isArray(data)) {
        for (const sd of data) {
          if (sd.SubLanguageID !== 'eng' || !sd.SubDownloadLink) continue;
          if (sd.SubFormat && !/srt|vtt/i.test(sd.SubFormat)) continue;
          if (season && episode && (parseInt(sd.SeriesSeason) !== +season || parseInt(sd.SeriesEpisode) !== +episode)) continue;
          list.push({
            url: sd.SubDownloadLink,
            lenSec: (parseInt(sd.MovieTimeMS || 0, 10) || 0) / 1000,
            hi: sd.SubHearingImpaired === '1',
            downloads: parseInt(sd.SubDownloadsCnt || 0, 10),
            release: sd.MovieReleaseName || sd.SubFileName || 'English',
          });
        }
      }
    } catch (e) { /* fallthrough */ }
    if (!list.length) {
      try {
        const u = season && episode
          ? 'https://opensubtitles-v3.strem.io/subtitles/series/tt' + imdbNumber + ':' + season + ':' + episode + '.json'
          : 'https://opensubtitles-v3.strem.io/subtitles/movie/tt' + imdbNumber + '.json';
        const r = await fetchUrl(u);
        const data = JSON.parse(r.body.toString('utf-8'));
        (data.subtitles || []).filter(x => x.lang === 'eng' || x.lang === 'en').forEach((x, i) =>
          list.push({ url: x.url, lenSec: 0, hi: false, downloads: 100 - i, release: 'English #' + (i + 1) }));
      } catch (e) { /* ignore */ }
    }
    subtitleCache.set(cacheKey, list);
  }
  const scored = list.map(x => {
    let sc = Math.log10(x.downloads + 10);
    if (durationSec && x.lenSec) {
      const diff = Math.abs(x.lenSec - durationSec);
      sc += diff < 2 ? 10 : diff < 10 ? 7 : diff < 60 ? 3 : diff < 180 ? 0 : -6;
    }
    if (x.hi) sc -= 1.5;
    return { ...x, sc };
  }).sort((a, b) => b.sc - a.sc);
  return scored.map((x, i) => ({
    url: x.url,
    label: (i === 0 ? 'Best match' : 'Alt ' + i) + (x.lenSec && durationSec ? ' (' + (x.lenSec - durationSec >= 0 ? '+' : '') + Math.round(x.lenSec - durationSec) + 's)' : '') + (x.hi ? ' · SDH' : ''),
    release: x.release,
  }));
}

async function getEnglishSubtitleUrl(imdbId, season = null, episode = null, durationSec = 0) {
  const list = await getEnglishSubtitleList(imdbId, season, episode, durationSec);
  return list.length ? list[0].url : null;
}

// HTTP Server & Serverless Handler (Works on Render, Railway, Docker & Vercel)
const requestHandler = async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // ==========================================
  // API: HEALTH CHECK (Render / Railway / Cloud)
  // ==========================================
  if (pathname === '/api/health' || pathname === '/healthz') {
    loadMovies();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      status: 'ok',
      brand: 'SCANE',
      uptime: Math.floor(process.uptime()),
      catalogCount: rawMoviesDb.length,
      moviesCount: moviesOnly.length,
      seriesCount: showsList.length
    }));
  }

  // ==========================================
  // API: SAHIFA BO'LIMLARI (FOTO 1 BILAN 1:1 MOS)
  // Trending, New Release, Recommended, TV Series, Top Rated
  // ==========================================
  if (pathname === '/api/sections') {
    loadMovies();

    // 1. Trending (Foto 1 dagi Monkey Man, Dune, Bad Boys, Furiosa...)
    const trendingQueries = ['Monkey Man', 'Dune', 'Bad Boys', 'Furiosa', 'Joker', 'Inside Out 2'];
    const trending = [];
    for (const q of trendingQueries) {
      const match = allCatalog.find(m => m.title.toLowerCase().includes(q.toLowerCase()));
      if (match && !trending.some(x => x.id === match.id)) trending.push(match);
    }
    // Agar yetmasa, yuqori reytingli filmlardan to'ldiramiz
    for (const m of moviesOnly) {
      if (trending.length >= 8) break;
      if (!trending.some(x => x.id === m.id)) trending.push(m);
    }

    // 2. New Release (Foto 1 dagi The Instigators, Inside Out 2, Joker, Dune...)
    const newReleaseQueries = ['The Instigators', 'Inside Out 2', 'Joker', 'Deadpool', 'Fallout', 'Saw X'];
    const newReleases = [];
    for (const q of newReleaseQueries) {
      const match = allCatalog.find(m => m.title.toLowerCase().includes(q.toLowerCase()));
      if (match && !newReleases.some(x => x.id === match.id)) newReleases.push(match);
    }
    for (const m of moviesOnly.filter(x => x.year === '2024' || x.year === '2023')) {
      if (newReleases.length >= 8) break;
      if (!newReleases.some(x => x.id === m.id)) newReleases.push(m);
    }

    // 3. Recommended (Foto 1 dagi Jackpot, Saw X, Deadpool & Wolverine, The Fall Guy...)
    const recQueries = ['Jackpot', 'Saw X', 'Deadpool', 'The Fall Guy', 'John Wick', 'Oppenheimer'];
    const recommended = [];
    for (const q of recQueries) {
      const match = allCatalog.find(m => m.title.toLowerCase().includes(q.toLowerCase()));
      if (match && !recommended.some(x => x.id === match.id)) recommended.push(match);
    }
    for (const m of moviesOnly) {
      if (recommended.length >= 8) break;
      if (!recommended.some(x => x.id === m.id) && (m.rating || 0) >= 8.0) recommended.push(m);
    }

    // 4. TV Series (Teleseriallar — Breaking Bad, Fallout, Squid Game, Wednesday...)
    const tvSeries = showsList.slice(0, 10);

    // 5. Top Rated IMDb 250
    const topRated = [...moviesOnly].sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 10);

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(JSON.stringify({
      trending,
      newReleases,
      recommended,
      tvSeries,
      topRated
    }));
  }

  // ==========================================
  // API: FEATURED (CAROUSEL & HERO)
  // ==========================================
  if (pathname === '/api/featured') {
    loadMovies();

    const featuredQueries = [
      'Joker',
      'Dune',
      'The Instigators',
      'Bad Boys',
      'Inside Out 2',
      'Furiosa',
      'Monkey Man',
      'Oppenheimer',
      'Breaking Bad'
    ];

    const featured = [];
    for (const q of featuredQueries) {
      const match = allCatalog.find(item => item.title.toLowerCase().includes(q.toLowerCase()));
      if (match && !featured.some(f => f.id === match.id)) {
        featured.push(match);
      }
    }

    if (featured.length < 7) {
      for (const m of allCatalog) {
        if (featured.length >= 8) break;
        if (!featured.some(f => f.id === m.id)) featured.push(m);
      }
    }

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(JSON.stringify({ featured: featured.slice(0, 8) }));
  }

  // ==========================================
  // API: KINOLAR KATALOGI
  // ==========================================
  if (pathname === '/api/movies') {
    loadMovies();

    const q = (parsedUrl.query.q || '').toLowerCase().trim();
    const category = parsedUrl.query.category || 'all';
    const genre = (parsedUrl.query.genre || '').toLowerCase().trim();
    const page = parseInt(parsedUrl.query.page || '1', 10);
    const limit = parseInt(parsedUrl.query.limit || '24', 10);

    let items = allCatalog;

    if (category === 'movies') {
      items = moviesOnly;
    } else if (category === 'series') {
      items = showsList;
    } else if (category === 'popular') {
      items = [...allCatalog].sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (category === 'top') {
      items = [...allCatalog].filter(i => (i.rating || 0) >= 8.2).sort((a, b) => b.rating - a.rating);
    }

    if (genre && genre !== 'all') {
      items = items.filter(m => (m.genres || []).some(g => g.toLowerCase() === genre));
    }

    const decade = (parsedUrl.query.decade || '').trim();
    if (decade) {
      if (decade === '2020s') items = items.filter(m => +m.year >= 2020);
      else if (decade === '2010s') items = items.filter(m => +m.year >= 2010 && +m.year < 2020);
      else if (decade === '2000s') items = items.filter(m => +m.year >= 2000 && +m.year < 2010);
      else if (decade === 'classic') items = items.filter(m => +m.year > 0 && +m.year < 2000);
    }

    const minRating = parseFloat(parsedUrl.query.minRating || '0');
    if (minRating > 0) {
      items = items.filter(m => (m.rating || 0) >= minRating);
    }

    const maxDur = parseInt(parsedUrl.query.maxDur || '0', 10);
    if (maxDur > 0) {
      items = items.filter(m => !m.is_series && (m.duration_min || 999) <= maxDur);
    }

    if (parsedUrl.query.kids === '1') {
      items = items.filter(m => (m.genres || []).some(g => /animation|family|comedy|adventure|fantasy/i.test(g)) && !(m.genres || []).some(g => /horror|crime|thriller/i.test(g)));
    }

    if (q) {
      const tokens = q.split(/\s+/);
      items = items.filter(m => {
        const full = `${m.title} ${m.clean_title || ''} ${m.overview || ''}`.toLowerCase();
        return tokens.every(tok => full.includes(tok));
      });
    }

    const total = items.length;
    const startIndex = (page - 1) * limit;
    const paginated = items.slice(startIndex, startIndex + limit);

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(JSON.stringify({
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items: paginated
    }));
  }

  // ==========================================
  // API: SERIALNING BARCHA FASLLARI VA QISMLARI
  // ==========================================
  if (pathname.startsWith('/api/series/')) {
    loadMovies();
    const showId = pathname.replace('/api/series/', '').trim();
    const show = showsList.find(s => s.id === showId || s.title.toLowerCase() === decodeURIComponent(showId).toLowerCase());

    if (!show) {
      res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Serial topilmadi' }));
    }

    // Fasllar bo'yicha ma'lumotlarni boyitish (live TMDB fallback if not cached yet)
    const seasonsInfo = {};
    for (const sNum of show.seasons) {
      const cacheKey = `${show.tmdb_id}_s${sNum}`;
      let sData = seriesCache[cacheKey];
      if (!sData && show.tmdb_id) {
        try {
          const liveSeason = await verify.tmdb(`/tv/${show.tmdb_id}/season/${sNum}`);
          if (liveSeason && liveSeason.episodes) {
            const epMap = {};
            for (const ep of liveSeason.episodes) {
              epMap[ep.episode_number] = {
                name: ep.name,
                overview: ep.overview,
                still_path: ep.still_path,
                vote_average: ep.vote_average ? Math.round(ep.vote_average * 10) / 10 : null,
                runtime: ep.runtime
              };
            }
            sData = {
              name: liveSeason.name || `Season ${sNum}`,
              overview: liveSeason.overview || '',
              poster_path: liveSeason.poster_path || '',
              vote_average: show.rating,
              episodes: epMap
            };
            seriesCache[cacheKey] = sData;
          }
        } catch (e) {}
      }
      // Enrich episodes with season cache data
      if (sData && sData.episodes) {
        for (const ep of show.episodes) {
          if (ep.season === sNum && sData.episodes[ep.episode]) {
            const ei = sData.episodes[ep.episode];
            ep.episode_name = ei.name || ep.episode_name || `Episode ${ep.episode}`;
            ep.episode_overview = ei.overview || ep.episode_overview || show.overview;
            if (ei.still_path) ep.episode_still = `https://image.tmdb.org/t/p/w500${ei.still_path}`;
            if (ei.vote_average) ep.episode_rating = ei.vote_average;
          }
        }
      }
      seasonsInfo[sNum] = {
        season: sNum,
        name: sData && sData.name ? sData.name : `Season ${sNum}`,
        overview: sData && sData.overview ? sData.overview : `${show.title} — Season ${sNum}.`,
        poster: sData && sData.poster_path ? `https://image.tmdb.org/t/p/w500${sData.poster_path}` : show.poster,
        rating: sData && sData.vote_average ? sData.vote_average : show.rating
      };
    }

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(JSON.stringify({
      ...show,
      seasonsDetails: seasonsInfo
    }));
  }

  // ==========================================
  // API: AQLLI QIDIRUV (local catalog) - KUCHLI FUZZY SEARCH
  // ==========================================
  if (pathname === '/api/search') {
    loadMovies();
    const q = (parsedUrl.query.q || '').trim();
    if (!q) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Qidiruv kiritilmadi' }));
    }

    const lowerQ = q.toLowerCase();
    const qTokens = lowerQ.split(/\s+/).filter(t => t.length > 0);

    // Scoring function
    function scoreItem(m) {
      const title = (m.title || '').toLowerCase();
      const cleanTitle = (m.clean_title || '').toLowerCase();
      const fullText = `${title} ${cleanTitle} ${(m.genres || []).join(' ')} ${m.overview || ''}`.toLowerCase();
      let score = 0;

      // Exact match
      if (title === lowerQ || cleanTitle === lowerQ) score += 100;
      // Starts with
      if (title.startsWith(lowerQ) || cleanTitle.startsWith(lowerQ)) score += 50;
      // Contains full query
      if (title.includes(lowerQ) || cleanTitle.includes(lowerQ)) score += 30;
      // Each token match
      for (const tok of qTokens) {
        if (title.includes(tok) || cleanTitle.includes(tok)) score += 15;
        else if (fullText.includes(tok)) score += 3;
      }
      // Bonus for rating (only for real matches)
      if (score >= 15) score += (m.rating || 0) * 0.5; else if (score < 6) score = 0;
      return score;
    }

    // Filter: at least one token must match title or clean_title
    const scored = allCatalog
      .map(m => ({ m, score: scoreItem(m) }))
      .filter(x => x.score > 0);

    // Also do partial token match — if any single token appears in title
    if (scored.length === 0 && qTokens.length > 0) {
      const partial = allCatalog.map(m => {
        const title = (m.title || m.clean_title || '').toLowerCase();
        let s = 0;
        for (const tok of qTokens) {
          if (title.includes(tok)) s += 10;
        }
        return { m, score: s };
      }).filter(x => x.score > 0);
      partial.sort((a, b) => b.score - a.score);
      const items = partial.slice(0, 20).map(x => x.m);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ total: items.length, items }));
    }

    scored.sort((a, b) => b.score - a.score);
    const items = scored.slice(0, 30).map(x => x.m);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ total: items.length, items }));
  }

  // ==========================================
  // API: ITEM (movie / show / episode -> card data)
  // ==========================================
  if (pathname.startsWith('/api/item/') || pathname.startsWith('/api/movie/')) {
    loadMovies();
    const id = decodeURIComponent(pathname.replace(/^\/api\/(item|movie)\//, '').trim());
    let found = moviesOnly.find(m => m.id === id) || showsList.find(s => s.id === id);
    if (!found && pathname.startsWith('/api/item/')) {
      const ep = rawMoviesDb.find(m => m.id === id && m.is_series);
      if (ep) found = showsList.find(s => s.episodes.some(e => e.id === id));
    }
    if (!found) return sendJson(res, 404, { error: 'Not found' });
    const { episodes, ...rest } = found;
    return sendJson(res, 200, pathname.startsWith('/api/item/') ? rest : found);
  }

  // ==========================================
  // API: RELATED — franchise parts (sequels/prequels) + same universe + similar
  // ==========================================
  if (pathname.startsWith('/api/related/')) {
    loadMovies();
    const itemId = decodeURIComponent(pathname.replace('/api/related/', '').trim());
    const item = allCatalog.find(m => m.id === itemId);
    if (!item) return sendJson(res, 404, { parts: [], universe: [], related: [] });
    const strip = ({ episodes, ...r }) => r;
    const byTmdb = new Map();
    for (const m of moviesOnly) if (m.tmdb_id) byTmdb.set('movie' + m.tmdb_id, m);
    for (const s of showsList) if (s.tmdb_id) byTmdb.set('tv' + s.tmdb_id, s);
    const type = item.is_series ? 'tv' : 'movie';
    const used = new Set([item.id]);
    let parts = [], universe = [], related = [], collectionName = null;

    try {
      if (item.tmdb_id) {
        // 1) Franchise / collection parts in release order
        if (type === 'movie') {
          const det = await verify.tmdb('/movie/' + item.tmdb_id);
          if (det && det.belongs_to_collection) {
            const col = await verify.tmdb('/collection/' + det.belongs_to_collection.id);
            collectionName = col.name || det.belongs_to_collection.name;
            const ps = (col.parts || []).filter(p => p.release_date).sort((a, b) => a.release_date.localeCompare(b.release_date));
            parts = ps.map((p, i) => {
              const lib = byTmdb.get('movie' + p.id);
              return lib ? { ...strip(lib), part: i + 1, current: lib.id === item.id, available: true }
                : { id: 'tmdb_movie_' + p.id, tmdb_id: p.id, type: 'movie', title: p.title, year: (p.release_date || '').slice(0, 4),
                    poster: p.poster_path ? 'https://image.tmdb.org/t/p/w500' + p.poster_path : '', rating: p.vote_average ? +p.vote_average.toFixed(1) : null,
                    part: i + 1, available: false };
            });
            parts.forEach(p => used.add(p.id));
          }
        }
        // 2) Same universe: TMDB keywords (e.g. "marvel cinematic universe") -> library items sharing keywords
        const kw = await verify.tmdb('/' + type + '/' + item.tmdb_id + '/keywords');
        const kwIds = new Set((kw.keywords || kw.results || []).map(k => k.id));
        const UNIVERSE_KW = new Set([180547, 9715, 9717, 229266, 155030, 312528, 316741, 179431]); // MCU, superhero, comics, DC, Star Wars...
        const strongKw = [...kwIds].filter(k => UNIVERSE_KW.has(k));
        if (strongKw.length) {
          for (const k of strongKw.slice(0, 2)) {
            for (const t of ['movie', 'tv']) {
              const disc = await verify.tmdb('/discover/' + t + '?with_keywords=' + k + '&sort_by=popularity.desc');
              for (const r of (disc.results || [])) {
                const lib = byTmdb.get(t + r.id);
                if (lib && !used.has(lib.id)) { universe.push(strip(lib)); used.add(lib.id); }
              }
            }
          }
        }
        // 3) Recommendations that exist in our library
        for (const ep of ['recommendations', 'similar']) {
          const rec = await verify.tmdb('/' + type + '/' + item.tmdb_id + '/' + ep);
          for (const r of (rec.results || [])) {
            const lib = byTmdb.get(type + r.id);
            if (lib && !used.has(lib.id)) { related.push(strip(lib)); used.add(lib.id); }
          }
        }
      }
    } catch (e) { /* network issues -> fall back to genre */ }

    // 4) Genre fallback to always fill the row
    if (related.length < 12) {
      const g = item.genres || [];
      const pool = (item.is_series ? showsList : moviesOnly)
        .filter(m => !used.has(m.id))
        .map(m => ({ m, sc: (m.genres || []).filter(x => g.includes(x)).length * 10 + (m.rating || 0) }))
        .filter(x => x.sc > 10).sort((a, b) => b.sc - a.sc).slice(0, 12 - related.length);
      for (const x of pool) { related.push(strip(x.m)); used.add(x.m.id); }
    }
    return sendJson(res, 200, { collectionName, parts, universe: universe.slice(0, 16), related: related.slice(0, 16) });
  }

  // ==========================================
  // API: ONLINE SEARCH — TMDB catalogue, flags what is already in the library
  // ==========================================
  if (pathname === '/api/online-search' || pathname === '/api/rutube-search') {
    loadMovies();
    const q = (parsedUrl.query.q || '').trim();
    if (!q) return sendJson(res, 200, { items: [] });
    try {
      const data = await verify.tmdb('/search/multi?include_adult=false&query=' + encodeURIComponent(q));
      const libMovie = new Map(moviesOnly.filter(m => m.tmdb_id).map(m => [String(m.tmdb_id), m]));
      const libTv = new Map(showsList.filter(m => m.tmdb_id).map(m => [String(m.tmdb_id), m]));
      const items = (data.results || [])
        .filter(r => (r.media_type === 'movie' || r.media_type === 'tv') && r.poster_path)
        .filter(r => (r.vote_count || 0) >= 20)
        .slice(0, 10)
        .map(r => {
          const type = r.media_type;
          const lib = (type === 'movie' ? libMovie : libTv).get(String(r.id));
          return {
            id: lib ? lib.id : 'tmdb_' + type + '_' + r.id,
            tmdb_id: r.id, type,
            title: r.title || r.name,
            year: (r.release_date || r.first_air_date || '').slice(0, 4),
            poster: 'https://image.tmdb.org/t/p/w342' + r.poster_path,
            rating: r.vote_average ? +r.vote_average.toFixed(1) : null,
            overview: r.overview,
            is_series: type === 'tv',
            in_library: !!lib,
          };
        });
      return sendJson(res, 200, { total: items.length, items });
    } catch (err) {
      return sendJson(res, 200, { total: 0, items: [], error: err.message });
    }
  }

  // ==========================================
  // API: RESOLVE — find a VERIFIED English-original upload for a TMDB title
  // and add it to the library. Never returns an unverified video.
  // ==========================================
  if (pathname === '/api/resolve') {
    loadMovies();
    const type = parsedUrl.query.type === 'tv' ? 'tv' : 'movie';
    const tmdbId = parseInt(parsedUrl.query.tmdb_id, 10);
    if (!tmdbId) return sendJson(res, 400, { found: false });
    const key = type + tmdbId;
    if (resolveInFlight.has(key)) return sendJson(res, 200, await resolveInFlight.get(key));
    const job = (async () => {
      try {
        if (type === 'movie') {
          const existing = moviesOnly.find(m => String(m.tmdb_id) === String(tmdbId));
          if (existing) return { found: true, id: existing.id, is_series: false };
          const m = await verify.findMovie(tmdbId);
          if (!m) return { found: false };
          if (!rawMoviesDb.some(x => x.id === m.id)) { rawMoviesDb.push(m); persistDb(); }
          return { found: true, id: m.id, is_series: false };
        } else {
          const eps = await verify.findShowEpisodes(tmdbId);
          if (!eps.length) return { found: false };
          let added = 0;
          for (const e of eps) {
            if (rawMoviesDb.some(x => x.id === e.id)) continue;
            const dupe = rawMoviesDb.some(x => x.is_series && String(x.tmdb_id) === String(tmdbId) && +x.season === e.season && +x.episode === e.episode);
            if (!dupe) { rawMoviesDb.push(e); added++; }
          }
          if (added) persistDb();
          loadMovies(true);
          const show = showsList.find(s => String(s.tmdb_id) === String(tmdbId));
          return show ? { found: true, id: show.id, is_series: true, added } : { found: false };
        }
      } catch (e) { return { found: false, error: e.message }; }
    })();
    resolveInFlight.set(key, job);
    const result = await job;
    resolveInFlight.delete(key);
    return sendJson(res, 200, result);
  }

  // ==========================================
  // API: SUBTITLE LIST (alternatives so the user can pick a better-synced one)
  // ==========================================
  if (pathname.startsWith('/api/subtitle-list/')) {
    loadMovies();
    const vid = pathname.replace('/api/subtitle-list/', '').trim();
    const info = rawMoviesDb.find(m => m.id === vid);
    if (!info || !info.imdb_id) return sendJson(res, 200, { items: [] });
    const list = await getEnglishSubtitleList(info.imdb_id, info.is_series ? info.season : null, info.is_series ? info.episode : null, (info.duration_min || 0) * 60);
    return sendJson(res, 200, { items: list.slice(0, 8).map(s => ({ label: s.label, url: '/api/subtitles?url=' + encodeURIComponent(s.url) })) });
  }

  // ==========================================
  // API: RICH EXTRAS (Trailer, Cast & Crew, Certification, Runtime, Tagline, BoxOffice)
  // ==========================================
  if (pathname.startsWith('/api/extras/')) {
    loadMovies();
    const id = decodeURIComponent(pathname.replace('/api/extras/', '').trim());
    const item = allCatalog.find(m => m.id === id);
    if (!item || !item.tmdb_id) return sendJson(res, 200, { cast: [], director: null, trailerKey: null });
    const type = item.is_series ? 'tv' : 'movie';
    try {
      const det = await verify.tmdb(`/${type}/${item.tmdb_id}?append_to_response=videos,credits,release_dates,content_ratings`);
      const vids = (det.videos && det.videos.results) || [];
      const yt = vids.filter(v => v.site === 'YouTube' && v.key);
      const trailer = yt.find(v => v.type === 'Trailer' && /official/i.test(v.name))
        || yt.find(v => v.type === 'Trailer')
        || yt.find(v => v.type === 'Teaser')
        || yt[0] || null;
      const cast = ((det.credits && det.credits.cast) || []).slice(0, 14).map(c => ({
        id: c.id,
        name: c.name,
        character: c.character || '',
        photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : '',
      }));
      const crew = (det.credits && det.credits.crew) || [];
      const dir = crew.find(c => c.job === 'Director') || (det.created_by && det.created_by[0]) || null;

      let cert = '';
      if (type === 'movie' && det.release_dates && det.release_dates.results) {
        const us = det.release_dates.results.find(r => r.iso_3166_1 === 'US') || det.release_dates.results[0];
        if (us && us.release_dates) {
          const c = us.release_dates.find(x => x.certification);
          if (c) cert = c.certification;
        }
      } else if (type === 'tv' && det.content_ratings && det.content_ratings.results) {
        const us = det.content_ratings.results.find(r => r.iso_3166_1 === 'US') || det.content_ratings.results[0];
        if (us) cert = us.rating || '';
      }

      return sendJson(res, 200, {
        tagline: det.tagline || '',
        certification: cert || (item.rating >= 8 ? 'PG-13' : 'PG'),
        budget: det.budget || 0,
        revenue: det.revenue || 0,
        countries: (det.production_countries || []).map(c => c.name).slice(0, 2),
        studios: ((det.production_companies || det.networks) || []).map(c => c.name).slice(0, 3),
        director: dir ? { id: dir.id, name: dir.name } : null,
        trailerKey: trailer ? trailer.key : null,
        trailerName: trailer ? trailer.name : null,
        cast,
      });
    } catch (e) {
      return sendJson(res, 200, { cast: [], director: null, trailerKey: null });
    }
  }

  // ==========================================
  // API: ACTOR PAGE (Biography + Filmography in Library & Online)
  // ==========================================
  if (pathname.startsWith('/api/actor/')) {
    loadMovies();
    const personId = parseInt(pathname.replace('/api/actor/', '').trim(), 10);
    if (!personId) return sendJson(res, 400, { error: 'Invalid actor id' });
    try {
      const p = await verify.tmdb(`/person/${personId}?append_to_response=combined_credits`);
      const byTmdb = new Map();
      for (const m of moviesOnly) if (m.tmdb_id) byTmdb.set('movie' + m.tmdb_id, m);
      for (const s of showsList) if (s.tmdb_id) byTmdb.set('tv' + s.tmdb_id, s);
      const strip = ({ episodes, ...r }) => r;

      const credits = ((p.combined_credits && p.combined_credits.cast) || [])
        .filter(c => (c.media_type === 'movie' || c.media_type === 'tv') && c.poster_path)
        .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));

      const seen = new Set();
      const inLibrary = [], online = [];
      for (const c of credits) {
        const k = c.media_type + c.id;
        if (seen.has(k)) continue;
        seen.add(k);
        const lib = byTmdb.get(k);
        if (lib) {
          inLibrary.push(strip(lib));
        } else if (online.length < 18) {
          online.push({
            id: `tmdb_${c.media_type}_${c.id}`,
            tmdb_id: c.id,
            type: c.media_type,
            title: c.title || c.name,
            character: c.character || '',
            year: (c.release_date || c.first_air_date || '').slice(0, 4),
            poster: `https://image.tmdb.org/t/p/w342${c.poster_path}`,
            rating: c.vote_average ? +c.vote_average.toFixed(1) : null,
            is_series: c.media_type === 'tv',
            available: false,
          });
        }
      }
      return sendJson(res, 200, {
        id: p.id,
        name: p.name,
        biography: p.biography || '',
        birthday: p.birthday || '',
        place_of_birth: p.place_of_birth || '',
        known_for: p.known_for_department || 'Acting',
        photo: p.profile_path ? `https://image.tmdb.org/t/p/w342${p.profile_path}` : '',
        inLibrary,
        online,
      });
    } catch (e) {
      return sendJson(res, 404, { error: 'Actor not found' });
    }
  }

  // ==========================================
  // API: COLLECTIONS / FRANCHISES HUB
  // ==========================================
  if (pathname.startsWith('/api/collection-hub')) {
    loadMovies();
    const slug = (parsedUrl.query.slug || '').toLowerCase();
    const strip = ({ episodes, ...r }) => r;
    const matchers = {
      marvel: m => /marvel|avengers|spider-man|iron man|thor|captain america|deadpool|wolverine|guardians of the galaxy|black panther|doctor strange|venom|x-men|logan|eternals|ant-man|shang-chi|she-hulk|blade/i.test(`${m.title} ${m.overview}`),
      dc: m => /\bdc\b|batman|joker|superman|wonder woman|aquaman|justice league|flash|suicide squad|shazam|harley quinn|watchmen|penguin|gotham/i.test(`${m.title} ${m.overview}`),
      starwars: m => /star wars|mandalorian|jedi|sith|skywalker|darth|maul|rogue one|andor|obi-wan|ahsoka/i.test(`${m.title} ${m.overview}`),
      animation: m => (m.genres || []).some(g => /animation/i.test(g)),
      scifi: m => (m.genres || []).some(g => /sci-fi|science fiction/i.test(g)),
      crime: m => (m.genres || []).some(g => /crime|mystery/i.test(g)),
      horror: m => (m.genres || []).some(g => /horror|thriller/i.test(g)),
      topimdb: m => (m.rating || 0) >= 8.1,
    };
    const fn = matchers[slug] || (() => true);
    const items = allCatalog.filter(fn).sort((a, b) => (b.rating || 0) - (a.rating || 0)).map(strip);
    return sendJson(res, 200, { slug, total: items.length, items });
  }

  // ==========================================
  // API: SCENE ENGLISH — SMART LANGUAGE LEARNING ECOSYSTEM
  // ==========================================
  if (pathname === '/api/learn/profile') {
    const userId = parsedUrl.query.userId || 'default';
    if (req.method === 'POST') {
      const body = await readBodyJson(req);
      const updated = sceneEnglish.updateProfile(body.userId || userId, body);
      return sendJson(res, 200, { profile: updated });
    }
    const profile = sceneEnglish.getOrCreateProfile(userId);
    return sendJson(res, 200, { profile });
  }

  if (pathname === '/api/learn/placement-questions') {
    return sendJson(res, 200, { questions: sceneEnglish.PLACEMENT_QUESTIONS });
  }

  if (pathname === '/api/learn/placement-submit' && req.method === 'POST') {
    const body = await readBodyJson(req);
    const result = sceneEnglish.evaluatePlacement(body.userId || 'default', body.answers || {}, body.goals || [], body.dailyMinutes || 15);
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/learn/lookup') {
    const word = parsedUrl.query.word || '';
    const sentence = parsedUrl.query.sentence || '';
    const userId = parsedUrl.query.userId || 'default';
    try {
      const info = await sceneEnglish.lookupContextualWord({ word, sentence, userId });
      return sendJson(res, 200, info);
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (pathname === '/api/learn/vocab') {
    const userId = parsedUrl.query.userId || 'default';
    if (req.method === 'POST') {
      try {
        const body = await readBodyJson(req);
        const saved = sceneEnglish.saveUserVocab(body.userId || userId, body);
        return sendJson(res, 200, { entry: saved });
      } catch (e) {
        return sendJson(res, 400, { error: e.message });
      }
    }
    if (req.method === 'PUT') {
      const body = await readBodyJson(req);
      const updated = sceneEnglish.updateVocabStatus(body.userId || userId, body.vocabId, body.status);
      return sendJson(res, 200, { entry: updated });
    }
    if (req.method === 'DELETE') {
      const vocabId = parsedUrl.query.vocabId || '';
      const removed = sceneEnglish.deleteUserVocab(userId, vocabId);
      return sendJson(res, 200, { removed });
    }
    const items = sceneEnglish.getUserVocabList(userId);
    return sendJson(res, 200, { items, total: items.length });
  }

  if (pathname === '/api/learn/review-queue') {
    const userId = parsedUrl.query.userId || 'default';
    return sendJson(res, 200, sceneEnglish.getReviewQueue(userId));
  }

  if (pathname === '/api/learn/review-submit' && req.method === 'POST') {
    try {
      const body = await readBodyJson(req);
      const out = sceneEnglish.submitVocabReview(body.userId || 'default', body);
      return sendJson(res, 200, out);
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (pathname === '/api/learn/translate-cues' && req.method === 'POST') {
    const body = await readBodyJson(req);
    const translations = await sceneEnglish.translateBatchCues(body.cues || []);
    return sendJson(res, 200, { translations });
  }

  if (pathname === '/api/learn/dictation-check' && req.method === 'POST') {
    const body = await readBodyJson(req);
    const resCheck = sceneEnglish.evaluateDictation(body.targetSentence || '', body.userInput || '');
    return sendJson(res, 200, resCheck);
  }

  if (pathname === '/api/learn/grammar') {
    const sentence = parsedUrl.query.sentence || '';
    const level = parsedUrl.query.level || 'B1';
    if (sentence) {
      return sendJson(res, 200, { analysis: sceneEnglish.analyzeSentenceGrammar(sentence, level) });
    }
    return sendJson(res, 200, { rules: sceneEnglish.GRAMMAR_RULES });
  }

  if (pathname === '/api/learn/exercise-submit' && req.method === 'POST') {
    const body = await readBodyJson(req);
    const rec = sceneEnglish.recordExerciseAttempt(body.userId || 'default', body);
    return sendJson(res, 200, { attempt: rec });
  }

  if (pathname === '/api/learn/ai-tutor' && req.method === 'POST') {
    try {
      const body = await readBodyJson(req);
      const reply = await sceneEnglish.askAiTutor(body);
      return sendJson(res, 200, reply);
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (pathname.startsWith('/api/learn/media-pack/')) {
    loadMovies();
    const videoId = decodeURIComponent(pathname.replace('/api/learn/media-pack/', '').trim());
    const movieInfo = rawMoviesDb.find(m => m.id === videoId) || allCatalog.find(m => m.id === videoId) || {};
    let cues = [];

    try {
      let imdbId = movieInfo.imdb_id || '';
      if (!imdbId && movieInfo.tmdb_id) {
        const type = movieInfo.is_series ? 'tv' : 'movie';
        const extRes = await fetchUrl(`https://api.themoviedb.org/3/${type}/${movieInfo.tmdb_id}/external_ids?api_key=${TMDB_API_KEY}`);
        const extData = JSON.parse(extRes.body.toString('utf-8'));
        imdbId = extData.imdb_id || '';
      }
      if (imdbId) {
        const directSubUrl = await getEnglishSubtitleUrl(imdbId, movieInfo.is_series ? movieInfo.season : null, movieInfo.is_series ? movieInfo.episode : null, (movieInfo.duration_min || 0) * 60);
        if (directSubUrl) {
          const resp = await fetchUrl(directSubUrl, { 'User-Agent': 'VLSub 0.10.2' });
          let rawText = '';
          try { rawText = zlib.gunzipSync(resp.body).toString('utf-8'); }
          catch (e) { rawText = resp.body.toString('utf-8'); }
          cues = sceneEnglish.parseVttOrSrtToCues(rawText);
        }
      }
    } catch (e) {}

    // If external subtitles were unavailable, synthesize structured scene cues from the movie's English synopsis & dialogue templates
    let hasOfficialSubtitles = cues.length > 0;
    if (!cues.length) {
      const ovSentences = String(movieInfo.overview || 'We need to figure out what is happening here right now. Actually, I have never seen anything like this before. If we stay together, we will find out the truth.')
        .split(/(?<=[.!?])\s+/)
        .filter(s => s.trim().length > 8);
      const dialogueSeed = [
        ...ovSentences,
        'Actually, we need to figure out what happened here right now.',
        'If you had told me earlier, we could have avoided this problem.',
        'I have never seen anything like this before in my entire life.',
        'Take a deep breath and calm down, you can always count on me.',
        'Every choice has a consequence, so we should be careful.'
      ];
      cues = dialogueSeed.map((txt, idx) => ({
        index: idx,
        startTime: idx * 14 + 5,
        endTime: idx * 14 + 12,
        text: txt
      }));
    }

    const pack = sceneEnglish.buildSceneLearningPack(cues, movieInfo);
    return sendJson(res, 200, {
      videoId,
      title: movieInfo.clean_title || movieInfo.title || 'Movie',
      isSeries: !!movieInfo.is_series,
      season: movieInfo.season || null,
      episode: movieInfo.episode || null,
      hasOfficialSubtitles,
      cuesCount: cues.length,
      cues: cues.slice(0, 600),
      scenes: pack.scenes,
      educationalMeta: pack.educationalMeta
    });
  }

  if (pathname === '/api/learn/dashboard') {
    loadMovies();
    const userId = parsedUrl.query.userId || 'default';
    const summary = sceneEnglish.getDashboardSummary(userId, allCatalog);
    return sendJson(res, 200, summary);
  }

  if (pathname === '/api/learn/catalog') {
    loadMovies();
    const level = (parsedUrl.query.level || '').toUpperCase();
    const cat = (parsedUrl.query.cat || '').toLowerCase();
    const strip = ({ episodes, ...r }) => r;

    let list = allCatalog.map(m => {
      const edu = sceneEnglish.computeCatalogEduMeta(m);
      return {
        ...strip(m),
        firstEpisodeId: m.is_series && m.episodes && m.episodes[0] ? m.episodes[0].id : m.id,
        edu
      };
    });

    if (level && ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(level)) {
      list = list.filter(x => x.edu.cefr === level || (level === 'A1' && x.edu.cefr === 'A2') || (level === 'C2' && x.edu.cefr === 'C1'));
    }
    if (cat === 'beginner') list = list.filter(x => x.edu.cefr === 'A2');
    else if (cat === 'everyday') list = list.filter(x => x.edu.cefr === 'B1');
    else if (cat === 'listening') list = list.filter(x => x.edu.cefr === 'A2' || x.edu.cefr === 'B1');
    else if (cat === 'advanced') list = list.filter(x => x.edu.cefr === 'B2' || x.edu.cefr === 'C1');
    else if (cat === 'series') list = list.filter(x => x.is_series);

    return sendJson(res, 200, { total: list.length, items: list.slice(0, 60) });
  }

  // ==========================================
  // API: AUTHENTICATION (REGISTER, LOGIN, ME, LOGOUT)
  // ==========================================
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    const body = await readBodyJson(req);
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!name || !email || password.length < 4) {
      return sendJson(res, 400, { error: 'Please enter your name, email, and a password (min 4 characters).' });
    }
    if (platformDb.users.some(u => u.email.toLowerCase() === email || u.username === email)) {
      return sendJson(res, 409, { error: 'An account with this email already exists. Please sign in.' });
    }
    const newUser = {
      id: 'usr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      email,
      username: email.split('@')[0],
      passwordHash: hashPassword(password),
      role: email === 'admin@scane.tv' ? 'admin' : 'user',
      plan: 'free',
      createdAt: new Date().toISOString()
    };
    platformDb.users.push(newUser);
    const token = 'tok_' + crypto.randomBytes(18).toString('hex');
    platformDb.sessions[token] = newUser.id;
    savePlatformDb();
    return sendJson(res, 200, { user: sanitizeUser(newUser), token });
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readBodyJson(req);
    const loginId = String(body.email || body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = platformDb.users.find(u => u.email.toLowerCase() === loginId || (u.username && u.username.toLowerCase() === loginId));
    if (!user || user.passwordHash !== hashPassword(password)) {
      return sendJson(res, 401, { error: 'Invalid email/username or password.' });
    }
    const token = 'tok_' + crypto.randomBytes(18).toString('hex');
    platformDb.sessions[token] = user.id;
    savePlatformDb();
    return sendJson(res, 200, { user: sanitizeUser(user), token });
  }

  if (pathname === '/api/auth/me') {
    const user = getAuthUserFromReq(req, parsedUrl);
    if (!user) return sendJson(res, 401, { error: 'Not authenticated' });
    return sendJson(res, 200, { user: sanitizeUser(user) });
  }

  if (pathname === '/google-oauth-window') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in - Google Accounts</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;font-family:'Google Sans',Roboto,Arial,sans-serif}
  body{background:#fff;color:#202124;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .g-card{width:100%;max-width:400px;border:1px solid #dadce0;border-radius:8px;padding:36px 32px 28px}
  .g-logo{display:flex;justify-content:center;margin-bottom:14px}
  h1{font-size:24px;font-weight:400;text-align:center;margin-bottom:8px;color:#202124}
  .sub{font-size:16px;text-align:center;color:#202124;margin-bottom:24px}
  .sub strong{color:#1a73e8;font-weight:500}
  .saved-list{margin-bottom:18px;border-top:1px solid #e8eaed}
  .saved-item{display:flex;align-items:center;gap:12px;padding:12px 6px;border-bottom:1px solid #e8eaed;cursor:pointer;transition:background .15s}
  .saved-item:hover{background:#f8f9fa}
  .av{width:36px;height:36px;border-radius:50%;background:#1a73e8;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:500;font-size:15px}
  .field{margin-bottom:16px}
  .field label{display:block;font-size:12px;color:#5f6368;margin-bottom:5px;font-weight:500}
  .field input{width:100%;padding:13px 14px;border:1px solid #dadce0;border-radius:4px;font-size:15px;color:#202124;outline:none}
  .field input:focus{border-color:#1a73e8;box-shadow:0 0 0 1px #1a73e8}
  .actions{display:flex;align-items:center;justify-content:space-between;margin-top:26px}
  .btn-cancel{background:none;border:none;color:#1a73e8;font-weight:500;font-size:14px;cursor:pointer;padding:8px 12px;border-radius:4px}
  .btn-next{background:#1a73e8;color:#fff;border:none;padding:10px 24px;border-radius:4px;font-weight:500;font-size:14px;cursor:pointer}
  .btn-next:hover{background:#1557b0}
  .foot{font-size:12px;color:#5f6368;margin-top:24px;line-height:1.5}
</style>
</head>
<body>
  <div class="g-card">
    <div class="g-logo">
      <svg viewBox="0 0 24 24" width="40" height="40"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.85c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
    </div>
    <h1>Sign in with Google</h1>
    <div class="sub">to continue to <strong>SCANE</strong></div>
    <div id="savedBox" class="saved-list" style="display:none"></div>
    <form id="gForm">
      <div class="field">
        <label>Email or Gmail address</label>
        <input type="email" id="gEmail" placeholder="yourname@gmail.com" required autofocus>
      </div>
      <div class="field">
        <label>Full Name</label>
        <input type="text" id="gName" placeholder="Your Name" required>
      </div>
      <div class="actions">
        <button type="button" class="btn-cancel" onclick="window.close()">Cancel</button>
        <button type="submit" class="btn-next">Continue</button>
      </div>
    </form>
    <div class="foot">To continue, Google will share your name, email address, and profile picture with SCANE.</div>
  </div>
  <script>
    try {
      const saved = JSON.parse(localStorage.getItem('scane_google_accounts') || '[]');
      if (saved.length) {
        const box = document.getElementById('savedBox');
        box.style.display = 'block';
        box.innerHTML = saved.map(a => \`
          <div class="saved-item" onclick="pickAccount('\${a.email.replace(/'/g,'')}', '\${(a.name||'').replace(/'/g,'')}')">
            <div class="av">\${(a.name || a.email || 'G')[0].toUpperCase()}</div>
            <div>
              <div style="font-size:14px;font-weight:500;color:#202124">\${a.name}</div>
              <div style="font-size:12px;color:#5f6368">\${a.email}</div>
            </div>
          </div>
        \`).join('');
      }
    } catch(e){}
    function pickAccount(email, name) {
      if (window.opener) {
        window.opener.postMessage({ type: 'SCANE_GOOGLE_AUTH', email, name }, '*');
      }
      window.close();
    }
    document.getElementById('gForm').addEventListener('submit', e => {
      e.preventDefault();
      pickAccount(document.getElementById('gEmail').value.trim(), document.getElementById('gName').value.trim());
    });
  </script>
</body>
</html>`);
  }

  if (pathname === '/api/auth/google-config') {
    return sendJson(res, 200, {
      googleClientId: process.env.GOOGLE_CLIENT_ID || platformDb.googleClientId || '324819070960-vdpa542cusb5tq68p9mgm67hrncoi209.apps.googleusercontent.com'
    });
  }

  if (pathname === '/api/admin/google-config' && req.method === 'POST') {
    const body = await readBodyJson(req);
    platformDb.googleClientId = String(body.googleClientId || '').trim();
    savePlatformDb();
    return sendJson(res, 200, { ok: true, googleClientId: platformDb.googleClientId });
  }

  if (pathname === '/api/auth/google' && req.method === 'POST') {
    const body = await readBodyJson(req);
    let email = String(body.email || '').trim().toLowerCase();
    let name = String(body.name || '').trim();
    let picture = String(body.picture || '').trim();
    let googleId = String(body.googleId || '').trim();

    // If a real Google OAuth2 access_token is provided from google.accounts.oauth2 popup
    if (body.accessToken) {
      try {
        const uRes = await fetchUrl('https://www.googleapis.com/oauth2/v3/userinfo', {
          'Authorization': `Bearer ${body.accessToken}`
        });
        if (uRes.statusCode === 200) {
          const uInfo = JSON.parse(uRes.body.toString('utf-8'));
          if (uInfo.email) email = String(uInfo.email).toLowerCase();
          if (uInfo.name) name = String(uInfo.name);
          if (uInfo.picture) picture = String(uInfo.picture);
          if (uInfo.sub) googleId = String(uInfo.sub);
        }
      } catch (e) {}
    }

    // If a real Google Identity Services JWT credential is provided, decode its payload
    if (body.credential) {
      try {
        const parts = String(body.credential).split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
          if (payload.email) email = String(payload.email).toLowerCase();
          if (payload.name) name = String(payload.name);
          if (payload.picture) picture = String(payload.picture);
          if (payload.sub) googleId = String(payload.sub);
        }
      } catch (e) {
        return sendJson(res, 400, { error: 'Invalid Google credential token.' });
      }
    }

    if (!email || !email.includes('@')) {
      return sendJson(res, 400, { error: 'Please provide a valid Google email address.' });
    }
    if (!name) {
      name = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    let user = platformDb.users.find(u => u.email.toLowerCase() === email);
    if (!user) {
      user = {
        id: 'usr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name,
        email,
        username: email.split('@')[0],
        passwordHash: hashPassword('google_oauth_' + (googleId || email)),
        authProvider: 'google',
        avatar: picture || '',
        role: email === 'admin@scane.tv' ? 'admin' : 'user',
        plan: 'free',
        createdAt: new Date().toISOString()
      };
      platformDb.users.push(user);
    } else {
      user.authProvider = 'google';
      if (picture) user.avatar = picture;
      if (name && (!user.name || user.name === user.username)) user.name = name;
    }

    const token = 'tok_' + crypto.randomBytes(18).toString('hex');
    platformDb.sessions[token] = user.id;
    savePlatformDb();
    return sendJson(res, 200, { user: sanitizeUser(user), token });
  }

  // ==========================================
  // API: REPORTS / COMPLAINTS + AUTO ENGLISH STREAM FINDER
  // ==========================================
  if (pathname === '/api/reports') {
    loadMovies();
    if (req.method === 'GET') {
      return sendJson(res, 200, { reports: platformDb.reports });
    }
    if (req.method === 'POST') {
      const body = await readBodyJson(req);
      const videoId = String(body.videoId || '').trim();
      const mediaId = String(body.mediaId || videoId).trim();
      const reason = String(body.reason || 'russian_audio').trim();
      const details = String(body.details || '').trim();
      const user = getAuthUserFromReq(req, parsedUrl);
      const item = rawMoviesDb.find(m => m.id === videoId) || allCatalog.find(m => m.id === mediaId);
      const title = body.title || (item ? item.title : videoId);

      // Search Rutube for English-original alternative streams for this title
      let alternatives = [];
      try {
        const cleanTitle = (item ? (item.clean_title || item.title) : title).replace(/\(S\d+.*\)/i, '').trim();
        const year = item?.year || '';
        const q = item?.is_series && item?.season && item?.episode
          ? `${cleanTitle} season ${item.season} episode ${item.episode}`
          : `${cleanTitle} (${year || 'movie'})`;
        const results = await verify.rutubeSearch(q, 2);
        alternatives = results
          .filter(v => v && v.id && v.id !== videoId && (v.duration || 0) > 600)
          .filter(v => {
            const isTrusted = v.author && verify.TRUSTED_AUTHORS.has(v.author.id);
            const noCyr = !/[а-яёА-ЯЁ]/.test(v.title || '');
            const hasEn = /(in english|на английском|в оригинале|оригинал|субтитр)/i.test(`${v.title} ${v.description || ''}`);
            return isTrusted || noCyr || hasEn;
          })
          .slice(0, 5)
          .map(v => ({
            id: v.id,
            title: v.title,
            durationMin: Math.round((v.duration || 0) / 60),
            author: v.author ? v.author.name : 'Rutube',
            trusted: !!(v.author && verify.TRUSTED_AUTHORS.has(v.author.id))
          }));
      } catch (e) {}

      const report = {
        id: 'rep_' + Date.now().toString(36),
        videoId,
        mediaId,
        title,
        reason,
        details,
        userName: user ? user.name : (body.userName || 'User'),
        userEmail: user ? user.email : (body.userEmail || 'guest'),
        status: 'open',
        alternatives,
        createdAt: new Date().toISOString()
      };
      platformDb.reports.unshift(report);
      savePlatformDb();
      return sendJson(res, 200, { ok: true, report, alternatives });
    }
  }

  // ==========================================
  // API: ADMIN PANEL (OVERVIEW, REPLACE STREAM, CATALOG, USERS)
  // ==========================================
  if (pathname === '/api/admin/overview') {
    loadMovies();
    return sendJson(res, 200, {
      stats: {
        totalUsers: platformDb.users.length,
        vipUsers: platformDb.users.filter(u => u.plan === 'vip').length,
        totalVideos: rawMoviesDb.length,
        totalMovies: moviesOnly.length,
        totalSeries: showsList.length,
        cachedStreams: Object.keys(streamCache).length,
        openReports: platformDb.reports.filter(r => r.status === 'open').length,
        totalReports: platformDb.reports.length
      },
      reports: platformDb.reports.slice(0, 100),
      users: platformDb.users.map(sanitizeUser)
    });
  }

  if (pathname === '/api/admin/replace-stream' && req.method === 'POST') {
    loadMovies();
    const body = await readBodyJson(req);
    const oldId = String(body.oldVideoId || '').trim();
    const newId = String(body.newVideoId || '').trim().replace(/^.*\/video\/([a-z0-9]+)\/?.*$/i, '$1');
    const reportId = body.reportId || '';
    if (!oldId || !newId) return sendJson(res, 400, { error: 'Both oldVideoId and newVideoId are required' });

    const idx = rawMoviesDb.findIndex(m => m.id === oldId);
    if (idx === -1) return sendJson(res, 404, { error: 'Video not found in catalog' });

    rawMoviesDb[idx].id = newId;
    if (body.newTitle) rawMoviesDb[idx].title = body.newTitle;

    // Try to resolve & cache the new stream's master m3u8 immediately
    try {
      const sData = await resolveRutubeStream(newId);
      if (sData && sData.m3u8) {
        const r2 = await fetchUrl(sData.m3u8);
        const masterText = r2.body.toString('utf-8');
        if (masterText.includes('#EXTM3U')) {
          streamCache[newId] = { d: sData.duration || 0, m: masterText };
          try { fs.writeFileSync(STREAM_CACHE_FILE, JSON.stringify(streamCache)); } catch (e) {}
        }
      }
    } catch (e) {}

    persistDb();
    loadMovies(true);

    if (reportId) {
      const rep = platformDb.reports.find(r => r.id === reportId);
      if (rep) { rep.status = 'resolved'; rep.resolvedWith = newId; savePlatformDb(); }
    }
    return sendJson(res, 200, { ok: true, oldId, newId, item: rawMoviesDb[idx] });
  }

  if (pathname === '/api/admin/report-status' && req.method === 'POST') {
    const body = await readBodyJson(req);
    const rep = platformDb.reports.find(r => r.id === body.reportId);
    if (!rep) return sendJson(res, 404, { error: 'Report not found' });
    rep.status = body.status || 'resolved';
    savePlatformDb();
    return sendJson(res, 200, { ok: true, report: rep });
  }

  if (pathname === '/api/admin/delete-item' && req.method === 'POST') {
    loadMovies();
    const body = await readBodyJson(req);
    const id = String(body.id || '').trim();
    const before = rawMoviesDb.length;
    rawMoviesDb = rawMoviesDb.filter(m => m.id !== id && m.show_key !== id);
    if (rawMoviesDb.length !== before) {
      persistDb();
      loadMovies(true);
    }
    platformDb.reports.forEach(r => { if (r.videoId === id || r.mediaId === id) r.status = 'resolved'; });
    savePlatformDb();
    return sendJson(res, 200, { ok: true, removed: before - rawMoviesDb.length });
  }

  if (pathname === '/api/admin/add-item' && req.method === 'POST') {
    loadMovies();
    const body = await readBodyJson(req);
    const videoId = String(body.videoId || '').trim().replace(/^.*\/video\/([a-z0-9]+)\/?.*$/i, '$1');
    const title = String(body.title || '').trim();
    if (!videoId || !title) return sendJson(res, 400, { error: 'Title and Rutube Video ID are required' });
    if (rawMoviesDb.some(m => m.id === videoId)) {
      return sendJson(res, 409, { error: 'This video ID is already in the catalog' });
    }
    const newItem = {
      id: videoId,
      title,
      clean_title: title,
      raw_title: `${title} (${body.isSeries ? 'series' : 'movie'}, ${body.year || '2024'})`,
      year: String(body.year || '2024'),
      rating: parseFloat(body.rating) || 8.0,
      duration_min: parseFloat(body.durationMin) || 110,
      poster: body.poster || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=300&q=60',
      backdrop: body.backdrop || body.poster || '',
      overview: body.overview || 'Stream in HD with interactive English subtitles on SCANE.',
      genres: body.genres ? String(body.genres).split(',').map(s => s.trim()).filter(Boolean) : ['Drama'],
      is_series: !!body.isSeries,
      season: body.isSeries ? (parseInt(body.season, 10) || 1) : undefined,
      episode: body.isSeries ? (parseInt(body.episode, 10) || 1) : undefined,
      verified: true
    };
    rawMoviesDb.unshift(newItem);
    persistDb();
    loadMovies(true);
    return sendJson(res, 200, { ok: true, item: newItem });
  }

  if (pathname === '/api/admin/user-update' && req.method === 'POST') {
    const body = await readBodyJson(req);
    const u = platformDb.users.find(x => x.id === body.userId);
    if (!u) return sendJson(res, 404, { error: 'User not found' });
    if (body.plan) u.plan = body.plan;
    if (body.role) u.role = body.role;
    savePlatformDb();
    return sendJson(res, 200, { ok: true, user: sanitizeUser(u) });
  }

  // ==========================================
  // API: KINO OQIMI VA FAQAT INGLIZCHA SUBTITR
  // ==========================================
  if (pathname.startsWith('/api/stream/')) {
    loadMovies();
    const videoId = pathname.replace('/api/stream/', '').trim();
    if (!videoId) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Video ID yetishmayapti' }));
    }

    try {
      const movieInfo = rawMoviesDb.find(m => m.id === videoId);
      let streamData = null;
      let proxiedStreamUrl = null;

      try {
        streamData = await resolveRutubeStream(videoId);
        if (streamData && streamData.m3u8) {
          proxiedStreamUrl = `/api/proxy-m3u8?url=${encodeURIComponent(streamData.m3u8)}`;
        }
      } catch (resolveErr) {
        // Fallback to pre-resolved CDN stream cache (bypasses US/EU datacenter geo-blocks on /api/play/options)
        if (streamCache[videoId] && streamCache[videoId].m) {
          streamData = {
            title: movieInfo ? movieInfo.title : 'SCANE Stream',
            duration: streamCache[videoId].d || (movieInfo?.duration_min ? movieInfo.duration_min * 60 : 5400),
            m3u8: 'cached'
          };
          proxiedStreamUrl = `/api/cached-m3u8/${encodeURIComponent(videoId)}`;
        } else {
          throw resolveErr;
        }
      }

      if (!proxiedStreamUrl && streamCache[videoId] && streamCache[videoId].m) {
        streamData = {
          title: movieInfo ? movieInfo.title : 'SCANE Stream',
          duration: streamCache[videoId].d || (movieInfo?.duration_min ? movieInfo.duration_min * 60 : 5400),
          m3u8: 'cached'
        };
        proxiedStreamUrl = `/api/cached-m3u8/${encodeURIComponent(videoId)}`;
      }

      if (!proxiedStreamUrl) {
        throw new Error('Video oqimi topilmadi');
      }

      // Inglizcha subtitr
      let subtitleUrl = null;
      let imdbId = movieInfo ? movieInfo.imdb_id : '';

      if (!imdbId && movieInfo && movieInfo.tmdb_id) {
        try {
          const type = movieInfo.is_series ? 'tv' : 'movie';
          const extUrl = `https://api.themoviedb.org/3/${type}/${movieInfo.tmdb_id}/external_ids?api_key=${TMDB_API_KEY}`;
          const extRes = await fetchUrl(extUrl);
          const extData = JSON.parse(extRes.body.toString('utf-8'));
          imdbId = extData.imdb_id || '';
        } catch (e) {}
      }

      if (imdbId) {
        const directSubUrl = await getEnglishSubtitleUrl(imdbId, movieInfo?.is_series ? movieInfo.season : null, movieInfo?.is_series ? movieInfo.episode : null, streamData.duration || 0);
        if (directSubUrl) {
          subtitleUrl = `/api/subtitles?url=${encodeURIComponent(directSubUrl)}`;
        }
      }

      // Keyingi qismni aniqlash
      const nextEp = episodeToNextMap.get(videoId) || null;

      // Agar serial bo'lsa, butun serial qismlari ro'yxatini ham qo'shib beramiz (Player ichidagi Episodes sidebar uchun)
      let seriesEpisodesList = [];
      if (movieInfo && movieInfo.is_series) {
        for (const show of showsList) {
          if (show.episodes.some(e => e.id === videoId)) {
            seriesEpisodesList = show.episodes.map(e => ({
              id: e.id,
              title: e.episode_name || e.clean_title || e.title,
              season: e.season,
              episode: e.episode,
              durationMin: e.duration_min || 50,
              rating: e.episode_rating || show.rating,
              still: e.episode_still || show.poster
            }));
            break;
          }
        }
      }

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(JSON.stringify({
        success: true,
        videoId,
        title: movieInfo ? (movieInfo.episode_name || movieInfo.title) : streamData.title,
        cleanTitle: movieInfo ? (movieInfo.clean_title || movieInfo.title) : streamData.title,
        duration: streamData.duration,
        durationMin: movieInfo?.duration_min || Math.round((streamData.duration || 0) / 60),
        streamUrl: proxiedStreamUrl,
        subtitleUrl: subtitleUrl,
        subtitleLabel: subtitleUrl ? 'English' : null,
        isSeries: !!movieInfo?.is_series,
        season: movieInfo?.season || null,
        episode: movieInfo?.episode || null,
        nextEpisode: nextEp,
        allEpisodes: seriesEpisodesList
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // ==========================================
  // API: INGLIZCHA SUBTITR (.VTT) PROKSI
  // ==========================================
  if (pathname === '/api/subtitles') {
    const subUrl = parsedUrl.query.url;
    if (!subUrl) {
      res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
      return res.end('Subtitr URL parametri yetishmayapti');
    }

    try {
      const resp = await fetchUrl(subUrl, { 'User-Agent': 'VLSub 0.10.2' });
      let rawText = '';

      try {
        rawText = zlib.gunzipSync(resp.body).toString('utf-8');
      } catch (e) {
        rawText = resp.body.toString('utf-8');
      }

      const vttContent = srtToVtt(rawText);

      res.writeHead(200, {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400'
      });
      return res.end(vttContent);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      return res.end('Subtitr yuklanmadi: ' + err.message);
    }
  }

  // ==========================================
  // PROXY: CACHED MASTER M3U8 (For Cloud Datacenters)
  // ==========================================
  if (pathname.startsWith('/api/cached-m3u8/')) {
    const videoId = decodeURIComponent(pathname.replace('/api/cached-m3u8/', '').trim());
    const entry = streamCache[videoId];
    if (!entry || !entry.m) {
      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
      return res.end('Cached stream topilmadi');
    }
    const modifiedLines = entry.m.split(/\r?\n/).map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      if (trimmed.includes('.m3u8')) {
        return `/api/proxy-m3u8?url=${encodeURIComponent(trimmed)}`;
      }
      return `/api/proxy-ts?url=${encodeURIComponent(trimmed)}`;
    });
    res.writeHead(200, {
      'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range'
    });
    return res.end(modifiedLines.join('\n'));
  }

  // ==========================================
  // PROXY: M3U8 PLAYLIST PROKSI
  // ==========================================
  if (pathname === '/api/proxy-m3u8') {
    const targetUrl = parsedUrl.query.url;
    if (!targetUrl) {
      res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
      return res.end('URL parametri yetishmayapti');
    }

    try {
      const resp = await fetchUrl(targetUrl);
      const content = resp.body.toString('utf-8');
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

      const modifiedLines = content.split(/\r?\n/).map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;

        let absoluteUrl = trimmed;
        if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
          absoluteUrl = new URL(trimmed, baseUrl).href;
        }

        if (absoluteUrl.includes('.m3u8')) {
          return `/api/proxy-m3u8?url=${encodeURIComponent(absoluteUrl)}`;
        } else {
          return `/api/proxy-ts?url=${encodeURIComponent(absoluteUrl)}`;
        }
      });

      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Range'
      });
      return res.end(modifiedLines.join('\n'));
    } catch (err) {
      res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
      return res.end('Oqim xatosi: ' + err.message);
    }
  }

  // ==========================================
  // PROXY: TS SEGMENT PROKSI
  // ==========================================
  if (pathname === '/api/proxy-ts') {
    const targetUrl = parsedUrl.query.url;
    if (!targetUrl) {
      res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
      return res.end('URL parametri yetishmayapti');
    }

    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://rutube.ru/'
      };
      if (req.headers['range']) {
        headers['range'] = req.headers['range'];
      }

      function streamChunk(curUrl, redirects = 0) {
        if (redirects > 4) {
          res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
          return res.end('Too many redirects');
        }
        const parsed = url.parse(curUrl);
        const client = parsed.protocol === 'https:' ? https : http;
        const proxyReq = client.get(curUrl, { headers }, (proxyRes) => {
          if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
            return streamChunk(proxyRes.headers.location, redirects + 1);
          }

          const resHeaders = {
            'Content-Type': proxyRes.headers['content-type'] || 'video/MP2T',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Range'
          };
          if (proxyRes.headers['content-range']) {
            resHeaders['Content-Range'] = proxyRes.headers['content-range'];
          }
          if (proxyRes.headers['content-length']) {
            resHeaders['Content-Length'] = proxyRes.headers['content-length'];
          }
          if (proxyRes.headers['accept-ranges']) {
            resHeaders['Accept-Ranges'] = proxyRes.headers['accept-ranges'];
          }

          res.writeHead(proxyRes.statusCode, resHeaders);
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (e) => {
          if (!res.headersSent) {
            res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
          }
          res.end(e.message);
        });
      }

      streamChunk(targetUrl);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
      res.end(err.message);
    }
    return;
  }

  // ==========================================
  // STATIK FAYLLARNI UZATISH
  // ==========================================
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Taqiqlangan');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml'
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500);
        return res.end('Fayl xatosi');
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
};

const server = http.createServer(requestHandler);

if (!process.env.VERCEL) {
  const HOST = process.env.HOST || '0.0.0.0';
  server.listen(PORT, HOST, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 SCANE — STREAMING & INTERACTIVE ENGLISH PLATFORM`);
    console.log(`🌐 URL: http://localhost:${PORT} (listening on ${HOST}:${PORT})`);
    console.log(`✨ Catalog: ${rawMoviesDb.length} videos (${moviesOnly.length} movies, ${showsList.length} series)`);
    console.log(`📝 Subtitles: Interactive Click-to-Translate English`);
    console.log(`======================================================\n`);
  });
}

module.exports = requestHandler;
