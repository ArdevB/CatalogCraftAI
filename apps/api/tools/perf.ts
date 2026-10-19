import { performance } from 'node:perf_hooks';
import request from 'supertest';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@catalogcraft/shared';
import { OrganizationModel } from '../src/modules/organizations/organization.model.js';
import { startLocalStack } from './local-stack.js';

/**
 * Performance check of the full workflow on a throwaway database:
 *
 *   npm run perf                       (2,000 products — the default import limit)
 *   npm run perf -- --rows 7500 --ai-ms 0
 *
 * `--ai-ms` simulates the AI's response time per product (default 0, which
 * measures CatalogCraft's own overhead). No real AI is called.
 */
const arg = (name: string, fallback: number) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? Number(process.argv[index + 1]) : fallback;
};
const ROWS = arg('rows', 2_000);
const AI_MS = arg('ai-ms', 0);
const CONCURRENT_READS = 50;

const COLOURS = ['Blue', 'Green', 'Sand', 'Charcoal', 'Ivory'];
function syntheticCsv(rows: number): Buffer {
  const lines = ['SKU,Title,Description,Brand,Category,Colour,Price,Currency,Stock,Barcode,Image URL,Supplier note'];
  for (let i = 1; i <= rows; i += 1) {
    const colour = COLOURS[i % COLOURS.length]!;
    lines.push(
      [
        `SKU-${String(i).padStart(6, '0')}`,
        `Stoneware mug ${colour.toLowerCase()}`,
        `"A glazed stoneware mug in ${colour.toLowerCase()}, dishwasher safe."`,
        'Synthetic Pottery Co',
        'Kitchen > Mugs',
        colour,
        (9.5 + (i % 40)).toFixed(2),
        'EUR',
        String(i % 120),
        '',
        `https://example.test/images/${i}.jpg`,
        'synthetic test data',
      ].join(','),
    );
  }
  return Buffer.from(lines.join('\n'));
}

const results: Array<[string, string]> = [];
async function timed<T>(label: string, run: () => Promise<T>, detail?: (value: T) => string): Promise<T> {
  const start = performance.now();
  const value = await run();
  const ms = performance.now() - start;
  results.push([label, `${ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`}${detail ? `  (${detail(value)})` : ''}`]);
  return value;
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;

async function main(): Promise<void> {
  console.log(`Starting a throwaway stack (in-memory MongoDB, scripted AI at ${AI_MS} ms/product)…`);
  const stack = await startLocalStack({ port: 4198, aiLatencyMs: AI_MS, aiConcurrency: 3 });
  const agent = request.agent(stack.url); // over real HTTP, like a browser
  agent.set(CSRF_HEADER, CSRF_HEADER_VALUE).set('Origin', stack.url);
  const api = (path: string) => `/api/v1${path}`;
  const peakRss = { value: 0 };
  const sampler = setInterval(() => (peakRss.value = Math.max(peakRss.value, process.memoryUsage().rss)), 100);

  try {
    const csv = syntheticCsv(ROWS);
    const signup = await agent
      .post(api('/auth/register'))
      .send({ name: 'Perf Tester', email: 'perf@example.test', password: 'a-long-test-password', organizationName: 'Perf Agency' })
      .expect(201);
    await OrganizationModel.updateOne({ _id: signup.body.data.organization.id }, { plan: 'studio' });
    const clientId = (await agent.post(api('/clients')).send({ name: 'Perf Client' }).expect(201)).body.data.id as string;
    const jobId = (await agent.post(api('/jobs')).send({ clientId, name: 'Perf job' }).expect(201)).body.data.id as string;

    await timed('Upload', () => agent.post(api(`/jobs/${jobId}/upload`)).attach('file', csv, 'perf.csv').expect(200), () => `${(csv.length / 1024).toFixed(0)} KB`);
    const preview = await timed('Preview + suggested mapping', () => agent.post(api(`/jobs/${jobId}/preview`)).send({}).expect(200));
    const mapping = preview.body.data.suggestedMapping as Record<string, number>;
    await agent.put(api(`/jobs/${jobId}/mapping`)).send({ sheetName: null, headerRow: 1, mapping }).expect(200);
    await timed('Import + validate', () => agent.post(api(`/jobs/${jobId}/validate`)).expect(200), (res) => `${res.body.data.counts.totalRows} rows`);

    await agent.post(api(`/jobs/${jobId}/enrich`)).send({ fields: ['title', 'description'] }).expect(202);
    await timed(
      'AI enrichment (background worker)',
      async () => {
        for (;;) {
          const job = (await agent.get(api(`/jobs/${jobId}`)).expect(200)).body.data;
          if (job.status !== 'queued' && job.status !== 'processing') return job;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      },
      (job) => `${job.status}, ${job.enrichment.succeededRows} succeeded, ${job.enrichment.failedRows} failed`,
    );

    await timed('Review table, first page', () => agent.get(api(`/jobs/${jobId}/rows?page=1`)).expect(200));
    await timed('Review table, search', () => agent.get(api(`/jobs/${jobId}/rows?search=SKU-0019`)).expect(200), (res) => `${res.body.data.pagination.totalItems} matches`);
    await timed(
      `${CONCURRENT_READS} concurrent page loads`,
      () =>
        Promise.all(
          Array.from({ length: CONCURRENT_READS }, async (_, i) => {
            const start = performance.now();
            await agent.get(api(`/jobs/${jobId}/rows?page=${(i % 20) + 1}`)).expect(200);
            return performance.now() - start;
          }),
        ),
      (values) => {
        const sorted = [...values].sort((a, b) => a - b);
        return `p50 ${percentile(sorted, 50).toFixed(0)} ms, p95 ${percentile(sorted, 95).toFixed(0)} ms`;
      },
    );

    await timed('Bulk approve', () => agent.post(api(`/jobs/${jobId}/approve`)).send({}).expect(200), (res) => `${res.body.data.updated} suggestions`);
    const exported = await timed('Export CSV', () => agent.post(api(`/jobs/${jobId}/export`)).send({ fields: ['title', 'description'] }).expect(201), (res) => `${res.body.data.rowCount} rows`);
    await timed('Download CSV', () => agent.get(api(`/exports/${exported.body.data.id}/download`)).expect(200), (res) => `${(Number(res.headers['content-length']) / 1024).toFixed(0)} KB`);
  } finally {
    clearInterval(sampler);
    await stack.close();
  }

  console.log(`\nCatalogCraft performance — ${ROWS.toLocaleString('en')} products, Node ${process.version}, ${process.platform}\n`);
  for (const [label, value] of results) console.log(`  ${label.padEnd(36)} ${value}`);
  console.log(`  ${'Peak memory (whole process)'.padEnd(36)} ${(peakRss.value / 1024 / 1024).toFixed(0)} MB`);
  console.log('\nWith a real AI, enrichment time ≈ products ÷ AI_CONCURRENCY × seconds per AI request.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
