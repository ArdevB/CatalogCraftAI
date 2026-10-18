import type { Types } from 'mongoose';
import {
  buildPaginationMeta,
  columnMappingSchema,
  FINISHED_JOB_STATUSES,
  statusesThatCanBecome,
  type ColumnMapping,
  type CreateJobInput,
  type Job,
  type JobList,
  type JobListItem,
  type JobListQuery,
  type JobStatus,
  type Preview,
  type PreviewRequest,
} from '@catalogcraft/shared';
import type { AppConfig } from '../../config/env.js';
import { planLimits } from '../../config/plans.js';
import type { AuthContext } from '../../middleware/require-auth.js';
import { assertValidMapping, extractValues, suggestMapping } from '../../services/import/column-mapping.js';
import { detectFileType, parseFile, type ParsedFile, type ParsedSheet } from '../../services/import/parse-file.js';
import { buildTable } from '../../services/import/table.js';
import { checksum, newUploadKey, type FileStorage } from '../../services/storage/storage.js';
import { summarizeIssues, validateRows } from '../../services/validation/validate-rows.js';
import { AppError } from '../../utils/app-error.js';
import { tenantScope } from '../../utils/tenant.js';
import { UserModel } from '../auth/user.model.js';
import { CatalogRowModel } from '../catalog-rows/catalog-row.model.js';
import { ClientModel } from '../clients/client.model.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { CatalogJobModel, type CatalogJob } from './catalog-job.model.js';

export type JobServiceDeps = { config: AppConfig; storage: FileStorage };
type JobDoc = CatalogJob & { _id: Types.ObjectId };
export type UploadedFile = { originalname: string; mimetype: string; buffer: Buffer };

/** A job stuck in "validating" this long (e.g. the server restarted mid-way) may be validated again. */
const STALE_VALIDATION_MS = 10 * 60 * 1000;
const PREVIEW_ROWS = 10;
const EMPTY_COUNTS = { totalRows: 0, validRows: 0, warningRows: 0, failedRows: 0, skippedEmptyRows: 0 };

/* ------------------------------------------------------------------ DTOs */

function toListItem(job: JobDoc, names: { client: Map<string, string>; user: Map<string, string> }): JobListItem {
  const file = job.originalFile;
  return {
    id: job._id.toString(),
    name: job.name,
    status: job.status,
    client: { id: job.clientId.toString(), name: names.client.get(job.clientId.toString()) ?? 'Deleted client' },
    createdBy: { id: job.createdBy.toString(), name: names.user.get(job.createdBy.toString()) ?? 'Former member' },
    file: file
      ? {
          filename: file.filename,
          fileType: file.fileType,
          sizeBytes: file.sizeBytes,
          sheets: [...file.sheets],
          uploadedAt: file.uploadedAt.toISOString(),
        }
      : null,
    counts: { ...EMPTY_COUNTS, ...(job.counts ?? {}) },
    lastError: job.lastError ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

async function loadNames(jobs: JobDoc[]) {
  const [clients, users] = await Promise.all([
    ClientModel.find({ _id: { $in: jobs.map((job) => job.clientId) } }).select('name').lean(),
    UserModel.find({ _id: { $in: jobs.map((job) => job.createdBy) } }).select('name').lean(),
  ]);
  return {
    client: new Map(clients.map((client) => [client._id.toString(), client.name])),
    user: new Map(users.map((user) => [user._id.toString(), user.name])),
  };
}

export async function toJobDto(job: JobDoc): Promise<Job> {
  const config = job.importConfig;
  return {
    ...toListItem(job, await loadNames([job])),
    importConfig: config
      ? {
          sheetName: config.sheetName ?? null,
          headerRow: config.headerRow,
          mapping: columnMappingSchema.parse(config.mapping ?? {}),
          headers: [...config.headers],
        }
      : null,
    issueSummary: job.issueSummary.map((item) => ({ ...item })),
  };
}

/* --------------------------------------------------------------- helpers */

async function findJob(auth: AuthContext, jobId: string): Promise<JobDoc> {
  const job = await CatalogJobModel.findOne({ _id: jobId, ...tenantScope(auth) }).lean();
  if (!job) throw new AppError('NOT_FOUND', 'Job not found.');
  return job;
}

const STATUS_WORDS: Record<JobStatus, string> = {
  draft: 'waiting for a file',
  uploaded: 'uploaded',
  validating: 'being validated',
  ready: 'validated',
  queued: 'queued for AI enrichment',
  processing: 'being enriched',
  review: 'in review',
  exporting: 'being exported',
  completed: 'completed',
  failed: 'failed',
};

/**
 * Moves a job to `to` in one atomic database operation, but only from a
 * status allowed by the shared state machine. If two requests race, only one
 * wins; the other gets a clear 409.
 */
async function transition(
  auth: AuthContext,
  jobId: string,
  to: JobStatus,
  update: Record<string, unknown> = {},
  extraFilter: Record<string, unknown> = {},
): Promise<JobDoc> {
  const job = await CatalogJobModel.findOneAndUpdate(
    { _id: jobId, ...tenantScope(auth), status: { $in: statusesThatCanBecome(to) }, ...extraFilter },
    { $set: { ...update, status: to } },
    { returnDocument: 'after' },
  ).lean();
  if (job) return job;

  const current = await findJob(auth, jobId);
  throw new AppError('CONFLICT', `This job is ${STATUS_WORDS[current.status]}, so that step isn't available right now.`);
}

async function readSourceFile(deps: JobServiceDeps, job: JobDoc): Promise<ParsedFile> {
  if (!job.originalFile) throw new AppError('CONFLICT', 'Upload a file for this job first.');
  const data = await deps.storage.get(job.originalFile.storageKey);
  // Read one row past the limit so we can tell the user the file is too big.
  return parseFile(data, job.originalFile.fileType, { maxRows: deps.config.imports.maxRows + HEADER_ALLOWANCE });
}

/** Extra rows read beyond the product limit to allow for title/header rows above the data. */
const HEADER_ALLOWANCE = 50;

function pickSheet(file: ParsedFile, sheetName: string | null | undefined): ParsedSheet {
  if (sheetName === null || sheetName === undefined) return file.sheets[0]!;
  const sheet = file.sheets.find((candidate) => candidate.name === sheetName);
  if (!sheet) throw new AppError('VALIDATION_ERROR', `The workbook has no sheet named “${sheetName}”.`);
  return sheet;
}

/** "C:\fakepath\..\Prices 2026.csv" → "Prices 2026.csv". Display only; never used as a path. */
function displayFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'upload';
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || 'upload';
}

/* ------------------------------------------------------------ operations */

export async function createJob(auth: AuthContext, input: CreateJobInput): Promise<JobDoc> {
  const client = await ClientModel.findOne({ _id: input.clientId, ...tenantScope(auth) }).select('_id').lean();
  if (!client) throw new AppError('NOT_FOUND', 'Client not found.');

  const organization = await OrganizationModel.findById(auth.organizationId).select('plan').lean();
  const limit = organization ? planLimits(organization.plan).maxActiveJobs : null;
  if (limit !== null) {
    const active = await CatalogJobModel.countDocuments({
      ...tenantScope(auth),
      status: { $nin: FINISHED_JOB_STATUSES },
    });
    if (active >= limit) {
      throw new AppError(
        'PLAN_LIMIT_REACHED',
        `Your plan allows ${limit} active job${limit === 1 ? '' : 's'} at a time. Finish or delete an existing job, or upgrade.`,
      );
    }
  }

  const job = await CatalogJobModel.create({
    ...tenantScope(auth),
    clientId: client._id,
    createdBy: auth.userId,
    name: input.name ?? `Import ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
  });
  return job.toObject();
}

export async function listJobs(auth: AuthContext, query: JobListQuery): Promise<JobList> {
  const filter = {
    ...tenantScope(auth),
    ...(query.clientId ? { clientId: query.clientId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  const [jobs, totalItems] = await Promise.all([
    CatalogJobModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean(),
    CatalogJobModel.countDocuments(filter),
  ]);
  const names = await loadNames(jobs);
  return { items: jobs.map((job) => toListItem(job, names)), pagination: buildPaginationMeta(query, totalItems) };
}

export function getJob(auth: AuthContext, jobId: string): Promise<JobDoc> {
  return findJob(auth, jobId);
}

/**
 * Stores a new source file for the job, replacing any previous one. The file
 * is fully parsed first, so unreadable files are rejected before anything is
 * saved. Previously imported rows are discarded because they came from the
 * old file.
 */
export async function uploadFile(deps: JobServiceDeps, auth: AuthContext, jobId: string, file: UploadedFile): Promise<JobDoc> {
  const existing = await findJob(auth, jobId);
  if (!statusesThatCanBecome('uploaded').includes(existing.status)) {
    throw new AppError('CONFLICT', `This job is ${STATUS_WORDS[existing.status]}, so its file can't be replaced.`);
  }

  const fileType = detectFileType(file.originalname, file.buffer);
  const parsed = await parseFile(file.buffer, fileType, { maxRows: HEADER_ALLOWANCE });
  const key = newUploadKey(auth.organizationId, fileType);
  await deps.storage.put(key, file.buffer);

  let job: JobDoc;
  try {
    job = await transition(auth, jobId, 'uploaded', {
      originalFile: {
        storageKey: key,
        filename: displayFilename(file.originalname),
        contentType: fileType === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileType,
        sizeBytes: file.buffer.length,
        checksum: checksum(file.buffer),
        sheets: parsed.sheets.map((sheet) => sheet.name),
        uploadedAt: new Date(),
      },
      importConfig: null,
      counts: EMPTY_COUNTS,
      issueSummary: [],
      lastError: null,
    });
  } catch (error) {
    await deps.storage.delete(key); // don't leave an orphaned file behind
    throw error;
  }

  await CatalogRowModel.deleteMany({ jobId: job._id, ...tenantScope(auth) });
  if (existing.originalFile) await deps.storage.delete(existing.originalFile.storageKey);
  return job;
}

export async function previewJob(
  deps: JobServiceDeps,
  auth: AuthContext,
  jobId: string,
  request: PreviewRequest,
): Promise<Preview> {
  const job = await findJob(auth, jobId);
  const parsed = await readSourceFile(deps, job);
  const sheet = pickSheet(parsed, request.sheetName ?? job.importConfig?.sheetName);
  const headerRow = request.headerRow ?? job.importConfig?.headerRow ?? 1;
  const table = buildTable(sheet.rows, headerRow);
  const maxRows = deps.config.imports.maxRows;

  return {
    fileType: parsed.fileType,
    sheets: parsed.sheets.map((candidate) => candidate.name),
    sheetName: parsed.fileType === 'xlsx' ? sheet.name : null,
    headerRow,
    headers: table.headers,
    sampleRows: table.rows.slice(0, PREVIEW_ROWS),
    totalDataRows: table.rows.length,
    skippedEmptyRows: table.skippedEmptyRows,
    maxRows,
    exceedsRowLimit: sheet.truncated || table.rows.length > maxRows,
    suggestedMapping: suggestMapping(table.headers),
    notices: parsed.notices,
  };
}

export async function saveMapping(
  deps: JobServiceDeps,
  auth: AuthContext,
  jobId: string,
  input: { sheetName: string | null; headerRow: number; mapping: ColumnMapping },
): Promise<JobDoc> {
  const job = await findJob(auth, jobId);
  const parsed = await readSourceFile(deps, job);
  const sheet = pickSheet(parsed, input.sheetName);
  const table = buildTable(sheet.rows, input.headerRow);
  const { mapping } = input;
  assertValidMapping(mapping, table.headers);

  const updated = await transition(auth, jobId, 'uploaded', {
    importConfig: {
      sheetName: parsed.fileType === 'xlsx' ? sheet.name : null,
      headerRow: input.headerRow,
      mapping,
      headers: table.headers,
    },
    counts: EMPTY_COUNTS,
    issueSummary: [],
    lastError: null,
  });
  // A new mapping makes earlier validation results meaningless.
  await CatalogRowModel.deleteMany({ jobId: updated._id, ...tenantScope(auth) });
  return updated;
}

/**
 * Imports every row with the saved mapping and runs validation.
 *
 * Runs within the request: with the 2,000-row limit this takes about a second.
 * (AI enrichment, which is much slower, will use a background queue.)
 */
export async function validateJob(deps: JobServiceDeps, auth: AuthContext, jobId: string): Promise<JobDoc> {
  const before = await findJob(auth, jobId);
  if (!before.importConfig) throw new AppError('CONFLICT', 'Map the columns before validating.');

  const staleCutoff = new Date(Date.now() - STALE_VALIDATION_MS);
  const job = await CatalogJobModel.findOneAndUpdate(
    {
      _id: jobId,
      ...tenantScope(auth),
      $or: [{ status: { $in: statusesThatCanBecome('validating') } }, { status: 'validating', updatedAt: { $lt: staleCutoff } }],
    },
    { $set: { status: 'validating', lastError: null } },
    { returnDocument: 'after' },
  ).lean();
  if (!job || !job.importConfig) {
    throw new AppError('CONFLICT', `This job is ${STATUS_WORDS[before.status]}, so it can't be validated right now.`);
  }

  const fail = (message: string) =>
    CatalogJobModel.findOneAndUpdate(
      { _id: job._id, status: 'validating' },
      { $set: { status: 'failed', lastError: message } },
      { returnDocument: 'after' },
    ).lean();

  try {
    const parsed = await readSourceFile(deps, job);
    const sheet = pickSheet(parsed, job.importConfig.sheetName);
    const table = buildTable(sheet.rows, job.importConfig.headerRow);
    const maxRows = deps.config.imports.maxRows;
    if (sheet.truncated || table.rows.length > maxRows) {
      const failed = await fail(
        `This sheet has more than ${maxRows.toLocaleString('en')} product rows, the limit for one job. Split the file and import it in parts.`,
      );
      return failed ?? job;
    }

    const mapping = columnMappingSchema.parse(job.importConfig.mapping);
    const client = await ClientModel.findOne({ _id: job.clientId, ...tenantScope(auth) }).select('brandProfile').lean();
    const inputs = table.rows.map((row) => ({ rowNumber: row.rowNumber, values: extractValues(row.values, mapping) }));
    const results = validateRows(inputs, { maxTitleLength: client?.brandProfile.maxTitleLength ?? 150 });

    await CatalogRowModel.deleteMany({ jobId: job._id, ...tenantScope(auth) });
    await CatalogRowModel.insertMany(
      table.rows.map((row, index) => ({
        organizationId: job.organizationId,
        clientId: job.clientId,
        jobId: job._id,
        rowNumber: row.rowNumber,
        sourceValues: row.values,
        original: inputs[index]!.values,
        sourceIdentifier: results[index]!.sourceIdentifier,
        status: results[index]!.status,
        validationIssues: results[index]!.issues,
      })),
    );

    const count = (status: string) => results.filter((result) => result.status === status).length;
    const done = await CatalogJobModel.findOneAndUpdate(
      { _id: job._id, status: 'validating' },
      {
        $set: {
          status: 'ready',
          counts: {
            totalRows: results.length,
            validRows: count('valid'),
            warningRows: count('warning'),
            failedRows: count('error'),
            skippedEmptyRows: table.skippedEmptyRows,
          },
          issueSummary: summarizeIssues(results),
        },
      },
      { returnDocument: 'after' },
    ).lean();
    if (!done) throw new Error('Job left the validating state unexpectedly.');
    return done;
  } catch (error) {
    // Expected problems (e.g. the file became unreadable) are shown to the user;
    // anything else is logged by the error handler and reported generically.
    await fail(error instanceof AppError ? error.message : 'Validation stopped because of an unexpected error. Please try again.');
    throw error;
  }
}

const BUSY_STATUSES: readonly JobStatus[] = ['validating', 'processing', 'exporting'];

export async function deleteJob(deps: JobServiceDeps, auth: AuthContext, jobId: string): Promise<void> {
  const job = await findJob(auth, jobId);
  if (BUSY_STATUSES.includes(job.status)) {
    throw new AppError('CONFLICT', `This job is ${STATUS_WORDS[job.status]}. Wait for it to finish before deleting it.`);
  }
  await CatalogRowModel.deleteMany({ jobId: job._id, ...tenantScope(auth) });
  await CatalogJobModel.deleteOne({ _id: job._id, ...tenantScope(auth) });
  if (job.originalFile) await deps.storage.delete(job.originalFile.storageKey);
}
