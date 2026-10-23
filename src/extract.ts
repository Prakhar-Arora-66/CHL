import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { HRClient } from './client.js';
import {
  hrPageSchema,
  normalize,
  deriveContestStart,
  type HRSubmission,
  type Submission,
} from './schema.js';

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function fmt(epoch: number) {
  return new Date(epoch * 1000).toISOString();
}

function fmtDur(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// ---

async function fromApi(): Promise<{ raw: HRSubmission[]; total: number; slug: string }> {
  const slug = process.env.HR_CONTEST_SLUG!;
  const cookie = process.env.HR_COOKIE!;

  console.log(`fetching: ${slug}\n`);

  const client = new HRClient({
    contestSlug: slug,
    cookie,
    pageSize: Number(process.env.HR_PAGE_SIZE) || 50,
    delayMs: Number(process.env.HR_DELAY_MS) || 1500,
  });

  const { submissions, total } = await client.fetchAll({
    onProgress(n, t) {
      process.stdout.write(`\r  ${n} / ${t} submissions`);
    },
  });
  console.log('\n');

  // try to grab challenge metadata too
  try {
    const challenges = await client.fetchChallenges();
    if (challenges.length) {
      mkdirSync('data', { recursive: true });
      writeFileSync(`data/${slug}_challenges.json`, JSON.stringify(challenges, null, 2));
      console.log(`saved ${challenges.length} challenge(s) to data/${slug}_challenges.json`);
    }
  } catch {
    // non-fatal
  }

  return { raw: submissions, total, slug };
}

function fromFile(path: string): { raw: HRSubmission[]; total: number; slug: string } {
  console.log(`importing: ${path}\n`);
  const data = JSON.parse(readFileSync(path, 'utf-8'));

  // handle both single-page and array-of-pages
  let raw: HRSubmission[];
  let total: number;

  if (Array.isArray(data)) {
    // array of page objects
    raw = [];
    total = 0;
    for (const page of data) {
      const parsed = hrPageSchema.parse(page);
      raw.push(...parsed.models);
      total = parsed.total;
    }
  } else {
    const parsed = hrPageSchema.parse(data);
    raw = parsed.models;
    total = parsed.total;
  }

  // dedupe by id in case pages overlap
  const seen = new Set<number>();
  raw = raw.filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  const slug = raw[0]?.contest_id?.toString() ?? 'unknown';
  return { raw, total, slug };
}

// ---

async function main() {
  const file = process.argv[2];

  let raw: HRSubmission[];
  let total: number;
  let slug: string;

  if (file) {
    ({ raw, total, slug } = fromFile(file));
  } else {
    const envSlug = process.env.HR_CONTEST_SLUG;
    const envCookie = process.env.HR_COOKIE;
    if (!envSlug || !envCookie) {
      console.error('usage:');
      console.error('  npx tsx src/extract.ts                   # fetch from HR (needs .env)');
      console.error('  npx tsx src/extract.ts fixtures/sample.json  # import from file');
      process.exit(1);
    }
    ({ raw, total, slug } = await fromApi());
  }

  console.log(`${raw.length} submissions loaded (HR reports total: ${total})`);
  if (raw.length !== total && !file) {
    console.warn(`  WARNING: count mismatch — expected ${total}, got ${raw.length}`);
  }

  // derive or read contest start
  let contestStart = Number(process.env.HR_CONTEST_START) || 0;
  if (!contestStart) {
    contestStart = deriveContestStart(raw);
    console.log(`contest start (derived): ${fmt(contestStart)}`);
  } else {
    console.log(`contest start (config):  ${fmt(contestStart)}`);
  }

  // normalize
  const subs = raw.map(s => normalize(s, contestStart));

  // save outputs
  mkdirSync('data', { recursive: true });
  const stamp = ts();

  writeFileSync(`data/${slug}_raw_${stamp}.json`, JSON.stringify({ models: raw, total }, null, 2));
  writeFileSync(`data/${slug}_normalized_${stamp}.json`, JSON.stringify(subs, null, 2));
  console.log(`\nsaved to data/${slug}_raw_${stamp}.json`);
  console.log(`saved to data/${slug}_normalized_${stamp}.json`);

  // stats
  printStats(subs, contestStart);
}

function printStats(subs: Submission[], contestStart: number) {
  const users = new Map<number, string>();
  const problems = new Map<string, { total: number; ac: number; scores: number[] }>();
  const verdicts: Record<string, number> = {};
  const languages: Record<string, number> = {};

  for (const s of subs) {
    users.set(s.hackerId, s.username);

    const p = problems.get(s.problemSlug) ?? { total: 0, ac: 0, scores: [] };
    p.total++;
    if (s.verdict === 'AC') p.ac++;
    p.scores.push(s.score);
    problems.set(s.problemSlug, p);

    verdicts[s.verdict] = (verdicts[s.verdict] ?? 0) + 1;
    languages[s.language] = (languages[s.language] ?? 0) + 1;
  }

  const earliest = Math.min(...subs.map(s => s.submittedAt));
  const latest = Math.max(...subs.map(s => s.submittedAt));

  console.log('\n--- summary ---');
  console.log(`participants : ${users.size}`);
  console.log(`problems     : ${problems.size}`);
  console.log(`time span    : ${fmt(earliest)} → ${fmt(latest)} (${fmtDur(latest - earliest)})`);
  console.log(`verdicts     : ${Object.entries(verdicts).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  console.log(`languages    : ${Object.entries(languages).map(([k, v]) => `${k}=${v}`).join('  ')}`);

  console.log('\nproblems:');
  for (const [slug, p] of problems) {
    const maxScore = Math.max(...p.scores);
    const rate = p.total > 0 ? ((p.ac / p.total) * 100).toFixed(0) : '0';
    console.log(`  ${slug}`);
    console.log(`    ${p.total} subs, ${p.ac} AC (${rate}%), max score: ${maxScore}`);
  }

  console.log('\nparticipants:');
  for (const [id, name] of users) {
    const userSubs = subs.filter(s => s.hackerId === id);
    const solved = new Set(userSubs.filter(s => s.verdict === 'AC').map(s => s.problemSlug)).size;
    console.log(`  ${name} (${id}): ${userSubs.length} subs, ${solved} solved`);
  }
}

main().catch(err => {
  console.error('\nextraction failed:', err.message);
  process.exit(1);
});
