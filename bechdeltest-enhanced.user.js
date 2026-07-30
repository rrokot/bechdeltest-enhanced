// ==UserScript==
// @name         Bechdel Test — Ratings & Filters
// @namespace    https://github.com/rrokot/bechdeltest-enhanced
// @version      1.0.8
// @description  Adds ratings, genres, and filters without an API key.
// @author       rrokot
// @license      MIT
// @homepageURL  https://github.com/rrokot/bechdeltest-enhanced
// @supportURL   https://github.com/rrokot/bechdeltest-enhanced/issues
// @updateURL    https://raw.githubusercontent.com/rrokot/bechdeltest-enhanced/main/bechdeltest-enhanced.user.js
// @downloadURL  https://raw.githubusercontent.com/rrokot/bechdeltest-enhanced/main/bechdeltest-enhanced.user.js
// @match        https://bechdeltest.com/*
// @match        https://www.bechdeltest.com/*
// @connect      query.wikidata.org
// @connect      rating.kinopoisk.ru
// @connect      api.graphql.imdb.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = Object.freeze({
    urls: Object.freeze({
      wikidataSparql: 'https://query.wikidata.org/sparql',
      imdbGraphql: 'https://api.graphql.imdb.com/',
      kinopoiskRating: 'https://rating.kinopoisk.ru',
      kinopoiskTitle: 'https://www.kinopoisk.ru/film',
      imdbTitle: 'https://www.imdb.com/title',
    }),
    cachePrefixes: Object.freeze({
      imdb: 'movie-ratings:imdb:v1:',
      kinopoisk: 'movie-ratings:kinopoisk:v1:',
    }),
    filterKey: 'movie-ratings:filters:v1',
    cacheTtl: 7 * 24 * 60 * 60 * 1000,
    missCacheTtl: 24 * 60 * 60 * 1000,
    kinopoiskConcurrency: 10,
    requestTimeout: 20_000,
    genreLimit: 3,
    ratingPrecision: 1,
    numberLocale: 'en-US',
    ratingTiers: Object.freeze([
      Object.freeze({ minimum: 8, name: 'excellent' }),
      Object.freeze({ minimum: 7, name: 'good' }),
      Object.freeze({ minimum: 6, name: 'average' }),
      Object.freeze({ minimum: 5, name: 'weak' }),
      Object.freeze({ minimum: 0, name: 'bad' }),
    ]),
  });

  const SELECTORS = Object.freeze({
    list: '.list',
    movie: '.movie',
    kpBadge: '.kp-rating',
    imdbBadge: '.imdb-rating',
    genre: '.movie-genres',
    imdbLink: 'a[href*="imdb.com/title/"]',
    movieTitle: 'a[id^="movie-"]',
  });

  const state = {
    filters: null,
    filterFrame: null,
    statusElement: null,
    queuedRatings: 0,
    pendingRatings: 0,
    failedRatings: 0,
  };

  const addStyles = () => {
    const style = document.createElement('style');
    style.textContent = `
      .kp-rating,
      .imdb-rating {
        display: inline-block;
        box-sizing: border-box;
        margin-left: .25em;
        padding: .05em .3em;
        border: 1px solid #ccc;
        border-radius: .35em;
        font: 600 12px/1.35 Arial, sans-serif !important;
        text-decoration: none !important;
        vertical-align: .08em;
        white-space: nowrap;
      }
      .imdb-rating {
        margin-right: .25em;
      }
      .kp-rating[data-state="loading"],
      .imdb-rating[data-state="loading"] {
        border-color: #bbb;
        background: #f3f3f3;
        color: #666 !important;
      }
      .kp-rating[data-state="missing"],
      .imdb-rating[data-state="missing"],
      .kp-rating[data-state="error"],
      .imdb-rating[data-state="error"] {
        border-color: #ccc;
        background: #fafafa;
        color: #777 !important;
      }
      .kp-rating[data-tier="excellent"],
      .imdb-rating[data-tier="excellent"] {
        border-color: #16803c;
        background: #c9f2d5;
        color: #084d25 !important;
      }
      .kp-rating[data-tier="good"],
      .imdb-rating[data-tier="good"] {
        border-color: #70a52b;
        background: #e5f4c7;
        color: #355d0d !important;
      }
      .kp-rating[data-tier="average"],
      .imdb-rating[data-tier="average"] {
        border-color: #c99900;
        background: #fff0ad;
        color: #624800 !important;
      }
      .kp-rating[data-tier="weak"],
      .imdb-rating[data-tier="weak"] {
        border-color: #db7818;
        background: #ffe0b5;
        color: #713407 !important;
      }
      .kp-rating[data-tier="bad"],
      .imdb-rating[data-tier="bad"] {
        border-color: #c13b3b;
        background: #ffd1d1;
        color: #781d1d !important;
      }
      .kp-rating[data-tier]:hover,
      .imdb-rating[data-tier]:hover {
        filter: brightness(.94);
      }
      .movie-genres {
        margin-left: .15em;
        color: #777;
        font: 11px/1.2 Arial, sans-serif;
      }
      .list .movie {
        white-space: nowrap;
      }
      @media (min-width: 720px) {
        body {
          max-width: 1100px;
        }
        .columns {
          grid-template-columns: minmax(520px, 1.45fr) minmax(260px, 1fr);
        }
      }
      .rating-filters {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: .35em .6em;
        margin: -.25em 0 .65em;
        padding: 0;
        color: #555;
        font: 12px/1.2 Arial, sans-serif;
      }
      .rating-filters label {
        display: inline-flex;
        align-items: center;
        gap: .18em;
        white-space: nowrap;
      }
      .rating-filters select {
        min-width: 36px;
        height: 21px;
        border: 1px solid #aaa;
        border-radius: 2px;
        background: #fff;
        color: #222;
        padding: 0 2px;
        font: 11px/1 Arial, sans-serif;
      }
      .rating-status {
        display: inline-flex;
        align-items: center;
        gap: .4em;
        margin-left: auto;
        color: #666;
        font: 11px/1.2 Arial, sans-serif;
        white-space: nowrap;
      }
      .rating-status[data-state="failed"] {
        color: #a11;
      }
      .rating-status[data-state="loading"]::before {
        content: "";
        width: 9px;
        height: 9px;
        border: 2px solid #ccc;
        border-top-color: #666;
        border-radius: 50%;
        animation: rating-spin .7s linear infinite;
      }
      @keyframes rating-spin {
        to {
          transform: rotate(360deg);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .rating-status[data-state="loading"]::before {
          animation: none;
        }
      }
      .genre-filter {
        position: relative;
      }
      .genre-filter summary {
        box-sizing: border-box;
        height: 21px;
        padding: 3px 5px;
        border: 1px solid #aaa;
        border-radius: 2px;
        background: #fff;
        color: #222;
        cursor: pointer;
        list-style: none;
        font: 11px/1.2 Arial, sans-serif;
      }
      .genre-filter summary::-webkit-details-marker {
        display: none;
      }
      .genre-filter[open] summary {
        background: #eee;
      }
      .genre-options {
        position: absolute;
        z-index: 1000;
        top: calc(100% + 2px);
        left: 0;
        display: grid;
        gap: 3px;
        min-width: 145px;
        max-height: 260px;
        overflow: auto;
        padding: 7px;
        border: 1px solid #999;
        background: #fff;
        box-shadow: 2px 3px 8px rgb(0 0 0 / 18%);
      }
      .genre-option {
        position: relative;
        width: 100%;
        padding: 3px 5px 3px 18px;
        border: 0;
        border-radius: 2px;
        background: transparent;
        color: #222;
        cursor: pointer;
        text-align: left;
        font: 11px/1.2 Arial, sans-serif;
      }
      .genre-option::before {
        content: "×";
        position: absolute;
        left: 5px;
        color: #a11;
        font-weight: bold;
        opacity: 0;
      }
      .genre-option:hover {
        background: #eee;
      }
      .genre-option[data-excluded="true"] {
        background: #ffe3e3;
        color: #811;
        text-decoration: line-through;
      }
      .genre-option[data-excluded="true"]::before {
        opacity: 1;
      }
    `;
    document.head.append(style);
  };

  const defaultFilters = {
    kpMin: '',
    imdbMin: '',
    bechdel: '',
    excludedGenres: [],
  };

  const readFilters = () => ({
    ...defaultFilters,
    ...GM_getValue(CONFIG.filterKey, {}),
  });

  const createSelect = (options, value) => {
    const select = document.createElement('select');
    options.forEach(([optionValue, label]) => {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = label;
      select.append(option);
    });
    select.value = value;
    return select;
  };

  const getBadgeRating = (badge) => (
    badge?.dataset.state === 'ready'
      ? Number.parseFloat(badge.textContent)
      : null
  );

  const updateGenreSummary = () => {
    if (!state.filters?.genreSummary) return;
    const count = state.filters.excludedGenres.size;
    state.filters.genreSummary.textContent = count
      ? `Genre − (${count})`
      : 'Genre −';
  };

  const updateGenreOptionState = (button, genre) => {
    const excluded = state.filters.excludedGenres.has(genre);
    button.dataset.excluded = String(excluded);
    button.setAttribute('aria-pressed', String(excluded));
    button.title = excluded ? `Include ${genre}` : `Exclude ${genre}`;
  };

  const updateGenreFilterOptions = (genres = []) => {
    if (!state.filters?.genreOptions) return;
    let changed = false;
    genres.forEach((genre) => {
      if (!genre || state.filters.knownGenres.has(genre)) return;
      state.filters.knownGenres.add(genre);
      changed = true;
    });
    if (!changed && state.filters.genreOptions.children.length) return;

    const fragment = document.createDocumentFragment();
    [...state.filters.knownGenres]
      .sort((a, b) => a.localeCompare(b))
      .forEach((genre) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'genre-option';
        button.textContent = genre;
        updateGenreOptionState(button, genre);
        button.addEventListener('click', () => {
          if (state.filters.excludedGenres.has(genre)) {
            state.filters.excludedGenres.delete(genre);
          } else {
            state.filters.excludedGenres.add(genre);
          }
          updateGenreOptionState(button, genre);
          updateGenreSummary();
          commitFilters();
        });
        fragment.append(button);
      });
    state.filters.genreOptions.replaceChildren(fragment);
    updateGenreSummary();
  };

  const getCurrentFilters = () => ({
    kpMin: state.filters.kpMin.value,
    imdbMin: state.filters.imdbMin.value,
    bechdel: state.filters.bechdel.value,
    excludedGenres: [...state.filters.excludedGenres],
  });

  const getRowData = (row) => {
    const kpBadge = row.querySelector(SELECTORS.kpBadge);
    const imdbBadge = row.querySelector(SELECTORS.imdbBadge);
    const genreElement = row.querySelector(SELECTORS.genre);
    return {
      kpBadge,
      imdbBadge,
      genreElement,
      kpRating: getBadgeRating(kpBadge),
      imdbRating: getBadgeRating(imdbBadge),
      genres: genreElement?.dataset.genres?.split('|').filter(Boolean) ?? [],
      bechdelRating: row
        .querySelector(`${SELECTORS.imdbLink} img`)
        ?.alt?.match(/\[\[(\d)\]\]/)?.[1] ?? '',
    };
  };

  // A badge that is still loading, or whose source could not be reached, says
  // nothing about the rating, so the row stays visible instead of silently
  // disappearing behind a minimum the movie may well satisfy.
  const UNRESOLVED_STATES = new Set(['loading', 'error']);

  const passesRatingFilter = (badge, rating, minimum) => (
    !minimum
    || UNRESOLVED_STATES.has(badge?.dataset.state)
    || (rating !== null && rating >= Number(minimum))
  );

  const rowMatchesFilters = (row, filters) => {
    const data = getRowData(row);
    if (
      filters.bechdel
      && Number(data.bechdelRating) < Number(filters.bechdel)
    ) return false;
    if (!passesRatingFilter(data.kpBadge, data.kpRating, filters.kpMin)) {
      return false;
    }
    if (!passesRatingFilter(data.imdbBadge, data.imdbRating, filters.imdbMin)) {
      return false;
    }

    const genresLoaded = data.genreElement?.dataset.loaded === 'true';
    return !genresLoaded
      || !data.genres.some((genre) => filters.excludedGenres.includes(genre));
  };

  const updateYearGroupVisibility = () => {
    const list = document.querySelector(SELECTORS.list);
    if (!list) return;

    const groups = [];
    let currentGroup = null;
    [...list.children].forEach((element) => {
      if (element.tagName === 'H3') {
        currentGroup = { heading: element, movies: [], extras: [] };
        groups.push(currentGroup);
      } else if (currentGroup && element.matches(SELECTORS.movie)) {
        currentGroup.movies.push(element);
      } else if (currentGroup && element.classList.contains('ad')) {
        currentGroup.extras.push(element);
      }
    });

    groups.forEach(({ heading, movies, extras }) => {
      const hidden = !movies.some((movie) => !movie.hidden);
      heading.hidden = hidden;
      extras.forEach((element) => {
        element.hidden = hidden;
      });
    });
  };

  const applyFilters = () => {
    if (!state.filters) return;

    const filters = getCurrentFilters();
    document.querySelectorAll(SELECTORS.movie).forEach((row) => {
      row.hidden = !rowMatchesFilters(row, filters);
    });
    updateYearGroupVisibility();
  };

  // Movies hydrate one by one, so coalesce their re-filters into a single pass
  // per frame instead of walking the whole list once per rendered badge.
  const scheduleFilters = () => {
    if (!state.filters || state.filterFrame !== null) return;
    state.filterFrame = window.requestAnimationFrame(() => {
      state.filterFrame = null;
      applyFilters();
    });
  };

  const commitFilters = () => {
    GM_setValue(CONFIG.filterKey, getCurrentFilters());
    applyFilters();
  };

  // Both sources start for the whole page. IMDb uses one GraphQL request;
  // Kinopoisk resolves all ids once and fills ratings through a worker pool.
  const updateStatus = () => {
    const status = state.statusElement;
    if (!status) return;

    if (state.pendingRatings) {
      const done = state.queuedRatings - state.pendingRatings;
      status.dataset.state = 'loading';
      status.textContent = `Ratings ${done} / ${state.queuedRatings}`;
    } else if (state.failedRatings) {
      status.dataset.state = 'failed';
      status.textContent = `${state.failedRatings} unavailable`;
      status.title = 'Some ratings could not be loaded and will be retried on the next visit';
    } else {
      status.dataset.state = 'idle';
      status.textContent = '';
    }
    status.hidden = status.dataset.state === 'idle';
  };

  const addFilterPanel = () => {
    const rows = document.querySelectorAll(SELECTORS.movie);
    const heading = document.querySelector(`${SELECTORS.list} > h2`);
    if (!rows.length || !heading || document.querySelector('.rating-filters')) return;

    const saved = readFilters();
    const minOptions = [
      ['', '-'],
      ['5', '5'],
      ['6', '6'],
      ['7', '7'],
      ['8', '8'],
      ['9', '9'],
    ];
    const bechdelOptions = [
      ['', '-'],
      ['1', '1'],
      ['2', '2'],
      ['3', '3'],
    ];

    const panel = document.createElement('div');
    panel.className = 'rating-filters';

    const kpMin = createSelect(minOptions, saved.kpMin);
    const imdbMin = createSelect(minOptions, saved.imdbMin);
    const bechdel = createSelect(bechdelOptions, saved.bechdel);
    const genreDetails = document.createElement('details');
    genreDetails.className = 'genre-filter';
    const genreSummary = document.createElement('summary');
    const genreOptions = document.createElement('div');
    genreOptions.className = 'genre-options';
    genreDetails.append(genreSummary, genreOptions);

    const addLabeledControl = (text, control) => {
      const label = document.createElement('label');
      label.append(document.createTextNode(text), control);
      panel.append(label);
    };

    const status = document.createElement('span');
    status.className = 'rating-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;

    addLabeledControl('KP ≥', kpMin);
    addLabeledControl('IMDb ≥', imdbMin);
    addLabeledControl('B ≥', bechdel);
    panel.append(genreDetails, status);

    const excludedGenres = new Set(
      Array.isArray(saved.excludedGenres) ? saved.excludedGenres : [],
    );
    state.filters = {
      kpMin,
      imdbMin,
      bechdel,
      excludedGenres,
      knownGenres: new Set(excludedGenres),
      genreSummary,
      genreOptions,
    };
    [kpMin, imdbMin, bechdel].forEach((control) => {
      control.addEventListener('change', commitFilters);
    });
    updateGenreFilterOptions([...excludedGenres]);
    state.statusElement = status;
    updateStatus();

    heading.after(panel);
    applyFilters();
  };

  const extractImdbId = (href) => href?.match(/\/title\/(tt\d+)/i)?.[1] ?? null;

  const readSourceCache = (prefix, ratingKey, imdbId) => {
    const key = `${prefix}${imdbId}`;
    const cached = GM_getValue(key, null);
    if (!cached || typeof cached.savedAt !== 'number') return null;

    const ttl = cached[ratingKey] !== null
      ? CONFIG.cacheTtl
      : CONFIG.missCacheTtl;
    if (Date.now() - cached.savedAt <= ttl) return cached;

    GM_deleteValue(key);
    return null;
  };

  const writeSourceCache = (prefix, imdbId, data) => {
    GM_setValue(`${prefix}${imdbId}`, {
      ...data,
      savedAt: Date.now(),
    });
  };

  const gmRequest = ({
    method = 'GET',
    url,
    headers = {},
    data,
  }) => new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method,
      url,
      headers,
      data,
      timeout: CONFIG.requestTimeout,
      onload: (response) => {
        if (response.status >= 200 && response.status < 300) {
          resolve(response.responseText);
          return;
        }
        const error = new Error(`HTTP ${response.status}`);
        error.status = Number(response.status);
        reject(error);
      },
      onerror: () => reject(new Error('Could not connect to the rating source')),
      ontimeout: () => reject(new Error('The rating source timed out')),
    });
  });

  const parseJson = (text, source) => {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${source} returned an invalid response`);
    }
  };

  const settle = async (task) => {
    try {
      return { value: await task, error: null };
    } catch (error) {
      return { value: null, error };
    }
  };

  // Only explicit "not found" responses are real missing data. Other 4xx
  // responses can be temporary authorization, timeout, or rate-limit failures.
  const isMissingDataError = (error) => (
    error?.status === 404 || error?.status === 410
  );

  const fetchKinopoiskIds = async (imdbIds) => {
    const values = imdbIds.map((id) => `"${id}"`).join(' ');
    const query = `
      SELECT ?imdb ?kp WHERE {
        VALUES ?imdb { ${values} }
        ?item <http://www.wikidata.org/prop/direct/P345> ?imdb;
              <http://www.wikidata.org/prop/direct/P2603> ?kp.
      }
    `;
    const params = new URLSearchParams({
      query,
      format: 'json',
    });
    const text = await gmRequest({
      method: 'POST',
      url: CONFIG.urls.wikidataSparql,
      headers: {
        Accept: 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: params.toString(),
    });
    const json = parseJson(text, 'Wikidata');
    return new Map(
      (json?.results?.bindings || []).map((row) => [
        row.imdb.value,
        row.kp.value,
      ]),
    );
  };

  const fetchImdbRatings = async (imdbIds) => {
    const fields = imdbIds
      .map((id, index) => (
        `t${index}: title(id: "${id}") {
          ratingsSummary { aggregateRating voteCount }
          genres { genres { text } }
        }`
      ))
      .join('\n');
    const body = JSON.stringify({
      query: `query BechdelRatings { ${fields} }`,
    });
    const text = await gmRequest({
      method: 'POST',
      url: CONFIG.urls.imdbGraphql,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      data: body,
    });
    const json = parseJson(text, 'IMDb');
    if (!json?.data || typeof json.data !== 'object') {
      throw new Error('IMDb returned no data');
    }

    const failedAliases = new Set();
    let hasUnscopedErrors = false;
    if (Array.isArray(json.errors)) {
      json.errors.forEach((error) => {
        const alias = error?.path?.[0];
        if (typeof alias === 'string' && /^t\d+$/.test(alias)) {
          failedAliases.add(alias);
        } else {
          hasUnscopedErrors = true;
        }
      });
    }

    return new Map(imdbIds.map((imdbId, index) => {
      const alias = `t${index}`;
      const rating = json.data[alias]?.ratingsSummary;
      const genres = json.data[alias]?.genres?.genres;
      return [imdbId, {
        imdbRating: Number.isFinite(rating?.aggregateRating)
          ? rating.aggregateRating
          : null,
        imdbVotes: Number.isFinite(rating?.voteCount)
          ? rating.voteCount
          : null,
        genres: Array.isArray(genres)
          ? genres
            .map((genre) => genre.text)
            .filter(Boolean)
            .slice(0, CONFIG.genreLimit)
          : [],
        imdbError: hasUnscopedErrors || failedAliases.has(alias),
      }];
    }));
  };

  const fetchKinopoiskRating = async (kinopoiskId) => {
    const xmlText = await gmRequest({
      url: `${CONFIG.urls.kinopoiskRating}/${kinopoiskId}.xml`,
      headers: {
        Accept: 'application/xml,text/xml',
      },
    });
    const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (xml.querySelector('parsererror')) {
      throw new Error('Kinopoisk returned invalid XML');
    }

    const kp = xml.querySelector('kp_rating');
    const kpRating = Number.parseFloat(kp?.textContent);
    const kpVotes = Number.parseInt(kp?.getAttribute('num_vote'), 10);

    return {
      kpRating: Number.isFinite(kpRating) ? kpRating : null,
      kpVotes: Number.isFinite(kpVotes) ? kpVotes : null,
    };
  };

  const runWorkerPool = async (items, concurrency, task) => {
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        await task(item);
      }
    };
    const workerCount = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
  };

  const formatVotes = (votes) => (
    votes ? new Intl.NumberFormat(CONFIG.numberLocale).format(votes) : ''
  );

  const getRatingTier = (rating) => (
    CONFIG.ratingTiers.find(({ minimum }) => rating >= minimum).name
  );

  const getImdbBadge = (kpBadge) => {
    const sibling = kpBadge.nextElementSibling;
    return sibling?.matches(SELECTORS.imdbBadge) ? sibling : null;
  };

  const getGenreElement = (kpBadge) => (
    kpBadge.parentElement?.querySelector(SELECTORS.genre) ?? null
  );

  const renderRating = ({
    badge,
    label,
    rating,
    votes,
    href,
    missingMessage,
  }) => {
    if (rating === null) {
      badge.dataset.state = 'missing';
      badge.textContent = '—';
      badge.title = missingMessage;
      badge.setAttribute('aria-label', `${label}: no data`);
    } else {
      badge.dataset.state = 'ready';
      badge.dataset.tier = getRatingTier(rating);
      const formattedRating = rating.toFixed(CONFIG.ratingPrecision);
      badge.textContent = formattedRating;
      badge.title = [
        `${label} rating: ${formattedRating}`,
        votes ? `Votes: ${formatVotes(votes)}` : '',
      ].filter(Boolean).join('\n');
      badge.setAttribute('aria-label', `${label} rating: ${formattedRating}`);
    }

    if (href) {
      badge.href = href;
      badge.target = '_blank';
      badge.rel = 'noopener noreferrer';
    }
  };

  const renderBadgeError = (badge, label, message) => {
    badge.dataset.state = 'error';
    delete badge.dataset.tier;
    badge.textContent = '!';
    badge.title = message || `Could not load the ${label} rating`;
    badge.setAttribute('aria-label', `Could not load the ${label} rating`);
  };

  const renderKinopoiskResult = (badge, movie) => {
    renderRating({
      badge,
      label: 'KP',
      rating: movie.kpRating,
      votes: movie.kpVotes,
      href: movie.kinopoiskId
        ? `${CONFIG.urls.kinopoiskTitle}/${movie.kinopoiskId}/`
        : null,
      missingMessage: movie.kinopoiskId
        ? 'This title has no Kinopoisk rating yet'
        : 'Wikidata has no Kinopoisk ID for this IMDb title',
    });
  };

  const renderImdbResult = (badge, genreElement, imdbId, movie) => {
    renderRating({
      badge,
      label: 'IMDb',
      rating: movie.imdbRating,
      votes: movie.imdbVotes,
      href: `${CONFIG.urls.imdbTitle}/${imdbId}/`,
      missingMessage: 'This title has no IMDb rating yet',
    });
    if (genreElement) {
      genreElement.textContent = movie.genres.join(', ');
      genreElement.dataset.genres = movie.genres.join('|');
      genreElement.dataset.loaded = 'true';
      genreElement.hidden = movie.genres.length === 0;
      updateGenreFilterOptions(movie.genres);
    }
  };

  const beginRating = () => {
    state.queuedRatings += 1;
    state.pendingRatings += 1;
    updateStatus();
  };

  const finishRating = (failed = false) => {
    if (failed) state.failedRatings += 1;
    state.pendingRatings -= 1;
    updateStatus();
    scheduleFilters();
  };

  const finishImdbSubscriber = (subscriber, movie, error = null) => {
    let failed = Boolean(error);
    try {
      if (error) {
        renderBadgeError(subscriber.badge, 'IMDb', 'Could not reach IMDb');
      } else {
        renderImdbResult(
          subscriber.badge,
          subscriber.genreElement,
          subscriber.imdbId,
          movie,
        );
      }
    } catch (renderError) {
      failed = true;
      renderBadgeError(subscriber.badge, 'IMDb', 'Could not render IMDb data');
      console.error('[Bechdel ratings]', renderError);
    } finally {
      finishRating(failed);
    }
  };

  const hydrateImdbPage = async (targets) => {
    const subscribersById = new Map();

    targets.forEach(({ kpBadge, imdbId }) => {
      const badge = getImdbBadge(kpBadge);
      if (!badge) return;

      beginRating();
      const subscriber = {
        badge,
        genreElement: getGenreElement(kpBadge),
        imdbId,
      };
      const cached = readSourceCache(
        CONFIG.cachePrefixes.imdb,
        'imdbRating',
        imdbId,
      );
      if (cached) {
        finishImdbSubscriber(subscriber, cached);
        return;
      }

      const subscribers = subscribersById.get(imdbId) || [];
      subscribers.push(subscriber);
      subscribersById.set(imdbId, subscribers);
    });

    const imdbIds = [...subscribersById.keys()];
    if (!imdbIds.length) return;

    const result = await settle(fetchImdbRatings(imdbIds));
    if (result.error) console.error('[Bechdel ratings]', result.error);

    imdbIds.forEach((imdbId) => {
      const entry = result.value?.get(imdbId);
      const error = result.error || (
        !entry || entry.imdbError
          ? new Error('IMDb returned an error for this title')
          : null
      );
      const subscribers = subscribersById.get(imdbId);
      if (error) {
        subscribers.forEach((subscriber) => {
          finishImdbSubscriber(subscriber, null, error);
        });
        return;
      }

      const {
        imdbRating,
        imdbVotes,
        genres,
      } = entry;
      const data = { imdbRating, imdbVotes, genres };
      writeSourceCache(CONFIG.cachePrefixes.imdb, imdbId, data);
      subscribers.forEach((subscriber) => {
        finishImdbSubscriber(subscriber, data);
      });
    });
  };

  const finishKinopoiskSubscriber = (subscriber, movie, error = null) => {
    let failed = Boolean(error);
    try {
      if (error) {
        renderBadgeError(
          subscriber.badge,
          'KP',
          'Could not reach the Kinopoisk rating source',
        );
      } else {
        renderKinopoiskResult(subscriber.badge, movie);
      }
    } catch (renderError) {
      failed = true;
      renderBadgeError(subscriber.badge, 'KP', 'Could not render Kinopoisk data');
      console.error('[Bechdel ratings]', renderError);
    } finally {
      finishRating(failed);
    }
  };

  const hydrateKinopoiskPage = async (targets) => {
    const subscribersById = new Map();

    targets.forEach(({ kpBadge, imdbId }) => {
      beginRating();
      const subscriber = { badge: kpBadge, imdbId };
      const cached = readSourceCache(
        CONFIG.cachePrefixes.kinopoisk,
        'kpRating',
        imdbId,
      );
      if (cached) {
        finishKinopoiskSubscriber(subscriber, cached);
        return;
      }

      const subscribers = subscribersById.get(imdbId) || [];
      subscribers.push(subscriber);
      subscribersById.set(imdbId, subscribers);
    });

    const imdbIds = [...subscribersById.keys()];
    if (!imdbIds.length) return;

    const idsResult = await settle(fetchKinopoiskIds(imdbIds));
    if (idsResult.error) {
      console.error('[Bechdel ratings]', idsResult.error);
      subscribersById.forEach((subscribers) => {
        subscribers.forEach((subscriber) => {
          finishKinopoiskSubscriber(subscriber, null, idsResult.error);
        });
      });
      return;
    }

    const ratingTasks = [];
    imdbIds.forEach((imdbId) => {
      const subscribers = subscribersById.get(imdbId);
      const kinopoiskId = idsResult.value.get(imdbId) || null;
      if (!kinopoiskId) {
        const data = { kinopoiskId: null, kpRating: null, kpVotes: null };
        writeSourceCache(CONFIG.cachePrefixes.kinopoisk, imdbId, data);
        subscribers.forEach((subscriber) => {
          finishKinopoiskSubscriber(subscriber, data);
        });
        return;
      }
      ratingTasks.push({ imdbId, kinopoiskId, subscribers });
    });

    await runWorkerPool(
      ratingTasks,
      CONFIG.kinopoiskConcurrency,
      async ({ imdbId, kinopoiskId, subscribers }) => {
        const result = await settle(fetchKinopoiskRating(kinopoiskId));
        if (result.error && !isMissingDataError(result.error)) {
          console.warn('[Bechdel ratings]', imdbId, result.error);
          subscribers.forEach((subscriber) => {
            finishKinopoiskSubscriber(subscriber, null, result.error);
          });
          return;
        }

        const data = {
          kinopoiskId,
          kpRating: result.value?.kpRating ?? null,
          kpVotes: result.value?.kpVotes ?? null,
        };
        writeSourceCache(CONFIG.cachePrefixes.kinopoisk, imdbId, data);
        subscribers.forEach((subscriber) => {
          finishKinopoiskSubscriber(subscriber, data);
        });
      },
    );
  };

  const createRatingBadge = ({ className, label, imdbId = null }) => {
    const badge = document.createElement('a');
    badge.className = className;
    badge.dataset.state = 'loading';
    badge.textContent = '…';
    badge.title = `Loading ${label} rating`;
    badge.setAttribute('aria-label', badge.title);
    if (imdbId) badge.dataset.imdbId = imdbId;
    return badge;
  };

  const createMovieMetadata = (imdbId) => {
    const kpBadge = createRatingBadge({
      className: 'kp-rating',
      label: 'KP',
      imdbId,
    });
    const imdbBadge = createRatingBadge({
      className: 'imdb-rating',
      label: 'IMDb',
    });
    const genreElement = document.createElement('span');
    genreElement.className = 'movie-genres';
    genreElement.hidden = true;

    return { kpBadge, imdbBadge, genreElement };
  };

  const enhanceMovie = ({ imdbLink, titleLink }) => {
    const imdbId = extractImdbId(imdbLink?.href);
    if (!imdbId || !titleLink) return null;

    const { kpBadge, imdbBadge, genreElement } = createMovieMetadata(imdbId);
    titleLink.before(kpBadge, imdbBadge);
    titleLink.after(genreElement);
    return { kpBadge, imdbId };
  };

  const collectTargets = () => {
    const targets = [];

    document.querySelectorAll(SELECTORS.movie).forEach((row) => {
      if (row.querySelector(`${SELECTORS.kpBadge}, ${SELECTORS.imdbBadge}`)) return;
      const imdbLink = row.querySelector(SELECTORS.imdbLink);
      const titleLink = row.querySelector(SELECTORS.movieTitle);
      const target = enhanceMovie({ imdbLink, titleLink });
      if (target) targets.push(target);
    });

    document.querySelectorAll(`h2 ${SELECTORS.imdbLink}`).forEach((imdbLink) => {
      const heading = imdbLink.closest('h2');
      if (
        !heading
        || heading.querySelector(`${SELECTORS.kpBadge}, ${SELECTORS.imdbBadge}`)
      ) return;
      const target = enhanceMovie({
        imdbLink,
        titleLink: imdbLink,
      });
      if (target) targets.push(target);
    });

    return targets;
  };

  const start = () => {
    addStyles();
    const targets = collectTargets();
    addFilterPanel();
    if (!targets.length) return;
    void hydrateImdbPage(targets);
    void hydrateKinopoiskPage(targets);
  };

  GM_registerMenuCommand('Clear rating cache', () => {
    const prefixes = Object.values(CONFIG.cachePrefixes);
    GM_listValues()
      .filter((key) => prefixes.some((prefix) => key.startsWith(prefix)))
      .forEach((key) => GM_deleteValue(key));
    window.location.reload();
  });

  start();
})();
