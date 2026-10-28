import json
import urllib.request
import urllib.parse
import re
import sys
from concurrent.futures import ThreadPoolExecutor

TMDB_API_KEY = "e6d52d32ce458e7125d6f0dfdc0e9307"
MOVIES_FILE = r"C:\Users\Muham\.gemini\antigravity\scratch\kino-stream\movies.json"

with open(MOVIES_FILE, "r", encoding="utf-8") as f:
    existing_movies = json.load(f)

print(f"Boshlang'ich baza hajmi: {len(existing_movies)} ta element.")
existing_ids = set(m['id'] for m in existing_movies)
existing_titles = set(m['clean_title'].lower() for m in existing_movies)

QUERIES = [
    # Top Pixar & Disney Animations
    "Toy Story 1 full movie english", "Toy Story 2 full movie english", "Toy Story 3 full movie english", "Toy Story 4 full movie english",
    "Finding Nemo full movie english", "Finding Dory full movie english", "Monsters Inc full movie english", "Monsters University full movie english",
    "The Incredibles full movie english", "Incredibles 2 full movie english", "Cars full movie english", "Cars 2 full movie english", "Cars 3 full movie english",
    "Ratatouille full movie english", "Wall-E full movie english", "Up full movie english", "Inside Out full movie english",
    "Coco full movie english", "Zootopia full movie english", "Moana full movie english", "Frozen full movie english", "Frozen 2 full movie english",
    "Tangled full movie english", "Wreck It Ralph full movie english", "Ralph Breaks the Internet english",
    "Kung Fu Panda full movie english", "Kung Fu Panda 2 full movie english", "Kung Fu Panda 3 full movie english",
    "How to Train Your Dragon full movie english", "How to Train Your Dragon 2 english", "How to Train Your Dragon The Hidden World english",
    "Madagascar full movie english", "Madagascar Escape 2 Africa english", "Madagascar 3 Europes Most Wanted english",
    "Megamind full movie english", "Despicable Me full movie english", "Despicable Me 2 full movie english", "Despicable Me 3 full movie english",
    "Minions full movie english", "Ice Age full movie english", "Ice Age The Meltdown english", "Ice Age Dawn of the Dinosaurs english",
    "Ice Age Continental Drift english", "Shrek 2 full movie english", "Shrek the Third english", "Shrek Forever After english",
    "Puss in Boots The Last Wish english", "The Bad Guys full movie english", "Spider-Man Into the Spider-Verse english",
    "Spider-Man Across the Spider-Verse english",

    # Marvel Cinematic Universe & DC
    "Iron Man 2008 full movie english", "Iron Man 2 2010 full movie english", "Iron Man 3 2013 full movie english",
    "The Incredible Hulk 2008 english", "Thor 2011 full movie english", "Thor The Dark World english", "Thor Ragnarok english",
    "Thor Love and Thunder english", "Captain America The First Avenger english", "Captain America The Winter Soldier english",
    "Captain America Civil War english", "The Avengers 2012 full movie english", "Avengers Age of Ultron english",
    "Avengers Infinity War english", "Avengers Endgame english", "Guardians of the Galaxy 2014 english",
    "Guardians of the Galaxy Vol 2 english", "Guardians of the Galaxy Vol 3 english", "Ant-Man 2015 english",
    "Ant-Man and the Wasp english", "Doctor Strange 2016 english", "Doctor Strange in the Multiverse of Madness english",
    "Black Panther 2018 english", "Black Panther Wakanda Forever english", "Captain Marvel 2019 english",
    "Shang-Chi and the Legend of the Ten Rings english", "Venom 2018 full movie english", "Venom Let There Be Carnage english",
    "Man of Steel 2013 full movie english", "Batman Begins full movie english", "The Dark Knight 2008 full movie english",
    "The Dark Knight Rises 2012 english", "Zack Snyders Justice League english", "Joker 2019 full movie english",

    # Top Blockbusters & Classics
    "The Lord of the Rings The Fellowship of the Ring english", "The Lord of the Rings The Two Towers english",
    "The Lord of the Rings The Return of the King english", "The Hobbit An Unexpected Journey english",
    "The Hobbit The Desolation of Smaug english", "The Hobbit The Battle of the Five Armies english",
    "Star Wars A New Hope english", "Star Wars The Empire Strikes Back english", "Star Wars Return of the Jedi english",
    "Star Wars The Force Awakens english", "Star Wars The Last Jedi english", "Star Wars The Rise of Skywalker english",
    "Jurassic Park 1993 full movie english", "The Lost World Jurassic Park english", "Jurassic World 2015 full movie english",
    "Jurassic World Fallen Kingdom english", "Jurassic World Dominion english", "Avatar 2009 full movie english",
    "Avatar The Way of Water 2022 english", "Titanic 1997 full movie english", "Gladiator 2000 full movie english",
    "Braveheart 1995 full movie english", "Troy 2004 full movie english", "Kingdom of Heaven english",
    "The Matrix 1999 full movie english", "The Matrix Reloaded english", "The Matrix Revolutions english",
    "Inception 2010 full movie english", "Interstellar 2014 full movie english", "Oppenheimer 2023 full movie english",
    "Dune 2021 full movie english", "Dune Part Two 2024 english", "Tenet 2020 full movie english",
    "The Prestige 2006 full movie english", "Memento 2000 full movie english", "Fight Club 1999 full movie english",
    "Se7en 1995 full movie english", "Zodiac 2007 full movie english", "Gone Girl 2014 full movie english",
    "Shutter Island 2010 full movie english", "The Wolf of Wall Street 2013 english", "Catch Me If You Can 2002 english",
    "The Departed 2006 full movie english", "Goodfellas 1990 full movie english", "Casino 1995 full movie english",
    "Scarface 1983 full movie english", "The Godfather 1972 full movie english", "The Godfather Part II english",
    "Pulp Fiction 1994 full movie english", "Kill Bill Vol 1 english", "Kill Bill Vol 2 english",
    "Inglourious Basterds 2009 english", "Django Unchained 2012 english", "The Hateful Eight 2015 english",
    "Once Upon a Time in Hollywood english", "No Country for Old Men 2007 english", "There Will Be Blood 2007 english",
    "The Shawshank Redemption 1994 english", "The Green Mile 1999 full movie english", "Forrest Gump 1994 full movie english",
    "Cast Away 2000 full movie english", "Saving Private Ryan 1998 english", "Hacksaw Ridge 2016 english",
    "1917 2019 full movie english", "Mad Max Fury Road 2015 english", "Furiosa A Mad Max Saga english",
    "John Wick 2014 full movie english", "John Wick Chapter 2 english", "John Wick Chapter 3 english", "John Wick Chapter 4 english",
    "The Equalizer 2014 english", "The Equalizer 2 english", "The Equalizer 3 english",
    "Nobody 2021 full movie english", "Extraction 2020 full movie english", "Extraction 2 2023 english",
    "The Beekeeper 2024 full movie english", "Top Gun Maverick 2022 english", "Mission Impossible Dead Reckoning english"
]

def fetch_rutube(q):
    url = f"https://rutube.ru/api/search/video/?query={urllib.parse.quote(q)}&format=json"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    found = []
    try:
        with urllib.request.urlopen(req, timeout=6) as res:
            data = json.loads(res.read().decode('utf-8'))
            for r in data.get('results', []):
                t = r.get('title', '')
                dur = r.get('duration', 0)
                # Faqat ruscha harf/so'z bo'lmagan, 25 daqiqadan uzun videolar
                if dur > 1500 and not re.search(r'[\u0400-\u04FF]', t) and not re.search(r'дубляж|русск|озвучк|dubbed|rus', t, re.I):
                    found.append({
                        'id': r['id'],
                        'title': t,
                        'duration': dur,
                        'duration_min': round(dur / 60, 1),
                        'thumbnail': r.get('thumbnail_url', '')
                    })
    except Exception:
        pass
    return found

new_cands = []
with ThreadPoolExecutor(max_workers=14) as ex:
    for sub in ex.map(fetch_rutube, QUERIES):
        for item in sub:
            if item['id'] not in existing_ids:
                existing_ids.add(item['id'])
                new_cands.append(item)

print(f"Topilgan yangi nomzodlar soni: {len(new_cands)} ta. TMDB bilan tekshirilmoqda...")

def clean_title_str(raw):
    c = raw
    c = re.sub(r'\|.*', '', c)
    c = re.sub(r'//.*', '', c)
    c = re.sub(r'#\S+', '', c)
    c = re.sub(r'\b(full movie|full hd|in english|english|cartoons?|movies?|game|animation|1080p|720p|4k|disney|bluray|web-dl|x264|eng sub|subtitles?)\b', '', c, flags=re.I)
    c = re.sub(r'[\(\[\{].*?[\)\]\}]', '', c)
    c = re.sub(r'[:\/\«\»\"“]', ' ', c)
    c = re.sub(r'\s+', ' ', c).strip()
    return c

def enrich_cand(cand):
    raw_title = cand['title']
    cleaned = clean_title_str(raw_title)
    if not cleaned or len(cleaned) < 2:
        return None

    year_match = re.search(r'\b(19\d\d|20\d\d)\b', raw_title)
    year = year_match.group(1) if year_match else ""
    is_series = bool(re.search(r'season|episode|s\d+e\d+', raw_title, re.I))
    search_type = "tv" if is_series else "movie"

    # 1-urinish: tozalangan nom bo'yicha
    q_url = f"https://api.themoviedb.org/3/search/{search_type}?api_key={TMDB_API_KEY}&query={urllib.parse.quote(cleaned)}"
    if year and not is_series:
        q_url += f"&year={year}"

    top = None
    try:
        req = urllib.request.Request(q_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as res:
            t_data = json.loads(res.read().decode('utf-8'))
            results = t_data.get('results', [])
            if results:
                top = results[0]
    except Exception:
        pass

    # 2-urinish: multi search
    if not top:
        try:
            m_url = f"https://api.themoviedb.org/3/search/multi?api_key={TMDB_API_KEY}&query={urllib.parse.quote(cleaned)}"
            req = urllib.request.Request(m_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=5) as res:
                t_data = json.loads(res.read().decode('utf-8'))
                results = [r for r in t_data.get('results', []) if r.get('media_type') in ('movie', 'tv')]
                if results:
                    top = results[0]
        except Exception:
            pass

    if not top or not top.get('poster_path'):
        return None

    tmdb_id = top.get('id')
    imdb_id = ""
    try:
        actual_type = top.get('media_type') or search_type
        ext_url = f"https://api.themoviedb.org/3/{actual_type}/{tmdb_id}/external_ids?api_key={TMDB_API_KEY}"
        with urllib.request.urlopen(urllib.request.Request(ext_url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=4) as ext_res:
            ext_data = json.loads(ext_res.read().decode('utf-8'))
            imdb_id = ext_data.get('imdb_id', '')
    except Exception:
        pass

    disp_title = top.get('title') or top.get('name') or cleaned
    poster_path = top.get('poster_path')
    backdrop_path = top.get('backdrop_path')

    return {
        'id': cand['id'],
        'title': disp_title,
        'clean_title': disp_title,
        'raw_title': raw_title,
        'tmdb_id': tmdb_id,
        'imdb_id': imdb_id,
        'overview': top.get('overview') or "Original ingliz tilidagi yuqori sifatli kino.",
        'rating': round(top.get('vote_average', 8.1), 1),
        'year': (top.get('release_date') or top.get('first_air_date') or year or '2023')[:4],
        'duration_min': cand['duration_min'],
        'poster': f"https://image.tmdb.org/t/p/w500{poster_path}",
        'backdrop': f"https://image.tmdb.org/t/p/original{backdrop_path}" if backdrop_path else f"https://image.tmdb.org/t/p/w500{poster_path}",
        'is_series': is_series or top.get('media_type') == 'tv',
        'season': '',
        'episode': ''
    }

newly_verified = []
with ThreadPoolExecutor(max_workers=14) as ex:
    for res in ex.map(enrich_cand, new_cands):
        if res:
            t_key = res['clean_title'].lower()
            if t_key not in existing_titles:
                existing_titles.add(t_key)
                newly_verified.append(res)

print(f"Yangi moslangan filmlar soni: {len(newly_verified)} ta!")
final_db = existing_movies + newly_verified
print(f"Baza jami: {len(final_db)} ta 100% inglizcha kino va serial!")

with open(MOVIES_FILE, "w", encoding="utf-8") as f:
    json.dump(final_db, f, ensure_ascii=False, indent=2)

print("movies.json muvaffaqiyatli saqlandi!")
