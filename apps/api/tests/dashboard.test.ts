import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiSuccessResponseSchema, DASHBOARD_TREND_DAYS, dashboardSummarySchema } from '@catalogcraft/shared';
import { CatalogJobModel } from '../src/modules/catalog-jobs/catalog-job.model.js';
import { CatalogRowModel } from '../src/modules/catalog-rows/catalog-row.model.js';
import { lastDays } from '../src/modules/dashboard/dashboard-trend.js';
import { ExportModel } from '../src/modules/exports/export.model.js';
import { UsageEventModel } from '../src/modules/usage/usage-event.model.js';
import { connectTestDatabase, dbTestApp, disconnectTestDatabase, newAgency } from './helpers.js';

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

const summaryResponse = apiSuccessResponseSchema(dashboardSummarySchema);
const HOUR = 60 * 60 * 1000;

describe('lastDays', () => {
  it('lists consecutive calendar days ending today, in the given time zone', () => {
    const now = new Date('2026-10-19T20:30:00Z');
    expect(lastDays('UTC', 3, now)).toEqual(['2026-10-17', '2026-10-18', '2026-10-19']);
    // Already the 20th in Kathmandu (UTC+5:45), still the 19th in Los Angeles.
    expect(lastDays('Asia/Kathmandu', 1, now)).toEqual(['2026-10-20']);
    expect(lastDays('America/Los_Angeles', 1, now)).toEqual(['2026-10-19']);
  });

  it('never skips or repeats a day around daylight-saving changes', () => {
    const days = lastDays('America/New_York', 30, new Date('2026-03-20T03:30:00Z'));
    expect(new Set(days).size).toBe(30);
    expect(days).toContain('2026-03-08'); // the day clocks went forward
    for (let i = 1; i < days.length; i += 1) {
      expect(Date.parse(days[i]!) - Date.parse(days[i - 1]!)).toBe(24 * HOUR);
    }
  });
});

describe('dashboard insights', () => {
  it('reports daily activity, jobs per status and pending suggestions — for the caller’s organization only', async () => {
    const app = dbTestApp();
    const agency = await newAgency(app, { plan: 'agency' });
    const other = await newAgency(app, { plan: 'agency' });
    const orgId = new Types.ObjectId(agency.organizationId);
    const otherId = new Types.ObjectId(other.organizationId);
    const ref = { jobId: new Types.ObjectId(), rowId: new Types.ObjectId(), eventType: 'ai_request', quantity: 1, model: 'mock' };
    const twoHoursAgo = new Date(Date.now() - 2 * HOUR);
    const yesterday = new Date(Date.now() - 26 * HOUR);

    await UsageEventModel.collection.insertMany([
      { ...ref, organizationId: orgId, status: 'succeeded', usageUnits: 1, createdAt: twoHoursAgo },
      { ...ref, organizationId: orgId, status: 'succeeded', usageUnits: 1, createdAt: twoHoursAgo },
      { ...ref, organizationId: orgId, status: 'failed', usageUnits: 0, createdAt: twoHoursAgo }, // failures don't count
      { ...ref, organizationId: orgId, status: 'succeeded', usageUnits: 1, createdAt: yesterday },
      { ...ref, organizationId: otherId, status: 'succeeded', usageUnits: 1, createdAt: twoHoursAgo }, // another agency
    ]);
    await ExportModel.collection.insertOne({ organizationId: orgId, jobId: ref.jobId, filename: 'a.csv', rowCount: 1, createdAt: twoHoursAgo });
    const job = (organizationId: Types.ObjectId, status: string) => ({
      organizationId,
      status,
      name: `Job ${status}`,
      clientId: new Types.ObjectId(),
      createdBy: new Types.ObjectId(),
      createdAt: twoHoursAgo,
      updatedAt: twoHoursAgo,
    });
    await CatalogJobModel.collection.insertMany([job(orgId, 'review'), job(orgId, 'review'), job(orgId, 'completed'), job(otherId, 'failed')]);
    await CatalogRowModel.collection.insertMany([
      { organizationId: orgId, jobId: ref.jobId, rowNumber: 2, suggestions: [{ status: 'pending' }, { status: 'approved' }, { status: 'pending' }] },
      { organizationId: orgId, jobId: ref.jobId, rowNumber: 3, suggestions: [{ status: 'pending' }] },
      { organizationId: otherId, jobId: ref.jobId, rowNumber: 4, suggestions: [{ status: 'pending' }] },
    ]);

    const res = await agency.client.get('/api/v1/dashboard/summary?tz=UTC');
    expect(res.status).toBe(200);
    const summary = summaryResponse.parse(res.body).data;

    expect(summary.trend).toHaveLength(DASHBOARD_TREND_DAYS);
    const day = (date: Date) => summary.trend.find((entry) => entry.date === date.toISOString().slice(0, 10));
    expect(day(twoHoursAgo)).toMatchObject({ productsEnriched: 2, exports: 1 });
    expect(day(yesterday)).toMatchObject({ productsEnriched: 1, exports: 0 });
    expect(summary.trend.reduce((total, entry) => total + entry.productsEnriched, 0)).toBe(3);
    expect(summary.jobsByStatus).toEqual({ review: 2, completed: 1 });
    expect(summary.pendingSuggestions).toBe(3);
  });

  it('starts empty, and rejects unknown time zones', async () => {
    const agency = await newAgency(dbTestApp());
    const summary = summaryResponse.parse((await agency.client.get('/api/v1/dashboard/summary')).body).data;
    expect(summary.trend.every((entry) => entry.productsEnriched === 0 && entry.exports === 0)).toBe(true);
    expect(summary.jobsByStatus).toEqual({});
    expect(summary.pendingSuggestions).toBe(0);

    const bad = await agency.client.get('/api/v1/dashboard/summary?tz=Mars/Olympus_Mons');
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].path).toBe('query.tz');
  });
});
