import type { Types } from 'mongoose';
import { buildPaginationMeta, productValuesSchema, type CatalogRow as CatalogRowDto, type RowList, type RowListQuery } from '@catalogcraft/shared';
import type { AuthContext } from '../../middleware/require-auth.js';
import { AppError } from '../../utils/app-error.js';
import { escapeRegex } from '../../utils/escape-regex.js';
import { tenantScope } from '../../utils/tenant.js';
import { CatalogJobModel } from '../catalog-jobs/catalog-job.model.js';
import { CatalogRowModel, type CatalogRow } from './catalog-row.model.js';

export function toRowDto(row: CatalogRow & { _id: Types.ObjectId }): CatalogRowDto {
  return {
    id: row._id.toString(),
    rowNumber: row.rowNumber,
    sourceIdentifier: row.sourceIdentifier ?? null,
    status: row.status,
    original: productValuesSchema.parse(row.original ?? {}),
    issues: row.validationIssues.map((issue) => ({ ...issue })),
  };
}

/** Paginated rows of one job, filtered by status / issue field / search. Never loads the whole job. */
export async function listRows(auth: AuthContext, jobId: string, query: RowListQuery): Promise<RowList> {
  const job = await CatalogJobModel.exists({ _id: jobId, ...tenantScope(auth) });
  if (!job) throw new AppError('NOT_FOUND', 'Job not found.');

  const search = query.search ? new RegExp(escapeRegex(query.search), 'i') : null;
  const filter = {
    ...tenantScope(auth),
    jobId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.field ? { 'validationIssues.field': query.field } : {}),
    ...(search ? { $or: [{ sourceIdentifier: search }, { 'original.title': search }] } : {}),
  };

  const [rows, totalItems] = await Promise.all([
    CatalogRowModel.find(filter)
      .sort({ rowNumber: 1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean(),
    CatalogRowModel.countDocuments(filter),
  ]);
  return { items: rows.map(toRowDto), pagination: buildPaginationMeta(query, totalItems) };
}
