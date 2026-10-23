# CHL — Contest HackerRank Leaderboard

Real-time contest leaderboard for HackerRank with live updates, admin controls, participant registration mapping, and data export.

## Features

- **Live scoreboard** — automatically refreshes from HackerRank periodically
- **Two ranking modes** — Score + Last-AC tiebreak, or ICPC penalty tiebreak
- **Registration mapping** — upload registration CSV directly via the Admin panel to map HackerRank handles to student names & college details
- **Dedicated Admin panel (`/admin`)** — configure contest slug, session cookies, scoring mode, penalty per wrong submission, tiebreakers, freeze options, and disqualifications
- **Data export** — download full standings with registration details as CSV or JSON
- **Dark & Light mode** — defaults to sleek dark mode with instant theme toggle

## Quick Start

```bash
git clone <repo-url> && cd CHL
npm install
cp .env.example .env    # configure your ADMIN_PASSWORD
npm run dev             # runs on http://localhost:3000
```

Access the admin dashboard at `/admin` (or click the settings gear on the leaderboard) to configure your contest slug, cookie, and upload participant registrations.

## Configuration

Set via `.env` or directly in the `/admin` UI:

| Env Variable | Default | Description |
|---|---|---|
| `ADMIN_PASSWORD` | `admin` | Password to access the `/admin` dashboard |
| `PORT` | `3000` | Server port |
| `HR_COOKIE` | — | HackerRank session cookie (can also be updated from `/admin`) |
| `HR_CONTEST_SLUG` | — | Contest slug from URL (can also be updated from `/admin`) |

## Getting the HackerRank Cookie

1. Log in to HackerRank in your browser.
2. Open DevTools (F12) → **Network** tab.
3. Open any request to `hackerrank.com`.
4. Copy the full `Cookie` header value (must contain `_hrank_session`).
5. Paste it in Admin (`/admin`) → **Connection** → **Cookie**.

## Participant Registrations

Participant CSV can be uploaded directly in the Admin Panel (`/admin` → **Data & Export** → **Upload CSV**). 

Expected columns:
```
display_name,enrollment_no,branch,batch,hackerrank_handle,CAMPUS,YEAR OF STUDY
```

Uploaded registrations are saved to `data/registrations.csv` and persist across restarts.

## Production

```bash
npm run build   # compiles TypeScript to dist/
npm start       # runs production server
```

## Project Structure

```
src/
  server.ts     — Express server, API routes, admin auth, CSV storage, background sync
  client.ts     — HackerRank API client with pagination and retry logic
  schema.ts     — Zod schemas and submission normalization
  scorer.ts     — Scoring engine (Score mode & ICPC mode)
public/
  index.html    — Leaderboard page
  style.css     — Leaderboard styling (dark/light themes)
  app.js        — Leaderboard frontend logic
  admin.html    — Admin panel page
  admin.css     — Admin panel styling
  admin.js      — Admin panel frontend logic & CSV upload
  knuth-logo.webp — Logo asset
data/           — Cached submissions and saved registrations (gitignored)
```

## License

MIT
