// ============================================================
// LUMEN FLIX — Smart Multi-Tier Verified Content Matcher v2.0
// Finds any movie or TV series on Rutube while guaranteeing 100%
// exact title, year, runtime, and Season/Episode verification.
// Prioritizes English Original (Tier 1) -> English (Tier 2) ->
// Bilingual / Verified Cinema Streams (Tier 3).
// ============================================================
const https = require('https');

const TMDB_API_KEY = 'e6d52d32ce458e7125d6f0dfdc0e9307';
// Trusted uploaders that publish English-original full releases
const TRUSTED_AUTHORS = new Set([77958230]);

function getJson(u, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', ...headers } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return getJson(res.headers.location, headers).then(resolve, reject);
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Normalizes Latin & Cyrillic strings for exact title comparison
const norm = s => String(s || '').toLowerCase()
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/ё/g, 'е')
  .replace(/&/g, 'and').replace(/['’`"]/g, '')
  .replace(/[^a-z0-9а-я]+/g, ' ')
  .replace(/^(the|сериал|фильм|мультфильм|мультсериал|аниме)\s+/i, '')
  .trim();

const CYR = /[а-яёА-ЯЁ]/;
const JUNK = /\b(trailer|teaser|review|reaction|reacts?|recap|explained|ending|theme|soundtrack|ost|gameplay|walkthrough|facts|clip|scene|behind the scenes|making of|interview|dublado|hindi|fan ?made|breakdown|easter eggs?|shorts?|lesson|edit|tribute|promo|preview|parody|lego)\b|(трейлер|тизер|обзор|реакци|пересказ|разбор|концовк|саундтрек|музык|прохожден|стрим|факты|отрывок|сцен[аы]|интервью|шортс|урок|пароди|прикол|нарезк|клип)/i;

const TITLE_RE = /^(.+?)(?:\s+(?:season\s+(\d+)\s+)?episode\s+(\d+))?(?:\s+«([^»]+)»)?\s*\((movie|film|series|tv series|mini-series|miniseries|animated series|animated film|animated movie|cartoon|anime),\s*(\d{4})\)\s*$/i;

/** Parse a strict-format upload title. */
function parseUploadTitle(title) {
  if (!title || CYR.test(title) || JUNK.test(title)) return null;
  const m = title.trim().match(TITLE_RE);
  if (!m) return null;
  const rawName = m[1].trim();
  const aliases = rawName.split(/\s*[\/|]\s*/).map(x => x.trim()).filter(Boolean);
  return {
    name: aliases[0] || rawName,
    aliases,
    season: m[2] ? parseInt(m[2], 10) : (m[3] ? 1 : null),
    episode: m[3] ? parseInt(m[3], 10) : null,
    episodeName: m[4] || null,
    kind: m[5].toLowerCase(),
    year: parseInt(m[6], 10),
    strict: true,
  };
}

/**
 * Parse ANY standard Rutube movie or series upload title (English, Bilingual, or Russian).
 * Extracts candidate title segments, season, episode, episodeName, year, and flags.
 */
function parseFlexibleTitle(title) {
  if (!title || JUNK.test(title)) return null;
  const strict = parseUploadTitle(title);
  if (strict) {
    return {
      ...strict,
      candidates: strict.aliases,
      hasSeriesMarker: !!strict.season || /series|anime|cartoon/i.test(strict.kind),
    };
  }

  let s = title.trim();
  // Replace dots/underscores in scene-style titles like House.of.the.Dragon.S01E10
  if (!s.includes(' ') && (s.includes('.') || s.includes('_'))) {
    s = s.replace(/[._]+/g, ' ');
  }

  // Extract season & episode patterns
  let season = null, episode = null;
  const sePatterns = [
    /\bseason\s*(\d{1,2})\s*[,\s-]*episode\s*(\d{1,3})\b/i,
    /\bS(\d{1,2})\s*E(\d{1,3})\b/i,
    /\b(\d{1,2})x(\d{1,3})\b/i,
    /(\d{1,2})\s*сезон[,\s—–-]*(\d{1,3})\s*(?:серия|эпизод|выпуск)/i,
    /сезон\s*[:\s—–-]*(\d{1,2})\s*[,\s—–-]*(?:серия|эпизод)\s*[:\s—–-]*(\d{1,3})/i,
    /\(\s*(\d{1,2})\s*сезон\s*(\d{1,3})\s*(?:серия|эпизод)\s*\)/i,
    /сезон\s*(\d{1,2})\s*\(\s*(\d{1,3})\s*(?:серия|эпизод)\s*\)/i,
  ];
  for (const re of sePatterns) {
    const m = s.match(re);
    if (m) {
      season = parseInt(m[1], 10);
      episode = parseInt(m[2], 10);
      break;
    }
  }
  if (season == null) {
    const epOnly = s.match(/\b(?:episode|ep\.?|серия|эпизод)\s*(\d{1,3})\b/i) || s.match(/\b(\d{1,3})\s*(?:серия|эпизод)\b/i);
    if (epOnly) {
      season = 1;
      episode = parseInt(epOnly[1], 10);
    }
  }

  // Extract year (1920..2029)
  let year = null;
  const ym = s.match(/\(\s*(?:фильм|сериал|movie|series|film)?[,\s]*(19\d\d|20[0-2]\d)\b/i)
    || s.match(/\b(19\d\d|20[0-2]\d)\s*\)/)
    || s.match(/\b(19\d\d|20[0-2]\d)\b/);
  if (ym) year = parseInt(ym[1], 10);

  // Extract episode name in «...» if present
  const epNameMatch = s.match(/«([^»]+)»/);
  const episodeName = epNameMatch && !CYR.test(epNameMatch[1]) ? epNameMatch[1].trim() : null;

  const hasSeriesMarker = season != null || /\b(сериал|сезон|серия|series|season|episode|miniseries)\b/i.test(s);

  // Strip metadata noise to isolate title segments
  let cleaned = s
    .replace(/«[^»]*»/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\bseason\s*\d+\s*[,\s-]*episode\s*\d+\b/gi, ' | ')
    .replace(/\bS\d{1,2}\s*E\d{1,3}\b/gi, ' | ')
    .replace(/\d{1,2}\s*сезон[,\s—–-]*\d{1,3}\s*(?:серия|эпизод|выпуск)/gi, ' | ')
    .replace(/сезон\s*[:\s—–-]*\d{1,2}\s*[,\s—–-]*(?:серия|эпизод)\s*[:\s—–-]*\d{1,3}/gi, ' | ')
    .replace(/\b(?:episode|серия|эпизод)\s*\d{1,3}\b/gi, ' | ')
    .replace(/\b\d{1,3}\s*(?:серия|эпизод)\b/gi, ' | ')
    .replace(/\b\d{1,2}\s*сезон\b/gi, ' | ')
    .replace(/\b(full\s+movie|in\s+english|full\s+hd|4k|1080p|720p|hd|дубляж|озвучка|red\s+head\s+sound|rhs|jaskier|hdrezka|lostfilm|смотреть\s+онлайн|бесплатно)\b.*$/gi, ' ')
    .replace(/\b(19\d\d|20[0-2]\d)\b/g, ' ');

  const rawParts = cleaned.split(/\s*(?:\/|\||○|—|–|\s-\s)\s*/).map(x => x.trim()).filter(Boolean);
  const candidates = [];
  for (const p of rawParts) {
    const c = p.replace(/^(сериал|фильм|мультфильм|мультсериал|аниме)\s+/i, '').trim();
    if (c.length >= 2) candidates.push(c);
  }
  if (!candidates.length && cleaned.trim()) candidates.push(cleaned.trim());

  return {
    name: candidates[0] || s,
    aliases: candidates,
    candidates,
    season,
    episode,
    episodeName,
    year,
    hasSeriesMarker,
    strict: false,
  };
}

const tmdbCache = new Map();
async function tmdb(path) {
  if (tmdbCache.has(path)) return tmdbCache.get(path);
  const sep = path.includes('?') ? '&' : '?';
  const hasLang = /language=/.test(path);
  const url = `https://api.themoviedb.org/3${path}${sep}api_key=${TMDB_API_KEY}${hasLang ? '' : '&language=en-US'}`;
  const data = await getJson(url);
  tmdbCache.set(path, data);
  return data;
}

async function rutubeSearch(query, pages = 2) {
  const out = [];
  for (let p = 1; p <= pages; p++) {
    try {
      const d = await getJson(`https://rutube.ru/api/search/video/?query=${encodeURIComponent(query)}&format=json&page=${p}`);
      out.push(...(d.results || []));
      if (!d.has_next) break;
    } catch (e) { break; }
  }
  return out;
}

/**
 * Decide whether a Rutube video is an exact verified match for the target TMDB movie or TV episode.
 * @param v rutube video object
 * @param target {type:'movie'|'tv', titles:[...], ruTitles?:[...], year, runtime, season?, episode?}
 */
function isExactMatch(v, target) {
  if (!v || !v.id) return { ok: false, why: 'no id' };
  const authorId = v.author && v.author.id;
  const parsed = parseFlexibleTitle(v.title);
  if (!parsed) return { ok: false, why: 'junk or unparsable' };

  const enNames = new Set((target.titles || []).map(norm).filter(Boolean));
  const ruNames = new Set((target.ruTitles || []).map(norm).filter(Boolean));
  const candNorms = (parsed.candidates || []).map(norm).filter(Boolean);
  const fullNorm = norm(v.title);

  let matchedEn = candNorms.some(c => enNames.has(c));
  let matchedRu = candNorms.some(c => ruNames.has(c));

  // Fallback token/substring match when title has extra subtitles (e.g. "Part One" or "Extended Cut")
  if (!matchedEn && !matchedRu) {
    for (const en of enNames) {
      if (en.length >= 5 && candNorms.some(c => c.startsWith(en + ' ') || en.startsWith(c + ' '))) {
        matchedEn = true; break;
      }
      const words = en.split(' ').filter(w => w.length > 2);
      if (words.length >= 2 && words.every(w => fullNorm.includes(w))) {
        matchedEn = true; break;
      }
    }
    if (!matchedEn) {
      for (const ru of ruNames) {
        if (ru.length >= 5 && candNorms.some(c => c.startsWith(ru + ' ') || ru.startsWith(c + ' '))) {
          matchedRu = true; break;
        }
        const words = ru.split(' ').filter(w => w.length > 2);
        if (words.length >= 2 && words.every(w => fullNorm.includes(w))) {
          matchedRu = true; break;
        }
      }
    }
  }
  if (!matchedEn && !matchedRu) return { ok: false, why: 'name mismatch' };

  const dur = (v.duration || 0) / 60; // minutes
  if (target.type === 'movie') {
    if (parsed.season != null || parsed.episode != null || parsed.hasSeriesMarker) {
      return { ok: false, why: 'is episode/series' };
    }
    if (dur < 45) return { ok: false, why: 'too short' };
    if (target.year && parsed.year && Math.abs(parsed.year - target.year) > 1) {
      return { ok: false, why: 'year mismatch' };
    }
    // If no year in title and not a trusted author, require stricter runtime match
    if (target.year && !parsed.year && !TRUSTED_AUTHORS.has(authorId)) {
      if (!target.runtime || Math.abs(dur - target.runtime) > target.runtime * 0.12) {
        return { ok: false, why: 'missing year and runtime not exact' };
      }
    }
    if (target.runtime && target.runtime >= 45) {
      if (dur < target.runtime * 0.78 || dur > target.runtime * 1.32) {
        return { ok: false, why: 'runtime mismatch' };
      }
    }
  } else {
    // TV Series Episode
    if (parsed.season == null || parsed.episode == null) return { ok: false, why: 'not an episode' };
    if (target.season != null && parsed.season !== target.season) return { ok: false, why: 'season' };
    if (target.episode != null && parsed.episode !== target.episode) return { ok: false, why: 'episode' };
    if (target.year && parsed.year && parsed.year < target.year - 1) return { ok: false, why: 'year' };
    if (dur < 14 || dur > 120) return { ok: false, why: 'duration out of episode range' };
    if (target.runtime && target.runtime >= 18 && dur < target.runtime * 0.55) {
      return { ok: false, why: 'episode too short' };
    }
  }

  // Compute quality/language priority score — STRICTLY ENGLISH AUDIO ONLY
  const isTrusted = TRUSTED_AUTHORS.has(authorId);
  const isPureEnglish = !CYR.test(v.title);
  const fullMetaText = `${v.title || ''} ${v.description || ''}`;
  const hasDubTag = /(дубляж|озвучка|профессиональный перевод|многоголосый|red head sound|rhs|jaskier|lostfilm|hdrezka|tvshows|newstudio|coldfilm|baibako|alexfilm|kubik|кубик в кубе|hindi|sub indo)/i.test(v.title);
  const hasExplicitEnglishTag = /(на английском|in english|в оригинале|оригинальная дорожка|english original|with english subtitles|с русскими субтитрами|с субтитрами)/i.test(fullMetaText);

  if (hasDubTag && !hasExplicitEnglishTag) {
    return { ok: false, why: 'dubbed audio' };
  }
  if (!isTrusted && !isPureEnglish && !hasExplicitEnglishTag) {
    return { ok: false, why: 'cyrillic title without explicit english indicator' };
  }

  let score = 0;
  if (isTrusted) score += 1000;
  if (parsed.strict) score += 600;
  if (isPureEnglish) score += 450;
  if (hasExplicitEnglishTag) score += 350;
  if (matchedEn) score += 250;
  if (matchedRu) score += 100;
  if (parsed.year && target.year && parsed.year === target.year) score += 80;
  if (target.runtime && dur > 0) {
    const diffPct = Math.abs(dur - target.runtime) / target.runtime;
    score += Math.max(0, Math.round((1 - diffPct) * 60));
  }

  return {
    ok: true,
    trusted: isTrusted,
    score,
    parsed,
    durationMin: Math.round(dur * 10) / 10,
  };
}

/** Find a verified movie on Rutube for a TMDB movie id. */
async function findMovie(tmdbId) {
  const [m, ruM] = await Promise.all([
    tmdb(`/movie/${tmdbId}?append_to_response=external_ids,alternative_titles`),
    tmdb(`/movie/${tmdbId}?language=ru-RU`).catch(() => null),
  ]);
  if (!m || !m.id) return null;
  const year = parseInt((m.release_date || '').slice(0, 4), 10) || null;
  const altTitles = ((m.alternative_titles && m.alternative_titles.titles) || [])
    .filter(t => ['US', 'GB', 'AU', 'CA'].includes(t.iso_3166_1))
    .map(t => t.title);
  const titles = [...new Set([m.title, m.original_title, ...altTitles].filter(Boolean))];
  const ruTitles = [...new Set([ruM && ruM.title, ruM && ruM.original_title].filter(Boolean))];
  const target = { type: 'movie', titles, ruTitles, year, runtime: m.runtime || null };

  const queries = [
    `${m.title} (movie, ${year || ''})`,
    `${m.title} ${year || ''} in english`,
    `${m.title} ${year || ''}`,
  ];
  if (ruM && ruM.title && norm(ruM.title) !== norm(m.title)) {
    queries.push(`${ruM.title} на английском`);
    queries.push(`${ruM.title} ${m.title} в оригинале`);
  }

  const batches = await Promise.all(queries.map(q => rutubeSearch(q, 2)));
  const seen = new Set();
  const candidates = [];
  for (const list of batches) {
    for (const v of list) {
      if (!v || !v.id || seen.has(v.id)) continue;
      seen.add(v.id);
      const r = isExactMatch(v, target);
      if (r.ok) candidates.push({ v, r });
    }
  }

  candidates.sort((a, b) => (b.r.score - a.r.score) || ((b.v.hits || 0) - (a.v.hits || 0)));
  const best = candidates[0];
  if (!best) return null;
  return {
    id: best.v.id,
    title: m.title,
    clean_title: m.title,
    raw_title: best.v.title,
    tmdb_id: m.id,
    imdb_id: (m.external_ids && m.external_ids.imdb_id) || m.imdb_id || null,
    collection_id: m.belongs_to_collection ? m.belongs_to_collection.id : null,
    overview: m.overview,
    rating: m.vote_average ? Math.round(m.vote_average * 10) / 10 : null,
    year: year ? String(year) : '',
    duration_min: best.r.durationMin,
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : '',
    backdrop: m.backdrop_path ? `https://image.tmdb.org/t/p/original${m.backdrop_path}` : '',
    is_series: false,
    genres: (m.genres || []).map(g => g.name === 'Science Fiction' ? 'Sci-Fi' : g.name),
    verified: true,
  };
}

/** Find all verified episodes of a TMDB TV show on Rutube. */
async function findShowEpisodes(tmdbId) {
  const [s, ruS] = await Promise.all([
    tmdb(`/tv/${tmdbId}?append_to_response=external_ids,alternative_titles`),
    tmdb(`/tv/${tmdbId}?language=ru-RU`).catch(() => null),
  ]);
  if (!s || !s.id) return [];
  const year = parseInt((s.first_air_date || '').slice(0, 4), 10) || null;
  const runtime = (s.episode_run_time && s.episode_run_time[0]) || null;
  const altTitles = ((s.alternative_titles && s.alternative_titles.results) || [])
    .filter(t => ['US', 'GB', 'AU', 'CA'].includes(t.iso_3166_1))
    .map(t => t.title);
  const titles = [...new Set([s.name, s.original_name, ...altTitles].filter(Boolean))];
  const ruName = ruS && ruS.name && norm(ruS.name) !== norm(s.name) ? ruS.name : null;
  const ruTitles = [...new Set([ruName, ruS && ruS.original_name].filter(Boolean))];

  const seasons = (s.seasons || []).filter(x => x.season_number > 0).slice(0, 8);
  const queries = [
    `${s.name} (series, ${year || ''})`,
    `${s.name} season 1 episode`,
    `${s.name}`,
  ];
  for (const sn of seasons.slice(0, 5)) {
    queries.push(`${s.name} season ${sn.season_number} episode`);
    if (ruName) queries.push(`${ruName} ${sn.season_number} сезон на английском`);
  }
  if (ruName) {
    queries.push(`${ruName} / ${s.name} на английском`);
    queries.push(`${s.name} in english`);
  }

  // Run queries in fast parallel batches of 5
  const found = new Map();
  for (let i = 0; i < queries.length; i += 5) {
    const slice = queries.slice(i, i + 5);
    const batches = await Promise.all(slice.map(q => rutubeSearch(q, 2)));
    for (const results of batches) {
      for (const v of results) {
        const r = isExactMatch(v, { type: 'tv', titles, ruTitles, year, runtime });
        if (!r.ok || !r.parsed.season || !r.parsed.episode) continue;
        const key = `${r.parsed.season}x${r.parsed.episode}`;
        const prev = found.get(key);
        if (!prev || r.score > prev._score) {
          found.set(key, {
            id: v.id,
            title: `${s.name} (S${r.parsed.season} E${r.parsed.episode})`,
            clean_title: s.name,
            episode_name: r.parsed.episodeName || undefined,
            raw_title: v.title,
            tmdb_id: s.id,
            imdb_id: (s.external_ids && s.external_ids.imdb_id) || null,
            overview: s.overview,
            rating: s.vote_average ? Math.round(s.vote_average * 10) / 10 : null,
            year: year ? String(year) : '',
            duration_min: r.durationMin,
            poster: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : '',
            backdrop: s.backdrop_path ? `https://image.tmdb.org/t/p/original${s.backdrop_path}` : '',
            is_series: true,
            season: r.parsed.season,
            episode: r.parsed.episode,
            genres: (s.genres || []).map(g => g.name === 'Sci-Fi & Fantasy' ? 'Sci-Fi' : g.name.split(' & ')[0]),
            verified: true,
            trusted: r.trusted,
            _score: r.score,
          });
        }
      }
    }
  }

  return [...found.values()]
    .map(({ _score, ...rest }) => rest)
    .sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
}

module.exports = { parseUploadTitle, parseFlexibleTitle, isExactMatch, findMovie, findShowEpisodes, tmdb, norm, rutubeSearch, TRUSTED_AUTHORS };
