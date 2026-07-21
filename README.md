# Scale & Fraction

A dependency-free PWA for imperial length arithmetic, drawing-scale conversion, and common architectural reference calculations.

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

A spaced `/` is division; an unspaced `/` remains a fraction separator.

## Safety and code references

The stair and accessibility outputs are preliminary dimensional references, not code-compliance determinations. They do not evaluate every project condition, exception, occupancy rule, local amendment, or authority-having-jurisdiction requirement.

Current reference profiles:

- 2024 IRC model straight-stair dimensions
- 2024 IBC general straight-stair dimensions
- 2010 ADA Standards §405 running-slope reference

Always verify the locally adopted code and complete project conditions before construction or permitting.

## Tests

The project has no runtime dependencies. Run the Node built-in test suite with:

```sh
npm test
```

GitHub Actions runs the same suite and JavaScript syntax checks on pushes and pull requests.
