# FTP System — Browser / GitHub Pages Edition

A 100% client-side Funds Transfer Pricing (FTP) and Asset/Liability Management (ALM) web application rewritten in **Vanilla ES Modules + HTML/CSS + Chart.js + SheetJS + PptxGenJS** so it can be hosted directly on **GitHub Pages** with zero backend server or database.

## Features ported
- **Exact fixed-point Decimal math** (`js/decimal.js`, BigInt-backed `ROUND_HALF_UP`) matching the Python `Decimal` conventions.
- **Matched Maturity & Pooled FTP Engine** (`js/engine.js`):
  - 30/360 tenor mapping (`term_months * 30`), linear interpolation, flat extrapolation.
  - Rate lock at origination against immutable `(name, effective_date)` curve versions.
  - Monthly cash flow schedules (amortizing, bullet, interest-only) with CPR → SMM prepayment for loans.
  - ALM Repricing Gap ladder, Historical Margin Compression analysis, and 7-scenario + custom Yield Curve Stress Testing.
- **ALCO Reporting & Exports** (`js/alco.js`, `js/exports.js`):
  - Executive Summary & ALCO Pack views with reconciliation checks, variance bridge, concentration HHI, pricing outliers, and exceptions.
  - Client-side **CSV**, **14-sheet Excel (.xlsx)** via SheetJS, **ALCO & Board PowerPoint decks (.pptx)** via PptxGenJS, and printable HTML/PDF reports.
- **CSV / Excel Importer** (`js/importer.js`):
  - Client-side CSV & XLSX parsing, sheet selection, interactive column mapping, strict row-level validation, and duplicate `source_id` protection.
- **Isolated Sample Bank & Browser Persistence** (`js/store.js`, `js/demo.js`):
  - Persists locally in `IndexedDB` (with `localStorage` fallback), keeping Sample Bank and Live Bank completely separate, plus JSON backup/restore.

## Running locally
Because ES modules (`<script type="module">`) require HTTP(S), serve the folder with any static server:

```bash
python -m http.server 8080
# then open http://localhost:8080
```

## Deploying to GitHub Pages
1. Push the contents of `ftp_system_pages` to a GitHub repository (e.g., `main` branch root, or `/docs`).
2. Enable **Settings → Pages → Deploy from a branch** (`main` / root).
3. No build step or backend configuration is required.

## Differences vs. the FastAPI/PostgreSQL server edition
- **Storage & Auth:** Data stays in the user's browser (`IndexedDB`) rather than a multi-user PostgreSQL server; Basic Auth (`AUTH_REQUIRED`) is not applicable to a static site.
- **U.S. Treasury Daily Curve Fetch:** `home.treasury.gov` does not send CORS headers to browser `fetch()` requests, so the Yield Curve page lets you upload or paste the Treasury CSV file directly (in addition to using the built-in illustrative Treasury curve).

## Running the verification tests
```bash
node --test tests/known_answers.test.mjs
```
