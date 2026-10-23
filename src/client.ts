import { hrPageSchema, type HRPage, type HRSubmission } from './schema.js';

export interface ClientConfig {
  contestSlug: string;
  cookie: string;
  pageSize?: number;
  delayMs?: number;
  maxRetries?: number;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function wait(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

export class HRClient {
  private base: string;
  private cookie: string;
  private limit: number;
  private delay: number;
  private retries: number;

  constructor(cfg: ClientConfig) {
    this.base = `https://www.hackerrank.com/rest/contests/${cfg.contestSlug}`;
    this.cookie = cfg.cookie;
    this.limit = cfg.pageSize ?? 50;
    this.delay = cfg.delayMs ?? 1500;
    this.retries = cfg.maxRetries ?? 3;
  }

  async fetchPage(offset: number): Promise<HRPage> {
    const url = `${this.base}/judge_submissions?offset=${offset}&limit=${this.limit}`;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        const backoff = this.delay * Math.pow(2, attempt - 1);
        console.log(`  retry ${attempt}/${this.retries} in ${backoff}ms...`);
        await wait(backoff);
      }

      let res: Response;
      try {
        res = await fetch(url, {
          headers: {
            Cookie: this.cookie,
            Accept: 'application/json',
            'User-Agent': UA,
          },
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err: any) {
        if (attempt < this.retries) continue;
        throw new Error(`request failed: ${err.message}`);
      }

      if (res.status === 429) {
        const retry = res.headers.get('Retry-After');
        const backoff = retry ? parseInt(retry, 10) * 1000 : this.delay * 4;
        console.warn(`  rate limited, waiting ${Math.round(backoff / 1000)}s...`);
        await wait(backoff);
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        throw new Error(`auth failed (${res.status}) — cookie is expired or invalid`);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        // check for cloudflare challenge page
        if (body.includes('cf-challenge') || body.includes('Just a moment')) {
          throw new Error('cloudflare challenge detected — use manual import instead');
        }
        if (attempt < this.retries) continue;
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('json')) {
        const body = await res.text().catch(() => '');
        throw new Error(`expected JSON, got ${contentType}: ${body.slice(0, 200)}`);
      }

      const json = await res.json();
      return hrPageSchema.parse(json);
    }

    throw new Error('max retries exceeded');
  }

  async fetchAll(opts?: {
    onProgress?: (fetched: number, total: number) => void;
  }): Promise<{ submissions: HRSubmission[]; total: number }> {
    const first = await this.fetchPage(0);
    const { total } = first;
    const all: HRSubmission[] = [...first.models];
    opts?.onProgress?.(all.length, total);

    for (let offset = this.limit; offset < total; offset += this.limit) {
      await wait(this.delay + Math.random() * 500);
      const page = await this.fetchPage(offset);
      all.push(...page.models);
      opts?.onProgress?.(all.length, total);
    }

    return { submissions: all, total };
  }

  // pull problem list for this contest
  async fetchChallenges(): Promise<any[]> {
    const url = `${this.base}/challenges?limit=100`;

    const res = await fetch(url, {
      headers: {
        Cookie: this.cookie,
        Accept: 'application/json',
        'User-Agent': UA,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.warn(`could not fetch challenges (${res.status}), skipping`);
      return [];
    }

    const json = await res.json();
    return json.models ?? [];
  }
}
