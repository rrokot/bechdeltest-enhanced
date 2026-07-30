# Bechdeltest Enhanced

A lightweight Tampermonkey userscript that adds ratings, genres, and filters to
[bechdeltest.com](https://bechdeltest.com/).

## Features

- KP and IMDb ratings displayed before each movie title
- Color-coded rating badges
- Direct links to KP and IMDb title pages
- Up to three IMDb genres per movie
- Minimum KP and IMDb rating filters
- Minimum Bechdel score filter
- Multi-select genre exclusion filter
- Wider, non-wrapping movie list on desktop
- Progress indicator while ratings are still loading
- Independent source loading, controlled concurrency, and seven-day caching
- No API key or registration required

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open the Tampermonkey extension settings and enable **Allow User Scripts**.
3. Open the
   [userscript installer](https://raw.githubusercontent.com/rrokot/bechdeltest-enhanced/main/bechdeltest-enhanced.user.js).
4. Confirm the installation in Tampermonkey.
5. Open [bechdeltest.com](https://bechdeltest.com/).

Tampermonkey checks the `@updateURL` automatically, so installed copies receive
new releases without manual replacement.

## Filters

| Control | Behavior |
| --- | --- |
| `KP ≥` | Minimum KP rating |
| `IMDb ≥` | Minimum IMDb rating |
| `B ≥` | Minimum Bechdel score |
| `Genre −` | Click genres to mark them with `×` and exclude them |

Filter settings persist across pages.

## Data sources

The userscript uses the IMDb ID already present on Bechdel Test:

- Wikidata resolves IMDb IDs to Kinopoisk IDs.
- The public Kinopoisk XML rating widget provides KP ratings.
- IMDb GraphQL provides IMDb ratings and genres.

IMDb data loads for the whole page in one request. Kinopoisk IDs are resolved in
one Wikidata request, then individual rating XML files load through a concurrent
worker pool. Successful results are cached for seven days, while missing results
are cached for one day.

When Wikidata has no Kinopoisk ID, the userscript performs a sequential
Kinopoisk search using the IMDb title and year. A result is accepted only when
its normalized title, year, and director all match the IMDb metadata exactly.
Blocked, missing, or ambiguous search results remain unresolved.

## License

[MIT](LICENSE)
