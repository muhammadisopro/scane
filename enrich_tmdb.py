import json
import urllib.request
import urllib.parse
import re
from concurrent.futures import ThreadPoolExecutor

API_KEY = "e6d52d32ce458e7125d6f0dfdc0e9307"

with open(r"C:\Users\Muham\.gemini\antigravity\scratch\kino-stream\movies.json", "r", encoding="utf-8") as f:
    items = json.load(f)

print(f"Jami {len(items)} ta element tahlil qilinmoqda...")

def clean_movie_title(raw_title):
    year_match = re.search(r'\b(19\d\d|20\d\d)\b', raw_title)
    year = year_match.group(1) if year_match else ""

    season_match = re.search(r'season\s*(\d+)', raw_title, re.IGNORECASE)
    episode_match = re.search(r'episode\s*(\d+)', raw_title, re.IGNORECASE)
    
    season_num = season_match.group(1) if season_match else ""
    episode_num = episode_match.group(1) if episode_match else ""

    t = raw_title
    t = re.sub(r'\(movie,?\s*\d*\)', '', t, flags=re.I)
    t = re.sub(r'\(series,?\s*\d*\)/?', '', t, flags=re.I)
    t = re.sub(r'\(animated film,?\s*\d*\)', '', t, flags=re.I)
    t = re.sub(r'\(film,?\s*\d*\)', '', t, flags=re.I)
    t = re.sub(r'season\s*\d+', '', t, flags=re.I)
    t = re.sub(r'episode\s*\d+', '', t, flags=re.I)
    t = re.sub(r'[«»"“”]', '', t)
    t = t.split('/')[0].split('|')[0].strip()
    t = re.sub(r'\(\s*\d*\s*\)', '', t).strip()

    return t, year, season_num, episode_num

# Barcha noyob sarlavhalarni to'plab olamiz
unique_queries = {}
for item in items:
    clean_t, year, s_num, ep_num = clean_movie_title(item['title'])
    is_series = bool(s_num or ep_num or 'season' in item['title'].lower() or 'episode' in item['title'].lower())
    key = (clean_t.lower(), year, is_series)
    if key not in unique_queries:
        unique_queries[key] = (clean_t, year, is_series)

print(f"Noyob TMDB so'rovlar soni: {len(unique_queries)} ta. Ko'p oqimli yuklanmoqda...")

tmdb_cache = {}

def fetch_single_tmdb(args):
    clean_t, year, is_series = args
    cache_key = (clean_t.lower(), year, is_series)
    search_type = "tv" if is_series else "movie"

    query_url = f"https://api.themoviedb.org/3/search/{search_type}?api_key={API_KEY}&query={urllib.parse.quote(clean_t)}"
    if year and not is_series:
        query_url += f"&year={year}"

    try:
        req = urllib.request.Request(query_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as res:
            res_data = json.loads(res.read().decode('utf-8'))
            results = res_data.get('results', [])
            if results:
                top = results[0]
                tmdb_id = top.get('id')
                imdb_id = ""

                # IMDb ID olish (subtitrlar uchun juda muhim)
                try:
                    ext_url = f"https://api.themoviedb.org/3/{search_type}/{tmdb_id}/external_ids?api_key={API_KEY}"
                    with urllib.request.urlopen(urllib.request.Request(ext_url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=4) as ext_res:
                        ext_data = json.loads(ext_res.read().decode('utf-8'))
                        imdb_id = ext_data.get('imdb_id', '')
                except:
                    pass

                return cache_key, {
                    'tmdb_id': tmdb_id,
                    'imdb_id': imdb_id,
                    'display_title': top.get('title') or top.get('name') or clean_t,
                    'overview': top.get('overview') or "Ingliz tilidagi to'liq metrajli film.",
                    'rating': round(top.get('vote_average', 8.0), 1),
                    'year': (top.get('release_date') or top.get('first_air_date') or year or '2022')[:4],
                    'poster': f"https://image.tmdb.org/t/p/w500{top.get('poster_path')}" if top.get('poster_path') else None,
                    'backdrop': f"https://image.tmdb.org/t/p/original{top.get('backdrop_path')}" if top.get('backdrop_path') else None
                }
    except Exception as e:
        pass

    return cache_key, None

# 15 ta oqimda parallel yuklaymiz
with ThreadPoolExecutor(max_workers=15) as executor:
    results = executor.map(fetch_single_tmdb, unique_queries.values())
    for cache_key, data in results:
        if data:
            tmdb_cache[cache_key] = data

print(f"TMDB dan {len(tmdb_cache)} ta film to'liq aniqlandi!")

# Hamma 704 ta elementni birlashtiramiz
enriched = []
for item in items:
    raw_title = item.get('title', '')
    rutube_id = item.get('id', '')
    duration_min = item.get('duration_min', 0)

    clean_t, year, s_num, ep_num = clean_movie_title(raw_title)
    is_series = bool(s_num or ep_num or 'season' in raw_title.lower() or 'episode' in raw_title.lower())
    cache_key = (clean_t.lower(), year, is_series)

    tmdb_info = tmdb_cache.get(cache_key)
    if not tmdb_info:
        tmdb_info = {
            'tmdb_id': None,
            'imdb_id': '',
            'display_title': clean_t,
            'overview': "To'liq metrajli film, original inglizcha audioda.",
            'rating': 8.0,
            'year': year or '2023',
            'poster': item.get('thumbnail'),
            'backdrop': item.get('thumbnail')
        }

    full_display = tmdb_info['display_title']
    if is_series and (s_num or ep_num):
        full_display += f" (Mavsum {s_num or '1'}, Qism {ep_num or '1'})"

    enriched.append({
        'id': rutube_id,
        'title': full_display,
        'clean_title': tmdb_info['display_title'],
        'raw_title': raw_title,
        'tmdb_id': tmdb_info.get('tmdb_id'),
        'imdb_id': tmdb_info.get('imdb_id', ''),
        'overview': tmdb_info.get('overview', ''),
        'rating': tmdb_info.get('rating', 8.0),
        'year': tmdb_info.get('year', year or '2022'),
        'duration_min': duration_min,
        'poster': tmdb_info.get('poster') or item.get('thumbnail'),
        'backdrop': tmdb_info.get('backdrop') or item.get('thumbnail'),
        'is_series': is_series,
        'season': s_num,
        'episode': ep_num
    })

output_path = r"C:\Users\Muham\.gemini\antigravity\scratch\kino-stream\movies_enriched.json"
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(enriched, f, ensure_ascii=False, indent=2)

print(f"Jami {len(enriched)} ta kino muvaffaqiyatli saqlandi!")
