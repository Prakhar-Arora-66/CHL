import type { Submission, Verdict } from './schema.js';

export interface ScorerConfig {
  penaltyMinutes: number;         // minutes per wrong attempt before AC
  scoringMode: 'score' | 'icpc'; // score = sum of max scores; icpc = problems solved + penalty
  contestStartEpoch: number;
  contestDurationMinutes: number; // 0 = no limit
  disqualified: string[];         // usernames to exclude
  frozen: boolean;                // if true, freeze standings at last update
  partialMarking: boolean;        // if false, partial points are treated as 0
  cookie?: string;                // dynamic cookie override
  contestSlug?: string;           // dynamic contest slug override
}

export interface ProblemResult {
  slug: string;
  name: string;
  maxScore: number;
  solved: boolean;
  attempts: number;           // total attempts
  wrongAttempts: number;      // wrong attempts before AC
  penaltyMinutes: number;     // time-of-AC + wrongAttempts * penaltyPerWrong
  solveTimeMinutes: number;   // minutes from contest start to AC, -1 if not solved
  bestScore: number;          // highest score across attempts
  firstAcTime: number;        // epoch of first AC, 0 if never
}

export interface Standing {
  rank: number;
  username: string;
  hackerId: number;
  solved: number;
  totalScore: number;
  penalty: number;            // total penalty minutes (icpc mode)
  problems: ProblemResult[];
  lastAcTime: number;         // epoch of last AC, for tiebreaking
  disqualified: boolean;
}

export interface Scoreboard {
  standings: Standing[];
  problems: { slug: string; name: string; maxScore: number }[];
  config: ScorerConfig;
  updatedAt: number;
  contestSlug: string;
}

function calcSubmissionScore(
  s: Submission,
  maxScore: number,
  partialMarking: boolean,
): number {
  if (s.verdict === 'AC') {
    return maxScore > 0 ? maxScore : (s.score > 0 ? s.score : 1);
  }
  if (!partialMarking) {
    return 0;
  }
  // When partial marking is enabled:
  if (s.score > 1 || (maxScore <= 1 && s.score > 0)) {
    // HackerRank already provided explicit points (e.g. 94.74, 133.33)
    return s.score;
  }
  if (s.score > 0 && maxScore > 1) {
    // HackerRank provided normalized score between 0 and 1
    return Number((s.score * maxScore).toFixed(2));
  }
  if (s.testsTotal > 0 && s.testsPassed > 0 && maxScore > 0) {
    // HackerRank recorded score 0 (e.g. binary scoring contest), compute from test cases passed
    return Number(((s.testsPassed / s.testsTotal) * maxScore).toFixed(2));
  }
  return 0;
}

// build problem results for one user
function buildProblemResults(
  userSubs: Submission[],
  problemList: { slug: string; name: string; maxScore: number }[],
  contestStart: number,
  penaltyMinutes: number,
  partialMarking: boolean,
): ProblemResult[] {
  return problemList.map(prob => {
    const subs = userSubs
      .filter(s => s.problemSlug === prob.slug)
      .sort((a, b) => a.submittedAt - b.submittedAt);

    if (!subs.length) {
      return {
        slug: prob.slug,
        name: prob.name,
        maxScore: prob.maxScore,
        solved: false,
        attempts: 0,
        wrongAttempts: 0,
        penaltyMinutes: 0,
        solveTimeMinutes: -1,
        bestScore: 0,
        firstAcTime: 0,
      };
    }

    let solved = false;
    let wrongBefore = 0;
    let firstAcTime = 0;
    let solveTimeMin = -1;
    let bestScore = 0;

    for (const s of subs) {
      const sScore = calcSubmissionScore(s, prob.maxScore, partialMarking);
      bestScore = Math.max(bestScore, sScore);
      if (!solved && s.verdict === 'AC') {
        solved = true;
        firstAcTime = s.submittedAt;
        solveTimeMin = Math.floor((s.submittedAt - contestStart) / 60);
      } else if (!solved) {
        // count non-AC, non-CE, non-PENDING as wrong attempt
        if (s.verdict !== 'CE' && s.verdict !== 'PENDING') {
          wrongBefore++;
        }
      }
    }

    const pen = solved
      ? solveTimeMin + wrongBefore * penaltyMinutes
      : 0;

    return {
      slug: prob.slug,
      name: prob.name,
      maxScore: prob.maxScore,
      solved,
      attempts: subs.length,
      wrongAttempts: wrongBefore,
      penaltyMinutes: pen,
      solveTimeMinutes: solveTimeMin,
      bestScore: Number(bestScore.toFixed(2)),
      firstAcTime,
    };
  });
}

export function computeStandings(
  submissions: Submission[],
  config: ScorerConfig,
  contestSlug: string,
  challengeData?: { slug: string; name: string; max_score: number }[],
): Scoreboard {
  // drop out-of-contest submissions:
  // 1. relativeSeconds < 0 means before contest start
  // 2. inContestBounds === false means HackerRank marked it as submitted outside contest window
  submissions = submissions.filter(s => s.relativeSeconds >= 0 && s.inContestBounds !== false);

  // if contest duration is set, also drop submissions after the window
  if (config.contestDurationMinutes > 0) {
    const cutoff = config.contestDurationMinutes * 60;
    submissions = submissions.filter(s => s.relativeSeconds <= cutoff);
  }

  // build problem list from challenge metadata if available, else from submissions
  const problemMap = new Map<string, { slug: string; name: string; maxScore: number }>();

  if (challengeData && challengeData.length) {
    for (const ch of challengeData) {
      problemMap.set(ch.slug, {
        slug: ch.slug,
        name: ch.name,
        maxScore: ch.max_score,
      });
    }
  }

  // also scan submissions to fill in any missing problems or update names
  for (const s of submissions) {
    const existing = problemMap.get(s.problemSlug);
    if (!existing) {
      problemMap.set(s.problemSlug, {
        slug: s.problemSlug,
        name: s.problem,
        maxScore: s.score,
      });
    } else if (!existing.name || existing.name === existing.slug) {
      existing.name = s.problem;
    }
  }

  // Preserve challenge metadata order when available; fall back to ascending maxScore
  let problemList: { slug: string; name: string; maxScore: number }[];
  if (challengeData && challengeData.length) {
    const challengeSlugs = new Set(challengeData.map(ch => ch.slug));
    const ordered = challengeData
      .map(ch => problemMap.get(ch.slug))
      .filter((p): p is { slug: string; name: string; maxScore: number } => !!p);
    const extra = [...problemMap.values()].filter(p => !challengeSlugs.has(p.slug));
    extra.sort((a, b) => a.maxScore - b.maxScore);
    problemList = [...ordered, ...extra];
  } else {
    problemList = [...problemMap.values()].sort((a, b) => a.maxScore - b.maxScore);
  }

  // group by user
  const byUser = new Map<number, Submission[]>();
  for (const s of submissions) {
    const arr = byUser.get(s.hackerId) ?? [];
    arr.push(s);
    byUser.set(s.hackerId, arr);
  }

  // build standings
  const dqSet = new Set(config.disqualified.map(u => u.toLowerCase()));
  const standings: Standing[] = [];

  for (const [hackerId, userSubs] of byUser) {
    const username = userSubs[0].username;
    const isDq = dqSet.has(username.toLowerCase());

    const problems = buildProblemResults(
      userSubs,
      problemList,
      config.contestStartEpoch,
      config.penaltyMinutes,
      config.partialMarking,
    );

    const solved = problems.filter(p => p.solved).length;
    const totalScore = Number(problems.reduce((sum, p) => sum + p.bestScore, 0).toFixed(2));
    const lastAcTime = Math.max(0, ...problems.filter(p => p.solved).map(p => p.firstAcTime));

    standings.push({
      rank: 0,
      username,
      hackerId,
      solved,
      totalScore,
      penalty: 0, // computed below based on scoring mode
      problems,
      lastAcTime,
      disqualified: isDq,
    });
  }

  // compute penalty based on scoring mode
  for (const s of standings) {
    const solvedProblems = s.problems.filter(p => p.solved);
    if (config.scoringMode === 'score') {
      // last-AC tiebreak: time of last AC (in min from start) + total wrong attempts × penalty
      if (solvedProblems.length > 0) {
        const lastSolveMin = Math.max(...solvedProblems.map(p => p.solveTimeMinutes));
        const totalWrong = solvedProblems.reduce((sum, p) => sum + p.wrongAttempts, 0);
        s.penalty = lastSolveMin + totalWrong * config.penaltyMinutes;
      }
    } else {
      // ICPC tiebreak: sum of (solveTime + wrong × penalty) per solved problem
      s.penalty = solvedProblems.reduce(
        (sum, p) => sum + p.solveTimeMinutes + p.wrongAttempts * config.penaltyMinutes, 0,
      );
    }
  }

  // sort: both modes rank by total score first, then solved, then penalty (lower = better)
  standings.sort((a, b) => {
    // dq goes to bottom
    if (a.disqualified !== b.disqualified) return a.disqualified ? 1 : -1;

    // primary: higher total score wins
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    // secondary: more solved
    if (b.solved !== a.solved) return b.solved - a.solved;
    // tertiary: lower penalty
    if (a.penalty !== b.penalty) return a.penalty - b.penalty;
    // quaternary: earlier last AC
    return a.lastAcTime - b.lastAcTime;
  });

  // assign ranks
  for (let i = 0; i < standings.length; i++) {
    if (standings[i].disqualified) {
      standings[i].rank = -1;
      continue;
    }
    if (i === 0) {
      standings[i].rank = 1;
    } else {
      const prev = standings[i - 1];
      const curr = standings[i];
      const tied =
        prev.totalScore === curr.totalScore
        && prev.solved === curr.solved
        && prev.penalty === curr.penalty;
      standings[i].rank = tied ? prev.rank : i + 1;
    }
  }

  return {
    standings,
    problems: problemList,
    config,
    updatedAt: Date.now(),
    contestSlug,
  };
}
