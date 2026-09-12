import Fastify, { type FastifyInstance } from 'fastify';

export interface CompanionAppOptions {
  readonly logger?: boolean;
}

export function buildApp(options: CompanionAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
