import json
import urllib.request
import urllib.parse
import re
from concurrent.futures import ThreadPoolExecutor

TMDB_API_KEY = "e6d52d32ce458e7125d6f0dfdc0e9307"
MOVIES_FILE = r"C:\Users\Muham\.gemini\antigravity\scratch\kino-stream\movies.json"

with open(MOVIES_FILE, "r", encoding="utf-8") as f:
    existing_movies = json.load(f)

print(f"Hozirgi baza: {len(existing_movies)} ta element.")
existing_ids = set(m['id'] for m in existing_movies)
existing_titles = set(m['clean_title'].lower() for m in existing_movies)

QUERIES = [
    # Disney & Pixar
    "Cinderella full movie english", "Tarzan full movie english", "Mulan full movie english",
    "Hercules full movie english", "Pocahontas full movie english", "Peter Pan full movie english",
    "Lilo and Stitch english", "Treasure Planet english", "Atlantis The Lost Empire english",
    "Big Hero 6 full movie english", "Brave animated movie english", "Soul animated movie english",
    "Luca animated movie english", "Encanto full movie english", "Elemental full movie english",
    "Sing animated movie english", "Sing 2 animated movie english", "Hotel Transylvania english",
    "Hotel Transylvania 2 english", "Hotel Transylvania 3 english", "The Croods english",
    "Turbo animated movie english", "Rio animated movie english", "Rio 2 animated movie english",
    "The Secret Life of Pets english", "The Boss Baby english", "Cloudy with a Chance of Meatballs english",
    "Shark Tale english", "Bee Movie english", "Over the Hedge english", "Flushed Away english",

    # Blockbusters & Action
    "Pirates of the Caribbean full movie english", "The Curse of the Black Pearl english",
    "Dead Mans Chest full movie english", "At Worlds End full movie english",
    "Transformers 2007 english", "Transformers Revenge of the Fallen english",
    "Transformers Dark of the Moon english", "Transformers Age of Extinction english",
    "Fast and Furious 2001 english", "2 Fast 2 Furious english", "Tokyo Drift english",
    "Fast and Furious 4 english", "Fast Five 2011 english", "Fast and Furious 6 english",
    "Furious 7 2015 english", "The Fate of the Furious english",
    "Mission Impossible 1996 english", "Mission Impossible 2 english", "Mission Impossible 3 english",
    "Mission Impossible Ghost Protocol english", "Mission Impossible Rogue Nation english",
    "Mission Impossible Fallout english",
    "John Wick 2014 english", "John Wick Chapter 2 english", "John Wick Chapter 3 english",
    "John Wick Chapter 4 english", "Deadpool full movie english", "Deadpool 2 full movie english",
    "The Wolverine full movie english", "Logan 2017 full movie english", "X-Men Days of Future Past english",
    "Spider-Man 1 2002 english", "Spider-Man 2 2004 english", "Spider-Man 3 2007 english",
    "The Amazing Spider-Man 2012 english", "The Amazing Spider-Man 2 english",
    "Spider-Man Homecoming english", "Spider-Man Far From Home english", "Spider-Man No Way Home english",
    "The Dark Knight 2008 english", "The Dark Knight Rises english", "Batman Begins 2005 english",
    "The Batman 2022 english", "Man of Steel 2013 english", "Batman v Superman Dawn of Justice english",
    "Wonder Woman 2017 english", "Aquaman 2018 english", "Shazam 2019 english",
    "Suicide Squad 2016 english", "The Suicide Squad 2021 english",

    # Classics & Thrillers
    "The Matrix 1999 english", "The Matrix Reloaded 2003 english", "The Matrix Revolutions english",
    "Inception 2010 english", "Interstellar 2014 english", "The Prestige 2006 english",
    "Memento 2000 english", "Shutter Island 2010 english", "Fight Club 1999 english",
    "Forrest Gump 1994 english", "Pulp Fiction 1994 english", "The Shawshank Redemption english",
    "The Green Mile 1999 english", "The Godfather 1972 english", "The Godfather Part II english",
    "Goodfellas 1990 english", "The Departed 2006 english", "Scarface 1983 english",
    "Gladiator 2000 english", "Braveheart 1995 english", "Saving Private Ryan english",
    "Schindlers List english", "Titanic 1997 english", "Avatar 2009 english",
    "Avatar The Way of Water english", "Jurassic Park 1993 english", "The Lost World Jurassic Park english",
    "Jurassic World 2015 english", "Jurassic World Fallen Kingdom english",
    "Terminator 2 Judgment Day english", "The Terminator 1984 english", "Terminator 3 Rise of the Machines english",
    "The Hunger Games 2012 english", "Catching Fire english", "Mockingjay Part 1 english", "Mockingjay Part 2 english",
    "The Maze Runner 2014 english", "The Scorch Trials english", "The Death Cure english",
    "Divergent 2014 english", "Insurgent 2015 english", "Allegiant 2016 english",
    "Twilight 2008 english", "New Moon 2009 english", "Eclipse 2010 english", "Breaking Dawn Part 1 english", "Breaking Dawn Part 2 english",

    # Comedy
    "The Hangover 2009 english", "The Hangover Part II english", "The Hangover Part III english",
    "Home Alone 1990 english", "Home Alone 2 Lost in New York english",
    "The Mask 1994 english", "Dumb and Dumber 1994 english", "Ace Ventura Pet Detective english",
    "Liar Liar 1997 english", "Bruce Almighty 2003 english", "Yes Man 2008 english",
    "Night at the Museum 2006 english", "Night at the Museum Battle of the Smithsonian english",
    "Ted 2012 english", "Ted 2 2015 english", "21 Jump Street 2012 english", "22 Jump Street 2014 english",
    "Men in Black 1997 english", "Men in Black II 2002 english", "Men in Black 3 2012 english",
    "Johnny English 2003 english", "Johnny English Reborn 2011 english",

    # Popular Series
    "Game of Thrones season 1 episode 1 english", "Game of Thrones season 1 episode 2 english",
    "Stranger Things season 1 episode 1 english", "Stranger Things season 1 episode 2 english",
    "Sherlock season 1 episode 1 english", "Sherlock season 1 episode 2 english",
    "Peaky Blinders season 1 episode 1 english", "Peaky Blinders season 1 episode 2 english",
    "Chernobyl episode 1 english", "Chernobyl episode 2 english",
    "The Last of Us season 1 episode 1 english", "The Last of Us season 1 episode 2 english",
    "The Mandalorian season 1 episode 1 english", "The Mandalorian season 1 episode 2 english"
]

print(f"Kengaytirilgan so'rovlar: {len(QUERIES)} ta. Rutubedan yuklanmoqda...")

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

new_candidates = []
with ThreadPoolExecutor(max_workers=12) as executor:
    results = executor.map(fetch_rutube_query, QUERIES)
    for r_list in results:
        for item in r_list:
            if item['id'] not in existing_ids:
                existing_ids.add(item['id'])
                new_candidates.append(item)

print(f"Yangi nomzodlar soni: {len(new_candidates)} ta.")

def enrich_candidate(cand):
    raw_title = cand['title']
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

                if poster_path:
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

newly_verified = []
with ThreadPoolExecutor(max_workers=12) as executor:
    results = executor.map(enrich_candidate, new_candidates)
    for enriched_item in results:
        if enriched_item:
            title_key = enriched_item['clean_title'].lower()
            if title_key not in existing_titles:
                existing_titles.add(title_key)
                newly_verified.append(enriched_item)

print(f"Yangi tasdiqlangan va qo'shilgan: {len(newly_verified)} ta film!")
final_db = existing_movies + newly_verified
print(f"YAKUNIY BAZA HAJMI: {len(final_db)} ta film, serial va multfilm!")

with open(MOVIES_FILE, "w", encoding="utf-8") as f:
    json.dump(final_db, f, ensure_ascii=False, indent=2)

print("Baza to'liq yangilandi!")
