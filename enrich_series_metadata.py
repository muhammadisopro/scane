import json
import urllib.request
import urllib.parse
import re
import os
from concurrent.futures import ThreadPoolExecutor

TMDB_API_KEY = "e6d52d32ce458e7125d6f0dfdc0e9307"
MOVIES_FILE = r"C:\Users\Muham\.gemini\antigravity\scratch\kino-stream\movies.json"
CACHE_FILE = r"C:\Users\Muham\.gemini\antigravity\scratch\kino-stream\series_enriched.json"

with open(MOVIES_FILE, "r", encoding="utf-8") as f:
    movies_data = json.load(f)

# Top TV shows
series_items = [m for m in movies_data if m.get('is_series')]
shows_map = {}

for m in series_items:
    raw_t = m.get('raw_title', '') or m.get('title', '')
    t = m.get('clean_title') or m['title']
    base = re.sub(r'\(.*?\)|season.*|mavsum.*|s\d+.*|episode.*|qism.*', '', t, flags=re.I).strip()
    if not base:
        base = m['title']

    s_m = re.search(r'season\s*(\d+)|mavsum\s*(\d+)|s(\d+)', raw_t, re.I)
    e_m = re.search(r'episode\s*(\d+)|qism\s*(\d+)|e(\d+)', raw_t, re.I)
    s_num = int(s_m.group(1) or s_m.group(2) or s_m.group(3)) if s_m else 1
    e_num = int(e_m.group(1) or e_m.group(2) or e_m.group(3)) if e_m else 1

    m['season'] = s_num
    m['episode'] = e_num

    k = base.lower()
    if k not in shows_map:
        shows_map[k] = {
            'id': 'show_' + re.sub(r'[^a-z0-9]', '_', k),
            'title': base,
            'clean_title': base,
            'tmdb_id': m.get('tmdb_id'),
            'imdb_id': m.get('imdb_id'),
            'overview': m.get('overview', ''),
            'poster': m.get('poster', ''),
            'backdrop': m.get('backdrop', ''),
            'rating': m.get('rating', 8.5),
            'year': m.get('year', '2023'),
            'episodes': []
        }
    shows_map[k]['episodes'].append(m)

print(f"Jami seriallar soni: {len(shows_map)}")

# Load existing cache if any
cache = {}
if os.path.exists(CACHE_FILE):
    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            cache = json.load(f)
    except:
        pass

def fetch_season(tmdb_id, season_num):
    cache_key = f"{tmdb_id}_s{season_num}"
    if cache_key in cache:
        return cache_key, cache[cache_key]
    url = f"https://api.themoviedb.org/3/tv/{tmdb_id}/season/{season_num}?api_key={TMDB_API_KEY}"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as res:
            data = json.loads(res.read().decode('utf-8'))
            return cache_key, {
                'name': data.get('name', f'{season_num}-Mavsum'),
                'overview': data.get('overview', ''),
                'poster_path': data.get('poster_path', ''),
                'vote_average': round(data.get('vote_average', 8.5), 1),
                'episodes': {
                    e['episode_number']: {
                        'name': e.get('name', f'{season_num}-qism'),
                        'overview': e.get('overview', "Ushbu qismning rasmiy tavsifi."),
                        'rating': round(e.get('vote_average', 8.5), 1),
                        'still': f"https://image.tmdb.org/t/p/w500{e.get('still_path')}" if e.get('still_path') else "",
                        'runtime': e.get('runtime', 50)
                    }
                    for e in data.get('episodes', [])
                }
            }
    except Exception as e:
        return cache_key, None

tasks = []
for k, show in shows_map.items():
    tid = show.get('tmdb_id')
    if tid:
        seasons = set(e['season'] for e in show['episodes'])
        for s in seasons:
            if f"{tid}_s{s}" not in cache:
                tasks.append((tid, s))

print(f"TMDB dan yuklanishi kerak bo'lgan fasllar soni: {len(tasks)}")

with ThreadPoolExecutor(max_workers=10) as ex:
    results = ex.map(lambda p: fetch_season(p[0], p[1]), tasks)
    for c_key, c_data in results:
        if c_data:
            cache[c_key] = c_data

with open(CACHE_FILE, "w", encoding="utf-8") as f:
    json.dump(cache, f, ensure_ascii=False, indent=2)

print(f"Fasllar keshlandi! Jami kesh: {len(cache)} ta mavsum.")
