"""
For each play currently being performed, searches La Terrasse for a matching critique.

Matching strategy (in order):
  1. Guillemet match — play title found inside «…» in the article headline
  2. URL slug match  — title words + director surname appear in the article URL
  3. Full text match — title words + director surname appear in the article text

Writes data/critics.json.
"""
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

import requests
from bs4 import BeautifulSoup

TERRASSE_P1   = "https://www.journal-laterrasse.fr/theatre/type/critique/"
TERRASSE_PAGE = "https://www.journal-laterrasse.fr/theatre/type/critique/page/{}/"
ROOT     = Path(__file__).parent.parent
PLAYS_FILES = [
    ROOT / "data" / "theatres-publics-pieces-2025-2026.csv",
    ROOT / "data" / "theatres-prives-pieces-2025-2026.csv",
]
THEATRES_FILES = [
    ROOT / "data" / "theatres-publics.csv",
    ROOT / "data" / "theatres-prives.csv",
]
OUT      = ROOT / "data" / "critics.json"
PAGES    = 4   # ~16-40 articles; raise if too many shows are missed


# ── Helpers ──────────────────────────────────────────────────────────────────

def normalize(s: str) -> str:
    """Lowercase, strip accents, keep alphanumeric + spaces, collapse whitespace."""
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def parse_csv(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8").replace("\ufeff", "")
    lines = [l for l in text.strip().splitlines() if l.strip()]
    keys = [k.strip() for k in lines[0].split(";")]
    return [dict(zip(keys, [v.strip() for v in l.split(";")])) for l in lines[1:]]


def parse_date(s: str) -> date:
    s = s.strip()
    if "/" in s:
        d, m, y = s.split("/")
        return date(int(y), int(m), int(d))
    return date.fromisoformat(s)


# ── Data loading ─────────────────────────────────────────────────────────────

def current_plays() -> list[dict]:
    today = date.today()
    theatre_map = {}
    for theatres_file in THEATRES_FILES:
        for r in parse_csv(theatres_file):
            theatre_map[r["theatre_id"]] = r["name"]
    plays = []
    for plays_file in PLAYS_FILES:
        for row in parse_csv(plays_file):
            try:
                start = parse_date(row.get("start_date", ""))
                end   = parse_date(row.get("end_date", ""))
            except Exception:
                continue
            if start <= today <= end:
                plays.append({
                    "title":    row.get("title", "").strip(),
                    "director": row.get("director", "").strip(),
                    "theatre":  theatre_map.get(row.get("theatre_id", ""), ""),
                    "url":      row.get("url", "").strip(),
                })
    return plays


# ── Scraping ─────────────────────────────────────────────────────────────────

def fetch_articles() -> list[dict]:
    headers  = {"User-Agent": "Mozilla/5.0"}
    articles = []
    urls = [TERRASSE_P1] + [TERRASSE_PAGE.format(p) for p in range(2, PAGES + 1)]

    for url in urls:
        try:
            r = requests.get(url, headers=headers, timeout=15)
        except Exception as e:
            print(f"Warning: could not fetch {url}: {e}", file=sys.stderr)
            break
        if r.status_code != 200:
            break
        soup = BeautifulSoup(r.text, "html.parser")
        for article in soup.select("article"):
            # On La Terrasse the <a> wraps the whole article card
            a       = article.find("a", href=True)
            heading = article.find(["h2", "h3"])
            if not a or not heading:
                continue
            title    = heading.get_text(strip=True)
            href     = a["href"]
            m        = re.search(r"[\u00ab\u201c](.*?)[\u00bb\u201d]", title)
            guillemet = normalize(m.group(1)) if m else ""
            articles.append({
                "title":      title,
                "url":        href,
                "guillemet":  guillemet,
                "normalized": normalize(title),
                "url_norm":   normalize(href),
            })

    return articles


# ── Matching ─────────────────────────────────────────────────────────────────

def match_play(play: dict, articles: list[dict]) -> dict | None:
    norm_title  = normalize(play["title"])
    title_words = [w for w in norm_title.split() if len(w) >= 3]
    surname     = normalize(play["director"].split()[-1]) if play["director"] else ""

    for art in articles:
        g        = art["guillemet"]
        n        = art["normalized"]
        url_norm = art["url_norm"]

        # 1. Guillemet: play title matches text between «» in headline
        if g and (norm_title in g or g in norm_title):
            return art

        if not title_words:
            continue

        # 2. URL slug: title words + director surname in article URL
        if all(w in url_norm for w in title_words):
            if not surname or surname in url_norm:
                return art

        # 3. Full text: title words + director surname in article headline
        if all(w in n for w in title_words):
            if not surname or surname in n:
                return art

    return None


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    plays    = current_plays()
    articles = fetch_articles()
    print(f"{len(plays)} plays currently running, {len(articles)} articles fetched")

    matches   = []
    seen_urls = set()
    for play in plays:
        if not play["title"]:
            continue
        art = match_play(play, articles)
        if art and art["url"] not in seen_urls:
            seen_urls.add(art["url"])
            matches.append({
                "play_title":    play["title"],
                "theatre":       play["theatre"],
                "director":      play["director"],
                "article_title": art["title"],
                "article_url":   art["url"],
            })

    data = {"updated": date.today().isoformat(), "matches": matches}
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(matches)} matches to {OUT}")
    if not matches:
        print("Warning: 0 matches.", file=sys.stderr)


if __name__ == "__main__":
    main()
