# Scale & Fraction

A dependency-free-at-runtime PWA for exact imperial length arithmetic, drawing-scale conversion, and common architectural reference calculations. Calculation and rule boundaries use reduced rational values instead of floating-point tolerances.

## Use locally

Serve the repository over HTTP so the service worker can run:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

The expression calculator intentionally accepts one operation at a time. Examples:

- `3'-10 1/2" + 1'-1 1/2"`
- `1' / 2`
- `12" x 14"`
- `6' ÷ 2'`

A `/` is division when the expression is otherwise unambiguous, as in `1' / 2` or `12" / 3`. Whitespace around the slash is also accepted inside a standalone fractional inch such as `1 / 2"`.

## Architecture and offline behavior

- `core.js` is the single source of truth for parsing, exact fraction math, formatting, stairs, and running-slope analysis.
- `index.html` owns the interface and the 14 reference tools; it calls the shared core rather than maintaining fallback math.
- `sw.js` uses network-first requests for same-origin app resources, refreshes the offline cache when online, and falls back to the cached app shell when offline.
- `tests/` contains unit, DOM integration, repository-policy, and isolated service-worker behavior tests.

## Safety and code references

The stair and accessibility outputs are preliminary dimensional references, not code-compliance determinations. They do not evaluate every project condition, exception, occupancy rule, local amendment, or authority-having-jurisdiction requirement.

Current reference profiles:

- 2024 IRC model straight-stair dimensions
- 2024 IBC general straight-stair dimensions
- 2010 ADA Standards §405 running-slope reference

Always verify the locally adopted code and complete project conditions before construction or permitting.

## Tests

The browser application has no runtime dependencies. Development tests use a locked `jsdom` version. Install and run the complete checks with:

```sh
npm ci
npm run check
npm run test:coverage
```

`npm run check` performs JavaScript syntax checks plus all Node unit, DOM, policy, and service-worker tests. The coverage command enforces minimum coverage for `core.js`. GitHub Actions runs the same commands from a clean lockfile install on pushes and pull requests.
