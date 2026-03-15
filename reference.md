# Reference: programmedesexpos.paris

Source site to replicate/adapt: https://programmedesexpos.paris/
Our project: Programme des Théâtres (same concept, applied to theatre/performance venues)

---

## Concept

A **directory/aggregator website** listing all current, upcoming, and recently-ended shows across Paris and Île-de-France. Updated regularly. Designed for both human visitors and search engines (structured data).

**Core value proposition:** One place to see everything happening now in Paris theatres — no need to check each venue individually.

---

## Data Model

Each listing (show/performance) has these fields:

| Field | Type | Notes |
|---|---|---|
| `name` | string | Title of the show |
| `url` | string | Link to the venue's official page for that show |
| `startDate` | ISO 8601 date | e.g. `2026-03-15` |
| `endDate` | ISO 8601 date | e.g. `2026-06-30` |
| `location.name` | string | Name of the theatre/venue |
| `location.address.streetAddress` | string | Street address |
| `location.address.addressLocality` | string | City (Paris) |
| `location.address.postalCode` | string | e.g. `75001` |
| `isAccessibleForFree` | boolean | true/false |
| `organizer` | reference | The venue/theatre object |

Each **venue/theatre** has:

| Field | Type |
|---|---|
| `name` | string |
| `url` | string (official site) |
| `address` | full postal address |
| `arrondissement` | number (1–20) |

---

## Technical Architecture

### Structured Data (SEO)
The site uses **Schema.org JSON-LD** blocks embedded in the HTML `<head>` or inline. Key types used:
- `WebPage` — page metadata (title, description, datePublished)
- `PerformingArtsTheater` (or `Museum` equivalent) — venue objects
- `TheaterEvent` / `Event` — individual show listings

Example JSON-LD for a show:
```json
{
  "@context": "https://schema.org",
  "@type": "TheaterEvent",
  "name": "Nom du spectacle",
  "url": "https://theatre-example.fr/spectacle",
  "startDate": "2026-03-20",
  "endDate": "2026-07-15",
  "isAccessibleForFree": false,
  "location": {
    "@type": "PerformingArtsTheater",
    "name": "Comédie-Française",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "Place Colette",
      "addressLocality": "Paris",
      "postalCode": "75001"
    }
  }
}
```

### Page Metadata (WebPage schema)
```json
{
  "@type": "WebPage",
  "name": "Programme des Théâtres de Paris",
  "description": "Retrouvez tous les spectacles en cours et à venir dans les théâtres parisiens.",
  "datePublished": "2026-03-15",
  "inLanguage": "fr"
}
```

---

## Content Categories (for theatres)

Equivalent to the exhibition site's categorization, shows can be grouped by:

- **Type**: Théâtre, Comédie, Drame, Opéra, Danse, Cirque, Jeune public, One-man show
- **Status**: En cours / À venir / Bientôt terminé / Terminé
- **Price**: Gratuit / Payant
- **Location**: Arrondissement or zone (Paris intra-muros, Banlieue)

---

## Scale Reference (from expos site)

- **150+ exhibitions** listed across **80+ venues**
- Covers shows from **2025 through 2027**
- Updated regularly (page `datePublished` is updated on each refresh)

For theatres, expect a similar or larger scale:
- ~100–200 active shows at any given time in Paris
- ~60–100 venues (from Comédie-Française to small off-theatres)

---

## Key Parisian Theatre Venues to Include

### Grands théâtres nationaux
- Comédie-Française — Place Colette, 75001
- Opéra National de Paris (Garnier + Bastille)
- Théâtre National de la Colline — 75020
- Odéon – Théâtre de l'Europe — 75006
- Théâtre National de Chaillot — 75016

### Théâtres privés majeurs
- Théâtre du Palais-Royal — 75001
- Théâtre des Variétés — 75002
- Théâtre de la Madeleine — 75008
- Théâtre Antoine — 75010
- Théâtre de la Renaissance — 75010
- Théâtre du Gymnase — 75010
- Théâtre Marigny — 75008
- Théâtre de Paris — 75009
- Théâtre des Bouffes-Parisiens — 75002
- Théâtre de l'Atelier — 75018

### Salles de spectacle / Centres culturels
- La Villette — 75019
- Maison de la Culture de la Seine-Saint-Denis
- Théâtre du Châtelet — 75001
- Théâtre de la Ville — 75004

---

## Site Structure (pages to build)

```
/                        → Homepage: all current shows, filterable
/spectacles/[slug]       → Individual show page (optional)
/theatres/               → List of all venues
/theatres/[slug]         → Venue page with its current/upcoming shows
/a-venir/                → Upcoming shows
/bientot-fini/           → Shows ending soon
/gratuit/                → Free shows
```

---

## Homepage Layout (inferred from expos site)

The expos site appears to prioritize **machine-readability and SEO** over visual complexity. Likely a simple layout:

1. **Header** — site name, brief description, possibly date of last update
2. **Filter/nav bar** — by type, date, free/paid, arrondissement
3. **Listing** — organized by venue or chronologically
   - Each entry shows: show title, venue name, dates, free/paid badge
4. **Footer** — credits, update frequency, contact

---

## Data Sources to Scrape / Aggregate

- Individual theatre websites (programme pages)
- `billetreduc.com`, `fnac.com`, `theatreonline.com` for structured listings
- Official venue RSS feeds or APIs where available
- `what's on paris` aggregators

---

## SEO Strategy (mirroring the expos site)

- One page per show (for long-running shows) with rich JSON-LD
- Main page updated frequently with `datePublished` reflecting update time
- Title pattern: `Programme des Théâtres de Paris — Spectacles en cours [Month Year]`
- Meta description: include venue names, current month, "spectacles Paris"
- Use `breadcrumb` schema for navigation
- `SiteNavigationElement` schema for main nav

---

## Tech Stack Options

| Option | Pros | Cons |
|---|---|---|
| **Static site (Astro/Next.js SSG)** | Fast, SEO-friendly, easy JSON-LD injection | Needs rebuild pipeline for updates |
| **Next.js SSR/ISR** | Dynamic, fresh data, good SEO | More complex hosting |
| **Plain HTML + JS** | Simplest, fast | Hard to maintain at scale |
| **Nuxt/SvelteKit** | Good alternatives to Next | Smaller ecosystem |

Recommended: **Next.js with ISR** (Incremental Static Regeneration) — pages rebuild automatically on a schedule without a full redeploy.

---

## Content Update Strategy

The expos site updates its `datePublished` regularly, suggesting:
- A **cron job or scheduled script** that scrapes venues and rebuilds/updates the data
- Shows are added when announced, marked ended when past their `endDate`
- "Bientôt terminé" filter: shows ending within the next 2 weeks

---

## Minimum Viable Dataset (to launch)

To launch a v1:
1. Pick 20–30 major Paris theatres
2. For each, manually enter current season programme (5–10 shows each)
3. Fields per show: title, URL, startDate, endDate, free/paid
4. Generate JSON-LD and embed in HTML
5. Build simple filterable list UI

This gives ~100–200 show entries — enough to be useful from day one.
