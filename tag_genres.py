import json
import re

MOVIES_FILE = r"C:\Users\Muham\.gemini\antigravity\scratch\kino-stream\movies.json"

with open(MOVIES_FILE, "r", encoding="utf-8") as f:
    data = json.load(f)

for m in data:
    txt = f"{m.get('title','')} {m.get('clean_title','')} {m.get('overview','')}".lower()
    genres = []
    if re.search(r'animat|cartoon|pixar|disney|shrek|toy story|lion king|ice age|kung fu panda|inside out|coco|zootopia|moana|frozen|tangled|minions|despicable|dragon|madagascar|croods|turbo|rio', txt):
        genres.append('Animation')
    if re.search(r'action|avengers|batman|spider|iron man|thor|wick|fast|furious|mission|war|fight|gladiator|terminator|marvel|dc|superhero|equalizer|strike|blade|gun', txt):
        genres.append('Action')
    if re.search(r'sci-fi|science fiction|space|alien|interstellar|inception|dune|avatar|star wars|jurassic|matrix|future|galaxy|cyber', txt):
        genres.append('Sci-Fi')
    if re.search(r'comedy|funny|humor|hangover|home alone|mask|ted|jump street|laugh|ace ventura', txt):
        genres.append('Comedy')
    if re.search(r'crime|thriller|mystery|murder|detective|breaking bad|police|fbi|mafia|gangster|investigat|se7en|saw|shutter island', txt):
        genres.append('Crime')
    if re.search(r'drama|life|love|emotion|relationship|godfather|shawshank|green mile|forrest gump|prestige', txt):
        genres.append('Drama')
    if not genres:
        genres.append('Action')
        genres.append('Adventure')
    m['genres'] = genres[:3]

with open(MOVIES_FILE, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("1037 ta asarga janrlar biriktirildi!")
