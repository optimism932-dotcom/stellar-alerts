import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { isValidContractId } from '@stellar-alerts/shared';
import { abiRegistryService } from './abi-registry.service';
import { authenticateHook } from '../../middleware/auth.middleware';

export async function abiRegistryRoutes(app: FastifyInstance) {
  app.get(
    '/soroban/contracts/:contractId/abi',
    { preHandler: authenticateHook },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { contractId } = request.params as { contractId: string };
      if (!isValidContractId(contractId)) {
        return reply.status(400).send({ error: 'Invalid Stellar contract ID format' });
      }
      const abi = await abiRegistryService.get(contractId);
      return reply.send({ contractId, abi });
    },
  );
}
