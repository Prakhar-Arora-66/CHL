# CHL — Contest HackerRank Leaderboard

Custom real-time leaderboard for HackerRank contests with admin controls, registration mapping, and data export.

## Features

- **Live scoreboard** — auto-refreshes from HackerRank every 5 minutes
- **Two ranking modes** — Score + Last-AC tiebreak, or Score + ICPC-style tiebreak
- **Registration mapping** — maps HackerRank handles to real names via CSV
- **Admin panel** — configure scoring, manage DQs, test cookie connectivity
- **Data export** — download standings as JSON or CSV with full details
- **Dark/light theme**

## Quick Start

```bash
git clone <repo-url> && cd CHL
npm install
cp .env.example .env    # edit with your admin password
npm run dev             # http://localhost:3000
```

Set the contest slug and HackerRank cookie via the Admin panel (`/admin`).

## Configuration

| Env Variable | Default | Description |
|---|---|---|
| `ADMIN_PASSWORD` | `admin` | Password for admin panel |
| `PORT` | `3000` | Server port |
| `HR_COOKIE` | — | HackerRank session cookie (can also be set via admin) |
| `HR_CONTEST_SLUG` | — | Contest slug from URL (can also be set via admin) |

## Getting the HackerRank Cookie

1. Log in to HackerRank in your browser
2. Open DevTools (F12) → **Network** tab
3. Visit the contest page and click any request to `hackerrank.com`
4. Copy the full `Cookie` header value from the request headers
5. Paste it in Admin → Connection → Cookie field

The cookie must include `_hrank_session`. It expires periodically — the admin panel shows connection status.

## Registration CSV

Place CSV files in `Registration/` with these columns:

```
display_name,enrollment_no,branch,batch,hackerrank_handle,CAMPUS,YEAR OF STUDY
```

The server loads them on startup. Use the **Reload Registrations** button in admin to reload without restart.

## Deployment

### Build

```bash
npm run build   # compiles TypeScript to dist/
npm start       # runs the production server
```

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ dist/
COPY public/ public/
COPY Registration/ Registration/
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### Hosting

This is a **stateful Node.js server** (in-memory cache, periodic background fetching). Use platforms that support persistent processes:

- [Railway](https://railway.app) — recommended, easy Node.js deploy
- [Render](https://render.com) — free tier available
- [Fly.io](https://fly.io) — global edge deployment
- Any VPS with Node.js

> **Note:** Pure serverless platforms (Vercel Serverless Functions, AWS Lambda) are not suitable since the server relies on in-memory state and `setInterval` for background data refresh.

## Project Structure

```
src/
  server.ts     — Express server, API routes, admin auth
  client.ts     — HackerRank API client with pagination and retry
  schema.ts     — Zod schemas, submission normalization
  scorer.ts     — Scoring engine (score mode, ICPC mode)
public/
  index.html    — Leaderboard page
  app.js        — Leaderboard frontend logic
  admin.html    — Admin panel page
  admin.js      — Admin panel frontend logic
Registration/   — CSV files with participant data
data/           — Fetched submissions cache (gitignored)
```

## License

MIT
