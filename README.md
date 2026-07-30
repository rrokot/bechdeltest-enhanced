# Bechdeltest Enhanced

A lightweight Tampermonkey userscript that adds ratings, genres, and filters to
[bechdeltest.com](https://bechdeltest.com/).

## Features

- KP and IMDb ratings displayed before each movie title
- Color-coded rating badges
- Direct links to KP and IMDb title pages
- Up to three IMDb genres per movie
- Minimum KP and IMDb rating filters
- Exact Bechdel score filter
- Multi-select genre exclusion filter
- Wider, non-wrapping movie list on desktop
- Lazy loading, batching, and seven-day caching
- No API key or registration required

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open the
   [userscript installer](https://raw.githubusercontent.com/rrokot/bechdeltest-enhanced/main/bechdeltest-enhanced.user.js).
3. Confirm the installation in Tampermonkey.
4. Open [bechdeltest.com](https://bechdeltest.com/).

Tampermonkey checks the `@updateURL` automatically, so installed copies receive
new releases without manual replacement.

## Filters

| Control | Behavior |
| --- | --- |
| `KP ≥` | Minimum KP rating |
| `IMDb ≥` | Minimum IMDb rating |
| `B =` | Exact Bechdel score |
| `Genre −` | Exclude one or more genres |

Filter settings persist across pages.

## Data sources

The userscript uses the IMDb ID already present on Bechdel Test:

- Wikidata resolves IMDb IDs to Kinopoisk IDs.
- The public Kinopoisk XML rating widget provides KP ratings.
- IMDb GraphQL provides IMDb ratings and genres.

Data loads only for movies near the viewport. Successful results are cached for
seven days, while missing results are cached for one day.

## Development

For local development, create a small Tampermonkey loader with:

```javascript
// @require file:///absolute/path/to/bechdeltest-enhanced.user.js
```

Enable file URL access for Tampermonkey in the browser extension settings, then
reload Bechdel Test after each local change.

Validate the script with:

```bash
node --check bechdeltest-enhanced.user.js
```

## License

[MIT](LICENSE)
