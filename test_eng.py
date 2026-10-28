import urllib.request
import json
import urllib.parse
import re

def test_search(q):
    url = f'https://rutube.ru/api/search/video/?query={urllib.parse.quote(q)}&format=json'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    res = json.loads(urllib.request.urlopen(req).read().decode('utf-8'))
    results = [r for r in res.get('results', []) if (r.get('duration') or 0) > 1800]
    print(f'Query: "{q}" -> {len(results)} long videos')
    for r in results[:4]:
        title = r.get('title', '')
        has_cyrillic = bool(re.search(r'[\u0400-\u04FF]', title))
        print(f'   - [{r.get("id")}] {title[:60]} (Cyrillic: {has_cyrillic})')

test_search('Avatar movie english')
test_search('Gladiator movie english')
test_search('Spider-Man movie english')
test_search('Shrek movie english')
