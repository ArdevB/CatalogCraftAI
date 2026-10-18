import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  createJobSchema,
  jobListQuerySchema,
  objectIdSchema,
  previewRequestSchema,
  rowListQuerySchema,
  saveMappingSchema,
} from '@catalogcraft/shared';
import { getAuth, requireAuth, requirePermission } from '../../middleware/require-auth.js';
import { AppError } from '../../utils/app-error.js';
import { sendSuccess } from '../../utils/http-response.js';
import { validateRequest } from '../../utils/validate-request.js';
import { listRows } from '../catalog-rows/catalog-row.service.js';
import {
  createJob,
  deleteJob,
  getJob,
  listJobs,
  previewJob,
  saveMapping,
  toJobDto,
  uploadFile,
  validateJob,
  type JobServiceDeps,
} from './catalog-job.service.js';

const jobParams = z.object({ jobId: objectIdSchema });

/**
 * Accepts exactly one file in the `file` field, held in memory up to the
 * configured size limit. It is checked and stored privately by the service.
 */
function singleFileUpload(maxBytes: number): RequestHandler {
  const handler = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 5, parts: 10 },
  }).single('file');
  const maxMb = Math.round((maxBytes / 1024 / 1024) * 10) / 10;

  return (req, res, next) => {
    handler(req, res, (error: unknown) => {
      if (!error) return next();
      if (error instanceof multer.MulterError) {
        return next(
          error.code === 'LIMIT_FILE_SIZE'
            ? new AppError('PAYLOAD_TOO_LARGE', `The file is larger than the ${maxMb} MB limit.`)
            : new AppError('INVALID_FILE', 'Upload exactly one file in the “file” field.'),
        );
      }
      next(error);
    });
  };
}

export function jobsRouter(deps: JobServiceDeps): Router {
  const router = Router();
  router.use(requireAuth);
  const canRead = requirePermission('jobs:read');
  const canEdit = requirePermission('jobs:edit');

  router.get('/', canRead, async (req, res) => {
    const { query } = validateRequest(req, { query: jobListQuerySchema });
    sendSuccess(res, await listJobs(getAuth(req), query));
  });

  router.post('/', canEdit, async (req, res) => {
    const { body } = validateRequest(req, { body: createJobSchema });
    const job = await createJob(getAuth(req), body);
    sendSuccess(res, await toJobDto(job), { status: 201, message: 'Job created.' });
  });

  router.get('/:jobId', canRead, async (req, res) => {
    const { params } = validateRequest(req, { params: jobParams });
    sendSuccess(res, await toJobDto(await getJob(getAuth(req), params.jobId)));
  });

  router.delete('/:jobId', canEdit, async (req, res) => {
    const { params } = validateRequest(req, { params: jobParams });
    await deleteJob(deps, getAuth(req), params.jobId);
    sendSuccess(res, null, { message: 'Job deleted.' });
  });

  // Auth and permission run before multer, so anonymous requests are refused
  // before the server spends memory receiving a file.
  router.post('/:jobId/upload', canEdit, singleFileUpload(deps.config.imports.maxUploadBytes), async (req, res) => {
    const { params } = validateRequest(req, { params: jobParams });
    if (!req.file) throw new AppError('INVALID_FILE', 'Choose a CSV or XLSX file to upload.');
    const job = await uploadFile(deps, getAuth(req), params.jobId, req.file);
    sendSuccess(res, await toJobDto(job), { message: 'File uploaded.' });
  });

  router.post('/:jobId/preview', canRead, async (req, res) => {
    const { params, body } = validateRequest(req, { params: jobParams, body: previewRequestSchema });
    sendSuccess(res, await previewJob(deps, getAuth(req), params.jobId, body));
  });

  router.put('/:jobId/mapping', canEdit, async (req, res) => {
    const { params, body } = validateRequest(req, { params: jobParams, body: saveMappingSchema });
    const job = await saveMapping(deps, getAuth(req), params.jobId, body);
    sendSuccess(res, await toJobDto(job), { message: 'Column mapping saved.' });
  });

  router.post('/:jobId/validate', canEdit, async (req, res) => {
    const { params } = validateRequest(req, { params: jobParams });
    const job = await validateJob(deps, getAuth(req), params.jobId);
    sendSuccess(res, await toJobDto(job), {
      message: job.status === 'ready' ? 'Validation finished.' : 'Validation could not be completed.',
    });
  });

  router.get('/:jobId/rows', canRead, async (req, res) => {
    const { params, query } = validateRequest(req, { params: jobParams, query: rowListQuerySchema });
    sendSuccess(res, await listRows(getAuth(req), params.jobId, query));
  });

  return router;
}
