import 'dotenv/config';
import express from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';
import { HRClient } from './client.js';
import {
  hrPageSchema,
  normalize,
  deriveContestStart,
  type HRSubmission,
  type Submission,
} from './schema.js';
import { computeStandings, type ScorerConfig, type Scoreboard } from './scorer.js';

const PORT = Number(process.env.PORT) || 3000;
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

const DATA_DIR = path.resolve('data');
const CONFIG_PATH = path.join(DATA_DIR, 'board_config.json');
const REG_DIR = path.resolve('Registration');

mkdirSync(DATA_DIR, { recursive: true });

// --- Registration data ---

interface RegistrationEntry {
  displayName: string;
  enrollmentNo: string;
  branch: string;
  batch: string;
  campus: string;
  yearOfStudy: string;
}

function loadRegistrations(): Map<string, RegistrationEntry> {
  const map = new Map<string, RegistrationEntry>();
  if (!existsSync(REG_DIR)) return map;

  const files = readdirSync(REG_DIR).filter(f => f.toLowerCase().endsWith('.csv'));
  for (const file of files) {
    const content = readFileSync(path.join(REG_DIR, file), 'utf-8');
    const lines = content.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
    if (lines.length < 2) continue;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 5) continue;

      const handle = cols[4].trim();
      if (!handle) continue;
      map.set(handle.toLowerCase(), {
        displayName: cols[0].trim(),
        enrollmentNo: cols[1].trim(),
        branch: cols[2].trim(),
        batch: cols[3].trim(),
        campus: cols[5]?.trim() || '',
        yearOfStudy: cols[6]?.trim() || '',
      });
    }
  }
  console.log(`  loaded ${map.size} registrations from ${files.length} CSV file(s)`);
  return map;
}

// ---

let cachedSubmissions: Submission[] = [];
let cachedScoreboard: Scoreboard | null = null;
let contestSlug = process.env.HR_CONTEST_SLUG ?? '';
let contestStart = Number(process.env.HR_CONTEST_START) || 0;
let lastFetchTime = 0;
let fetchInProgress = false;
let registrations = loadRegistrations();

function loadConfig(): ScorerConfig {
  const defaults: ScorerConfig = {
    penaltyMinutes: 20,
    scoringMode: 'score',
    contestStartEpoch: contestStart,
    contestDurationMinutes: 0,
    disqualified: [],
    frozen: false,
    partialMarking: true,
  };

  if (existsSync(CONFIG_PATH)) {
    try {
      const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      return { ...defaults, ...saved };
    } catch {
      // fall through
    }
  }
  return defaults;
}

function saveConfig(cfg: ScorerConfig) {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function loadLatestNormalized(): Submission[] | null {
  if (!existsSync(DATA_DIR)) return null;
  const cfg = loadConfig();
  const slug = cfg.contestSlug || contestSlug;
  if (!slug) return null;
  const files = readdirSync(DATA_DIR)
    .filter(f => f.startsWith(`${slug}_normalized_`) && f.endsWith('.json'))
    .sort();
  if (!files.length) return null;
  return JSON.parse(readFileSync(path.join(DATA_DIR, files[files.length - 1]), 'utf-8'));
}

async function fetchFresh(): Promise<Submission[]> {
  const cfg = loadConfig();
  const cookie = cfg.cookie || process.env.HR_COOKIE;
  const slug = cfg.contestSlug || contestSlug;

  if (!cookie || !slug) {
    throw new Error('HR_COOKIE and HR_CONTEST_SLUG must be set in .env or via Admin settings');
  }

  const client = new HRClient({
    contestSlug: slug,
    cookie,
    pageSize: Number(process.env.HR_PAGE_SIZE) || 50,
    delayMs: Number(process.env.HR_DELAY_MS) || 1500,
  });

  const { submissions: raw } = await client.fetchAll({
    onProgress(n, t) {
      process.stdout.write(`\r  fetching: ${n}/${t}`);
    },
  });
  console.log('');

  // try to grab challenge metadata too
  try {
    const challenges = await client.fetchChallenges();
    if (challenges.length) {
      writeFileSync(path.join(DATA_DIR, `${slug}_challenges.json`), JSON.stringify(challenges, null, 2));
    }
  } catch { /* non-fatal */ }

  if (!contestStart) {
    contestStart = deriveContestStart(raw);
  }

  const subs = raw.map(s => normalize(s, contestStart));

  // save timestamped copy
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  writeFileSync(
    path.join(DATA_DIR, `${slug}_raw_${stamp}.json`),
    JSON.stringify({ models: raw, total: raw.length }, null, 2),
  );
  writeFileSync(
    path.join(DATA_DIR, `${slug}_normalized_${stamp}.json`),
    JSON.stringify(subs, null, 2),
  );

  return subs;
}

function loadChallengeData(): { slug: string; name: string; max_score: number }[] {
  const slug = loadConfig().contestSlug || contestSlug;
  const fp = path.join(DATA_DIR, `${slug}_challenges.json`);
  if (!existsSync(fp)) return [];
  try {
    const raw = JSON.parse(readFileSync(fp, 'utf-8'));
    return raw.map((c: any) => ({ slug: c.slug, name: c.name, max_score: c.max_score }));
  } catch {
    return [];
  }
}

function rebuildScoreboard() {
  const fromDisk = loadLatestNormalized();
  if (fromDisk && fromDisk.length) {
    cachedSubmissions = fromDisk;
  }
  if (!cachedSubmissions.length) return;
  const cfg = loadConfig();
  if (contestStart && !cfg.contestStartEpoch) {
    cfg.contestStartEpoch = contestStart;
    saveConfig(cfg);
  }
  const challenges = loadChallengeData();
  const slug = cfg.contestSlug || contestSlug;
  cachedScoreboard = computeStandings(cachedSubmissions, cfg, slug, challenges);
}

async function refreshData() {
  if (fetchInProgress) return;
  fetchInProgress = true;
  try {
    console.log(`[${new Date().toLocaleTimeString()}] refreshing data...`);
    cachedSubmissions = await fetchFresh();
    lastFetchTime = Date.now();
    rebuildScoreboard();
    console.log(`[${new Date().toLocaleTimeString()}] refresh done — ${cachedSubmissions.length} submissions`);
  } catch (err: any) {
    console.error(`refresh failed: ${err.message}`);
  } finally {
    fetchInProgress = false;
  }
}

// --- Build registration lookup for API ---

function buildRegistrationMap(): Record<string, RegistrationEntry & { registered: true }> {
  const out: Record<string, RegistrationEntry & { registered: true }> = {};
  for (const [handle, reg] of registrations) {
    out[handle] = { ...reg, registered: true };
  }
  return out;
}

// --- Export helpers ---

function buildExportRows() {
  if (!cachedScoreboard) return [];
  const cfg = loadConfig();
  return cachedScoreboard.standings.map(s => {
    const reg = registrations.get(s.username.toLowerCase());
    return {
      rank: s.rank > 0 ? s.rank : null,
      displayName: reg?.displayName || s.username,
      hackerRankHandle: s.username,
      registered: !!reg,
      enrollmentNo: reg?.enrollmentNo || '',
      branch: reg?.branch || '',
      batch: reg?.batch || '',
      campus: reg?.campus || '',
      yearOfStudy: reg?.yearOfStudy || '',
      score: s.totalScore,
      solved: s.solved,
      penalty: s.penalty,
      disqualified: s.disqualified,
      problems: s.problems.map(p => ({
        slug: p.slug,
        name: p.name,
        maxScore: p.maxScore,
        bestScore: p.bestScore,
        solved: p.solved,
        attempts: p.attempts,
        wrongAttempts: p.wrongAttempts,
        solveTimeMinutes: p.solveTimeMinutes,
      })),
    };
  });
}

function buildExportCsv(): string {
  if (!cachedScoreboard) return '';
  const rows = buildExportRows();
  const probs = cachedScoreboard.problems;

  // header
  const hdr = [
    'Rank', 'Display Name', 'HR Handle', 'Registered', 'Enrollment', 'Branch',
    'Batch', 'Campus', 'Year', 'Score', 'Solved', 'Penalty', 'Disqualified',
    ...probs.map(p => `${p.name} (${p.maxScore})`),
  ];
  const lines = [hdr.map(csvEscape).join(',')];

  for (const r of rows) {
    const row = [
      r.rank ?? 'DQ',
      r.displayName,
      r.hackerRankHandle,
      r.registered ? 'Yes' : 'No',
      r.enrollmentNo,
      r.branch,
      r.batch,
      r.campus,
      r.yearOfStudy,
      r.score,
      r.solved,
      r.penalty,
      r.disqualified ? 'Yes' : 'No',
      ...r.problems.map(p => p.solved ? `${p.bestScore} (${p.solveTimeMinutes}m, ${p.wrongAttempts}WA)` : p.attempts > 0 ? `0 (${p.attempts} tries)` : ''),
    ];
    lines.push(row.map(csvEscape).join(','));
  }
  return lines.join('\n');
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ---

const app = express();
app.use(express.json());
app.use(express.static(path.resolve('public')));

// API: get scoreboard
app.get('/api/scoreboard', (_req, res) => {
  if (!cachedScoreboard) {
    return res.status(503).json({ error: 'scoreboard not ready yet' });
  }
  res.json({
    ...cachedScoreboard,
    registrations: buildRegistrationMap(),
    lastFetchTime,
    nextRefreshTime: lastFetchTime + REFRESH_INTERVAL,
    serverTime: Date.now(),
  });
});

// API: get raw config
app.get('/api/config', (_req, res) => {
  const cfg = loadConfig();
  // Don't leak cookie to unauthenticated users
  res.json({ ...cfg, cookie: cfg.cookie ? '***' : '' });
});

// Middleware for admin auth
function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const pass = req.headers['x-admin-password'];
  const expected = process.env.ADMIN_PASSWORD || 'admin';
  if (pass === expected) {
    next();
  } else {
    res.status(401).json({ error: 'unauthorized' });
  }
}

// API: admin login
app.post('/api/login', (req, res) => {
  const pass = req.body.password;
  const expected = process.env.ADMIN_PASSWORD || 'admin';
  if (pass === expected) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'unauthorized' });
  }
});

// API: update config
app.post('/api/config', requireAdmin, (req, res) => {
  const current = loadConfig();
  const body = req.body;

  if (body.penaltyMinutes !== undefined) current.penaltyMinutes = Number(body.penaltyMinutes);
  if (body.scoringMode !== undefined) current.scoringMode = body.scoringMode;
  if (body.contestDurationMinutes !== undefined) current.contestDurationMinutes = Number(body.contestDurationMinutes);
  if (body.disqualified !== undefined) current.disqualified = body.disqualified;
  if (body.frozen !== undefined) current.frozen = !!body.frozen;
  if (body.partialMarking !== undefined) current.partialMarking = !!body.partialMarking;

  let resetData = false;
  if (body.cookie !== undefined && body.cookie !== '***') current.cookie = body.cookie;
  if (body.contestSlug !== undefined && body.contestSlug !== current.contestSlug) {
    current.contestSlug = body.contestSlug;
    current.contestStartEpoch = 0;
    resetData = true;
  }

  saveConfig(current);

  if (resetData) {
    contestStart = 0;
    cachedSubmissions = [];
    cachedScoreboard = null;
    fetchInProgress = false;
    refreshData();
  } else {
    rebuildScoreboard();
  }
  res.json({ ok: true, config: current });
});

// API: disqualify a user
app.post('/api/disqualify', requireAdmin, (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });

  const cfg = loadConfig();
  const lower = username.toLowerCase();
  if (!cfg.disqualified.map((u: string) => u.toLowerCase()).includes(lower)) {
    cfg.disqualified.push(username);
  }
  saveConfig(cfg);
  rebuildScoreboard();
  res.json({ ok: true, disqualified: cfg.disqualified });
});

// API: reinstate a user
app.post('/api/reinstate', requireAdmin, (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });

  const cfg = loadConfig();
  cfg.disqualified = cfg.disqualified.filter(
    (u: string) => u.toLowerCase() !== username.toLowerCase(),
  );
  saveConfig(cfg);
  rebuildScoreboard();
  res.json({ ok: true, disqualified: cfg.disqualified });
});

// API: force refresh
app.post('/api/refresh', requireAdmin, async (_req, res) => {
  if (fetchInProgress) {
    return res.json({ ok: false, message: 'fetch already in progress' });
  }
  refreshData();
  res.json({ ok: true, message: 'refresh started' });
});

// API: status
app.get('/api/status', (_req, res) => {
  const cfg = loadConfig();
  res.json({
    contestSlug: cfg.contestSlug || contestSlug,
    lastFetchTime,
    fetchInProgress,
    submissionCount: cachedSubmissions.length,
    refreshInterval: REFRESH_INTERVAL,
  });
});

// API: connectivity check — test if cookie is valid
app.get('/api/connectivity', requireAdmin, async (_req: express.Request, res: express.Response) => {
  const cfg = loadConfig();
  const cookie = cfg.cookie || process.env.HR_COOKIE;
  const slug = cfg.contestSlug || contestSlug;

  if (!cookie) {
    return res.json({ status: 'no_cookie', message: 'No cookie configured' });
  }
  if (!slug) {
    return res.json({ status: 'no_slug', message: 'No contest slug configured' });
  }

  try {
    const client = new HRClient({ contestSlug: slug, cookie, pageSize: 1, delayMs: 0 });
    const page = await client.fetchPage(0);
    res.json({ status: 'connected', total: page.total, message: `Connected — ${page.total} submissions found` });
  } catch (err: any) {
    res.json({ status: 'error', message: err.message });
  }
});

// API: export standings as JSON download
app.get('/api/export/json', requireAdmin, (_req, res) => {
  if (!cachedScoreboard) return res.status(503).json({ error: 'no data' });
  const rows = buildExportRows();
  const slug = cachedScoreboard.contestSlug || 'standings';
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}_standings.json"`);
  res.send(JSON.stringify(rows, null, 2));
});

// API: export standings as CSV download
app.get('/api/export/csv', requireAdmin, (_req, res) => {
  if (!cachedScoreboard) return res.status(503).json({ error: 'no data' });
  const csv = buildExportCsv();
  const slug = cachedScoreboard.contestSlug || 'standings';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}_standings.csv"`);
  res.send(csv);
});

// API: reload registration data
app.post('/api/reload-registrations', requireAdmin, (_req, res) => {
  registrations = loadRegistrations();
  rebuildScoreboard();
  res.json({ ok: true, count: registrations.size });
});

// Admin page route
app.get('/admin', (_req: express.Request, res: express.Response) => {
  res.sendFile(path.resolve('public/admin.html'));
});

// ---

async function boot() {
  // try loading from disk first
  const fromDisk = loadLatestNormalized();
  if (fromDisk && fromDisk.length) {
    cachedSubmissions = fromDisk;

    if (!contestStart && cachedSubmissions.length) {
      // approximate from data
      const earliest = Math.min(...cachedSubmissions.map(s => s.submittedAt));
      const relMin = cachedSubmissions.find(s => s.submittedAt === earliest)?.relativeSeconds ?? 0;
      contestStart = earliest - relMin;
    }

    rebuildScoreboard();
    console.log(`loaded ${cachedSubmissions.length} submissions from disk`);
  }

  app.listen(PORT, () => {
    console.log(`\n  leaderboard running at http://localhost:${PORT}\n`);
  });

  // start background refresh
  const cfg = loadConfig();
  if (cfg.cookie || process.env.HR_COOKIE) {
    refreshData();
    setInterval(refreshData, REFRESH_INTERVAL);
  } else {
    console.log('  no HR_COOKIE set — serving from disk only, no auto-refresh');
  }
}

boot();
