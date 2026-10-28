// Cleans the library: keeps only videos verified to be the exact title in English original.
// - strict upload format required ("Title (movie, YEAR)" / "Show season N episode M (series, YEAR)")
// - metadata re-mapped through TMDB when the stored title doesn't match the actual upload
// - everything else is quarantined into removed_items.json
const fs = require('fs');
const v = require('./verify.js');

(async () => {
  const db = JSON.parse(fs.readFileSync('movies.json', 'utf8'));
  fs.writeFileSync('movies.backup.json', JSON.stringify(db));
  const keep = [], removed = [], fixed = [];
  const tmdbSearchCache = new Map();

  for (const m of db) {
    const p = v.parseUploadTitle(m.raw_title || '');
    if (!p) { removed.push({ ...m, _why: 'format' }); continue; }
    const names = String(p.name).split(/\s+\/\s+/).map(v.norm);
    const stored = [m.clean_title, m.title].map(x => v.norm(String(x || '').replace(/\(.*?\)/g, '')));

    if (m.is_series) {
      if (!p.season) { removed.push({ ...m, _why: 'series w/o S/E' }); continue; }
      keep.push(m); continue;
    }
    const dur = m.duration_min || 0;
    if (dur < 40) { removed.push({ ...m, _why: 'short' }); continue; }

    if (names.some(n => stored.includes(n))) { keep.push(m); continue; }

    // Name mismatch -> find the real title on TMDB by upload name + year
    const key = names[0] + '|' + p.year;
    let hit = tmdbSearchCache.get(key);
    if (hit === undefined) {
      try {
        const r = await v.tmdb(`/search/movie?query=${encodeURIComponent(p.name.split(' / ')[0])}&year=${p.year}`);
        hit = (r.results || []).find(x => names.includes(v.norm(x.title)) || names.includes(v.norm(x.original_title))) || null;
        if (!hit) {
          const r2 = await v.tmdb(`/search/movie?query=${encodeURIComponent(p.name.split(' / ')[0])}`);
          hit = (r2.results || []).find(x => (names.includes(v.norm(x.title)) || names.includes(v.norm(x.original_title)))
            && Math.abs(parseInt((x.release_date || '0').slice(0, 4)) - p.year) <= 1) || null;
        }
      } catch (e) { hit = null; }
      tmdbSearchCache.set(key, hit);
    }
    if (!hit) { removed.push({ ...m, _why: 'no tmdb match for ' + p.name }); continue; }
    let det = {};
    try { det = await v.tmdb(`/movie/${hit.id}?append_to_response=external_ids`); } catch (e) {}
    if (det.runtime && (dur < det.runtime * 0.8 || dur > det.runtime * 1.35)) { removed.push({ ...m, _why: 'runtime' }); continue; }
    const nm = {
      ...m,
      title: det.title || hit.title, clean_title: det.title || hit.title,
      tmdb_id: hit.id, imdb_id: (det.external_ids && det.external_ids.imdb_id) || null,
      overview: det.overview || hit.overview || '',
      rating: hit.vote_average ? Math.round(hit.vote_average * 10) / 10 : m.rating,
      year: (hit.release_date || '').slice(0, 4),
      poster: hit.poster_path ? 'https://image.tmdb.org/t/p/w500' + hit.poster_path : m.poster,
      backdrop: hit.backdrop_path ? 'https://image.tmdb.org/t/p/original' + hit.backdrop_path : m.backdrop,
      genres: (det.genres || []).map(g => g.name === 'Science Fiction' ? 'Sci-Fi' : g.name),
    };
    fixed.push(`${m.title}  ->  ${nm.title} (${nm.year})`);
    keep.push(nm);
  }

  // Dedupe movies by tmdb_id (keep longest = full cut)
  const byT = new Map(); const out = [];
  for (const m of keep) {
    if (m.is_series || !m.tmdb_id) { out.push(m); continue; }
    const prev = byT.get(m.tmdb_id);
    if (!prev) { byT.set(m.tmdb_id, m); out.push(m); }
    else if ((m.duration_min || 0) > (prev.duration_min || 0)) { out[out.indexOf(prev)] = m; byT.set(m.tmdb_id, m); }
  }

  fs.writeFileSync('movies.json', JSON.stringify(out, null, 1));
  fs.writeFileSync('removed_items.json', JSON.stringify(removed, null, 1));
  console.log('kept', out.length, 'removed', removed.length, 'fixed', fixed.length);
  console.log(fixed.slice(0, 30).join('\n'));
})();
