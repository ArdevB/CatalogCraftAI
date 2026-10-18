import { Router } from 'express';
import { z } from 'zod';
import { clientListQuerySchema, createClientSchema, objectIdSchema, updateClientSchema } from '@catalogcraft/shared';
import { getAuth, requireAuth, requirePermission } from '../../middleware/require-auth.js';
import { sendSuccess } from '../../utils/http-response.js';
import { validateRequest } from '../../utils/validate-request.js';
import { createClient, deleteClient, getClient, listClients, toClientDto, updateClient } from './client.service.js';

const clientParams = z.object({ clientId: objectIdSchema });

export function clientsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', requirePermission('clients:read'), async (req, res) => {
    const { query } = validateRequest(req, { query: clientListQuerySchema });
    sendSuccess(res, await listClients(getAuth(req), query));
  });

  router.post('/', requirePermission('clients:manage'), async (req, res) => {
    const { body } = validateRequest(req, { body: createClientSchema });
    const client = await createClient(getAuth(req), body);
    sendSuccess(res, toClientDto(client), { status: 201, message: 'Client created.' });
  });

  router.get('/:clientId', requirePermission('clients:read'), async (req, res) => {
    const { params } = validateRequest(req, { params: clientParams });
    sendSuccess(res, toClientDto(await getClient(getAuth(req), params.clientId)));
  });

  router.patch('/:clientId', requirePermission('clients:manage'), async (req, res) => {
    const { params, body } = validateRequest(req, { params: clientParams, body: updateClientSchema });
    const client = await updateClient(getAuth(req), params.clientId, body);
    sendSuccess(res, toClientDto(client), { message: 'Client updated.' });
  });

  router.delete('/:clientId', requirePermission('clients:manage'), async (req, res) => {
    const { params } = validateRequest(req, { params: clientParams });
    await deleteClient(getAuth(req), params.clientId);
    sendSuccess(res, null, { message: 'Client deleted.' });
  });

  return router;
}
