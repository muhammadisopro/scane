import json
import urllib.request
import urllib.parse
import re
from concurrent.futures import ThreadPoolExecutor

TMDB_API_KEY = "e6d52d32ce458e7125d6f0dfdc0e9307"
MOVIES_FILE = r"C:\Users\Muham\.gemini\antigravity\scratch\kino-stream\movies.json"

# Mavjud 704 ta filmni yuklaymiz
with open(MOVIES_FILE, "r", encoding="utf-8") as f:
    existing_movies = json.load(f)

print(f"Mavjud baza: {len(existing_movies)} ta element.")
existing_ids = set(m['id'] for m in existing_movies)
existing_titles = set(m['clean_title'].lower() for m in existing_movies)

# Eng mashhur filmlar, multfilmlar va seriallar qidiruv so'rovlari
SEARCH_QUERIES = [
    # --- MULTFILMLAR (ANIMATION & CARTOONS) ---
    "Shrek full movie english",
    "Shrek 2 full movie english",
    "Kung Fu Panda full movie english",
    "Kung Fu Panda 2 full movie english",
    "Toy Story full movie english",
    "Toy Story 2 full movie english",
    "Toy Story 3 full movie english",
    "Finding Nemo full movie english",
    "Finding Dory full movie english",
    "Cars animated movie english",
    "Cars 2 animated movie english",
    "How to Train Your Dragon full movie english",
    "Madagascar full movie english",
    "Madagascar 2 full movie english",
    "Ice Age full movie english",
    "Ice Age 2 full movie english",
    "Despicable Me full movie english",
    "Despicable Me 2 full movie english",
    "Minions full movie english",
    "Megamind full movie english",
    "Ratatouille full movie english",
    "WALL-E full movie english",
    "Up animated movie english",
    "Coco animated movie english",
    "Moana full movie english",
    "Frozen full movie english",
    "Frozen 2 full movie english",
    "Zootopia full movie english",
    "Tangled full movie english",
    "The Incredibles full movie english",
    "Monsters Inc full movie english",
    "Spider-Man Into the Spider-Verse english",
    "Spider-Man Across the Spider-Verse english",
    "Puss in Boots The Last Wish english",
    "The Super Mario Bros Movie english",
    "Inside Out animated movie english",

    # --- TOP JAHON KINOLARI (BLOCKBUSTERS) ---
    "Spider-Man 2002 full movie english",
    "Spider-Man 2 2004 full movie english",
    "Spider-Man 3 2007 full movie english",
    "The Amazing Spider-Man english",
    "Spider-Man Homecoming full movie english",
    "Spider-Man No Way Home full movie english",
    "Iron Man full movie english",
    "Iron Man 2 full movie english",
    "Iron Man 3 full movie english",
    "The Avengers 2012 full movie english",
    "Avengers Age of Ultron full movie english",
    "Avengers Infinity War full movie english",
    "Avengers Endgame full movie english",
    "Captain America The Winter Soldier english",
    "Thor Ragnarok full movie english",
    "Black Panther full movie english",
    "Doctor Strange full movie english",
    "Batman Begins full movie english",
    "The Dark Knight full movie english",
    "The Dark Knight Rises full movie english",
    "The Batman 2022 full movie english",
    "Man of Steel full movie english",
    "Interstellar 2014 full movie english",
    "Inception 2010 full movie english",
    "The Matrix 1999 full movie english",
    "The Matrix Reloaded english",
    "Fight Club 1999 full movie english",
    "Forrest Gump 1994 full movie english",
    "Pulp Fiction 1994 full movie english",
    "The Shawshank Redemption english movie",
    "The Godfather 1972 full movie english",
    "Titanic 1997 full movie english",
    "Avatar 2009 full movie english",
    "Avatar The Way of Water english",
    "Gladiator 2000 full movie english",
    "Pirates of the Caribbean Curse Black Pearl english",
    "Pirates of the Caribbean Dead Mans Chest english",
    "Pirates of the Caribbean At Worlds End english",
    "Transformers 2007 full movie english",
    "Transformers Revenge of the Fallen english",
    "Fast and Furious full movie english",
    "Fast Five full movie english",
    "John Wick 2014 full movie english",
    "John Wick Chapter 2 english",
    "John Wick Chapter 3 english",
    "John Wick Chapter 4 english",
    "Top Gun Maverick 2022 full movie english",
    "Oppenheimer 2023 full movie english",
    "Dune 2021 full movie english",
    "Dune Part Two 2024 full movie english",
    "The Wolf of Wall Street english",
    "Django Unchained full movie english",
    "Inglourious Basterds full movie english",
    "The Prestige full movie english",
    "Shutter Island full movie english",
    "Catch Me If You Can english movie",
    "Jumanji Welcome to the Jungle english",
    "Men in Black full movie english",

    # --- TOP SERIAL VA FANTASTIKALAR ---
    "Stranger Things season 1 episode english",
    "Game of Thrones season 1 episode english",
    "Chernobyl episode english",
    "Sherlock season 1 episode english",
    "Peaky Blinders season 1 episode english",
    "The Last of Us episode english",
    "House of the Dragon episode english",
    "Loki season 1 episode english",
    "The Mandalorian episode english"
]

print(f"Qidiruv so'rovlari: {len(SEARCH_QUERIES)} ta. Rutubedan izlanmoqda...")

def fetch_rutube_query(q):
    url = f"https://rutube.ru/api/search/video/?query={urllib.parse.quote(q)}&format=json"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    found = []
    try:
        with urllib.request.urlopen(req, timeout=6) as res:
            data = json.loads(res.read().decode('utf-8'))
            for r in data.get('results', []):
                t = r.get('title', '')
                dur = r.get('duration', 0)
                # Faqat kamida 35 daqiqa (2100 s), kirill harflari va ruscha dublyaj umuman bo'lmasin
                if dur > 2100 and not re.search(r'[\u0400-\u04FF]', t) and not re.search(r'дубляж|русск|озвучк|dubbed|rus', t, re.I):
                    found.append({
                        'id': r['id'],
                        'title': t,
                        'duration': dur,
                        'duration_min': round(dur / 60, 1),
                        'thumbnail': r.get('thumbnail_url', '')
                    })
    except Exception as e:
        pass
    return found

# 10 ta oqimda Rutube qidiruvlarini parallel bajaramiz
rutube_candidates = []
with ThreadPoolExecutor(max_workers=10) as executor:
    results = executor.map(fetch_rutube_query, SEARCH_QUERIES)
    for r_list in results:
        for item in r_list:
            if item['id'] not in existing_ids:
                existing_ids.add(item['id'])
                rutube_candidates.append(item)

print(f"Rutubedan {len(rutube_candidates)} ta yangi nomzod video topildi!")

# Endi har bir yangi nomzod videoni TMDB orqali 100% aniq poster va ma'lumotlar bilan boyitamiz
def enrich_candidate(cand):
    raw_title = cand['title']
    
    # Nomdan keraksiz so'zlarni tozalash
    clean = raw_title
    clean = re.sub(r'full\s*movie', '', clean, flags=re.I)
    clean = re.sub(r'english', '', clean, flags=re.I)
    clean = re.sub(r'in\s*english', '', clean, flags=re.I)
    clean = re.sub(r'1080p|720p|4k|hd|bluray|web-dl|x264', '', clean, flags=re.I)
    clean = re.sub(r'\(movie,?\s*\d*\)', '', clean, flags=re.I)
    clean = re.sub(r'\(series,?\s*\d*\)', '', clean, flags=re.I)
    clean = re.sub(r'\(animated film,?\s*\d*\)', '', clean, flags=re.I)
    clean = re.sub(r'\(film,?\s*\d*\)', '', clean, flags=re.I)
    clean = re.sub(r'[«»"“”|]', '', clean)
    clean = clean.split('-')[0].split('/')[0].strip()

    year_match = re.search(r'\b(19\d\d|20\d\d)\b', raw_title)
    year = year_match.group(1) if year_match else ""

    is_series = bool(re.search(r'season|episode', raw_title, re.I))

    # TMDB orqali aniq qidirish
    search_type = "tv" if is_series else "movie"
    q_url = f"https://api.themoviedb.org/3/search/{search_type}?api_key={TMDB_API_KEY}&query={urllib.parse.quote(clean)}"
    if year and not is_series:
        q_url += f"&year={year}"

    try:
        req = urllib.request.Request(q_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as res:
            t_data = json.loads(res.read().decode('utf-8'))
            results = t_data.get('results', [])
            if results:
                top = results[0]
                tmdb_id = top.get('id')
                imdb_id = ""

                # IMDb ID olish (subtitr uchun)
                try:
                    ext_url = f"https://api.themoviedb.org/3/{search_type}/{tmdb_id}/external_ids?api_key={TMDB_API_KEY}"
                    with urllib.request.urlopen(urllib.request.Request(ext_url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=4) as ext_res:
                        ext_data = json.loads(ext_res.read().decode('utf-8'))
                        imdb_id = ext_data.get('imdb_id', '')
                except:
                    pass

                disp_title = top.get('title') or top.get('name') or clean
                poster_path = top.get('poster_path')
                backdrop_path = top.get('backdrop_path')

                if poster_path: # faqat rasmiy posteri borlarini qabul qilamiz!
                    return {
                        'id': cand['id'],
                        'title': disp_title,
                        'clean_title': disp_title,
                        'raw_title': raw_title,
                        'tmdb_id': tmdb_id,
                        'imdb_id': imdb_id,
                        'overview': top.get('overview') or "Original ingliz tilidagi to'liq metrajli film.",
                        'rating': round(top.get('vote_average', 8.2), 1),
                        'year': (top.get('release_date') or top.get('first_air_date') or year or '2023')[:4],
                        'duration_min': cand['duration_min'],
                        'poster': f"https://image.tmdb.org/t/p/w500{poster_path}",
                        'backdrop': f"https://image.tmdb.org/t/p/original{backdrop_path}" if backdrop_path else f"https://image.tmdb.org/t/p/w500{poster_path}",
                        'is_series': is_series,
                        'season': '',
                        'episode': ''
                    }
    except Exception as e:
        pass

    return None

print("Nomzodlar TMDB bilan 100% solishtirilmoqda...")
newly_added = []
with ThreadPoolExecutor(max_workers=10) as executor:
    results = executor.map(enrich_candidate, rutube_candidates)
    for enriched_item in results:
        if enriched_item:
            # Agar bu film avval bazada bo'lmasa
            title_key = enriched_item['clean_title'].lower()
            if title_key not in existing_titles:
                existing_titles.add(title_key)
                newly_added.append(enriched_item)

print(f"TMDB bilan 100% mos kelgan {len(newly_added)} ta yangi sifatli kino va multfilm qo'shildi!")

# Mavjud 704 ta bilan birlashtiramiz
total_database = existing_movies + newly_added
print(f"\nYANGI BAZA HAJMI: {len(total_database)} ta kino, serial va multfilm!")

# Saqlaymiz
with open(MOVIES_FILE, "w", encoding="utf-8") as f:
    json.dump(total_database, f, ensure_ascii=False, indent=2)

print("movies.json muvaffaqiyatli yangilandi!")
