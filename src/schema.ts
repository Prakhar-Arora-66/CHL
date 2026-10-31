import { z } from 'zod';

// HackerRank submission shape (from /rest/contests/{slug}/judge_submissions)
export const hrSubmissionSchema = z
  .object({
    id: z.number(),
    contest_id: z.number().optional().default(0),
    challenge_id: z.number().optional().default(0),
    hacker_id: z.number().optional().default(0),
    status: z.string().optional().default(''),
    created_at: z.number(),
    kind: z.string().optional().default(''),
    language: z.string().optional().default(''),
    hacker_username: z.string().optional().default(''),
    time_from_start: z.number().optional().default(0),
    status_code: z.number().optional().default(0),
    score: z.number().optional().default(0),
    in_contest_bounds: z.boolean().optional().default(true),
    is_preliminary_score: z.boolean().nullable().optional(),
    challenge: z
      .object({
        name: z.string().optional().default(''),
        slug: z.string().optional().default(''),
      })
      .optional()
      .default({ name: '', slug: '' }),
    testcase_message: z.array(z.string()).default([]),
  })
  .passthrough(); // keep unknown fields for raw storage

export const hrPageSchema = z.object({
  models: z.array(z.any()).transform(items => {
    const valid: HRSubmission[] = [];
    for (const item of items) {
      const parsed = hrSubmissionSchema.safeParse(item);
      if (parsed.success) {
        valid.push(parsed.data);
      } else {
        console.warn('  [WARN] Skipped malformed submission model:', parsed.error.issues);
      }
    }
    return valid;
  }),
  total: z.number(),
});

export type HRSubmission = z.infer<typeof hrSubmissionSchema>;
export type HRPage = { models: HRSubmission[]; total: number };

// ---

export type Verdict = 'AC' | 'WA' | 'TLE' | 'RTE' | 'CE' | 'MLE' | 'PENDING' | 'OTHER';

export interface Submission {
  id: number;
  contestId: number;
  challengeId: number;
  hackerId: number;
  username: string;
  problem: string;
  problemSlug: string;
  verdict: Verdict;
  rawStatus: string;
  score: number;
  submittedAt: number;
  relativeSeconds: number;
  inContestBounds?: boolean;
  language: string;
  testsTotal: number;
  testsPassed: number;
  firstFailedTest: number | null;
}

const VERDICT_MAP: Record<string, Verdict> = {
  'Accepted': 'AC',
  'Wrong Answer': 'WA',
  'Terminated due to timeout': 'TLE',
  'Runtime Error': 'RTE',
  'Compilation error': 'CE',
  'Segfault': 'RTE',
  'Memory Limit Exceeded': 'MLE',
  'Processing': 'PENDING',
  'Queued': 'PENDING',
};

export function normalize(raw: HRSubmission, contestStart: number): Submission {
  const tc = raw.testcase_message || [];
  const passed = tc.filter(t => t === 'Success').length;
  const firstFail = tc.findIndex(t => t !== 'Success');

  return {
    id: raw.id,
    contestId: raw.contest_id,
    challengeId: raw.challenge_id,
    hackerId: raw.hacker_id,
    username: raw.hacker_username,
    problem: (raw.challenge?.name || 'Unknown').trim(),
    problemSlug: raw.challenge?.slug || '',
    verdict: VERDICT_MAP[raw.status] ?? 'OTHER',
    rawStatus: raw.status,
    score: raw.score,
    submittedAt: raw.created_at,
    relativeSeconds: contestStart > 0 ? raw.created_at - contestStart : 0,
    inContestBounds: raw.in_contest_bounds ?? true,
    language: raw.language,
    testsTotal: tc.length,
    testsPassed: passed,
    firstFailedTest: firstFail >= 0 ? firstFail + 1 : null,
  };
}

export function deriveContestStart(submissions: HRSubmission[]): number {
  if (!submissions.length) return 0;

  // created_at - (time_from_start * 60) should converge to the same epoch
  const starts = submissions.map(s => Math.round(s.created_at - s.time_from_start * 60));
  const median = starts.sort((a, b) => a - b)[Math.floor(starts.length / 2)];
  return median;
}
