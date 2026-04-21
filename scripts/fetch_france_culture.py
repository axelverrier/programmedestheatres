"""
For each play currently being performed, searches Les Midis de Culture (France Culture)
for a matching episode.

Strategy:
  1. Fetch listing pages to collect all episode URLs.
  2. For each URL, normalize the slug and check if any current play's title words
     appear in it — no extra HTTP needed for non-matches.
  3. For matching URLs, fetch the episode page to get the proper display title.

Writes data/critics/france_culture.json.
"""
import json
import re
import sys
import unicodedata
from datetime import date
from html import unescape
from pathlib import Path

import requests

FC_PODCAST_URL  = "https://www.radiofrance.fr/franceculture/podcasts/les-midis-de-culture"
FC_PODCAST_PAGE = "https://www.radiofrance.fr/franceculture/podcasts/les-midis-de-culture?p={}"
FC_BASE_URL     = "https://www.radiofrance.fr"
PAGES = 3   # ~60 episodes / 12 weeks; raise if recent shows are missed

# Episode slug prefixes that are definitely not theatre — exclude from matching
NON_THEATRE_PREFIXES = (
    "critique-opera-",
    "critique-litterature-",
    "critique-cinema-",
    "critique-serie-",
    "critique-album-",
    "critique-expo-",
    "critique-bd-",
    "critique-jeu-video-",
)
ROOT     = Path(__file__).parent.parent
PLAYS_FILES = [
    ROOT / "data" / "theatres-publics-pieces-2025-2026.csv",
    ROOT / "data" / "theatres-prives-pieces-2025-2026.csv",
]
THEATRES_FILES = [
    ROOT / "data" / "theatres-publics.csv",
    ROOT / "data" / "theatres-prives.csv",
]
OUT = ROOT / "data" / "critics" / "france_culture.json"


# ── Helpers ──────────────────────────────────────────────────────────────────

def normalize(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def parse_csv(path: Path) -> list:
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


def slug_from_url(url: str) -> str:
    """Return the normalized episode slug (trailing numeric ID removed)."""
    path = url.rstrip("/").split("/")[-1]
    path = re.sub(r"-\d+$", "", path)   # strip trailing -1234567
    return normalize(path)


# ── Data loading ─────────────────────────────────────────────────────────────

def current_plays() -> list:
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
                })
    return plays


# ── Scraping ─────────────────────────────────────────────────────────────────

def fetch_all_episode_urls() -> list:
    """Fetch podcast listing pages and return all unique episode URLs."""
    headers = {"User-Agent": "Mozilla/5.0"}
    urls = [FC_PODCAST_URL] + [FC_PODCAST_PAGE.format(p) for p in range(2, PAGES + 1)]

    seen = set()
    result = []
    for url in urls:
        try:
            r = requests.get(url, headers=headers, timeout=15)
        except Exception as e:
            print("Warning: could not fetch {}: {}".format(url, e), file=sys.stderr)
            break
        if r.status_code != 200:
            break
        text = r.content.decode("utf-8", errors="ignore")
        slugs = re.findall(
            r'href="(/franceculture/podcasts/les-midis-de-culture/[^"?]+)"',
            text,
        )
        for slug in slugs:
            if slug not in seen:
                seen.add(slug)
                result.append(FC_BASE_URL + slug)

    return result


def fetch_episode_title(url: str):
    """Fetch one episode page and return its og:title, or None on failure."""
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        r = requests.get(url, headers=headers, timeout=15)
    except Exception as e:
        print("Warning: could not fetch {}: {}".format(url, e), file=sys.stderr)
        return None

    text = r.content.decode("utf-8", errors="ignore")

    m = re.search(r'property="og:title" content="([^"]+)"', text)
    if m:
        return unescape(m.group(1))

    m = re.search(r'<title>(.*?)</title>', text)
    if m:
        return re.sub(r"\s*\|\s*France Culture\s*$", "", unescape(m.group(1))).strip()

    return None


# ── Matching ─────────────────────────────────────────────────────────────────

def is_theatre_relevant(url: str) -> bool:
    """Return False for episode types that are clearly not theatre."""
    slug = url.rstrip("/").split("/")[-1]
    return not any(slug.startswith(p) for p in NON_THEATRE_PREFIXES)


def play_matches_slug(play: dict, slug_norm: str) -> bool:
    """Return True if all play title words (≥3 chars) appear as exact tokens in the slug."""
    norm_title  = normalize(play["title"])
    title_words = [w for w in norm_title.split() if len(w) >= 3]
    if not title_words:
        return False
    slug_words = set(slug_norm.split())
    return all(w in slug_words for w in title_words)


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    plays = current_plays()
    print("{} plays currently running".format(len(plays)))

    all_urls = fetch_all_episode_urls()
    print("{} total episodes found across {} pages".format(len(all_urls), PAGES))

    # Step 1: slug-match all episodes against all plays (no HTTP)
    candidate_urls = {}   # url -> list of matching plays
    for url in all_urls:
        if not is_theatre_relevant(url):
            continue
        slug_norm = slug_from_url(url)
        for play in plays:
            if play_matches_slug(play, slug_norm):
                candidate_urls.setdefault(url, []).append(play)

    print("{} episodes matched by slug".format(len(candidate_urls)))

    # Step 2: fetch titles only for matched episodes
    matches    = []
    seen_urls  = set()
    seen_plays = set()
    for url, matched_plays in candidate_urls.items():
        title = fetch_episode_title(url)
        if not title:
            continue
        print("  {!r}".format(title))
        for play in matched_plays:
            play_key = play["title"].lower()
            if url not in seen_urls and play_key not in seen_plays:
                seen_urls.add(url)
                seen_plays.add(play_key)
                matches.append({
                    "play_title":    play["title"],
                    "theatre":       play["theatre"],
                    "director":      play["director"],
                    "article_title": title,
                    "article_url":   url,
                })

    matches.sort(key=lambda m: m["play_title"])
    data = {"updated": date.today().isoformat(), "matches": matches}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Wrote {} matches to {}".format(len(matches), OUT))
    if not matches:
        print("Warning: 0 matches.", file=sys.stderr)


if __name__ == "__main__":
    main()
