import { buildApp } from './app.js';

const app = buildApp({ logger: true });
const host = process.env.HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '3000', 10);

let shutdownPromise: Promise<void> | undefined;

function shutdown(signal: string): void {
  shutdownPromise ??= app
    .close()
    .then(() => {
      app.log.info({ signal }, 'Companion stopped');
    })
    .catch((error: unknown) => {
      app.log.error(error, 'Companion shutdown failed');
      process.exitCode = 1;
    });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

try {
  await app.listen({ host, port });
  app.log.info({ host, port }, 'Companion listening');
} catch (error: unknown) {
  app.log.error(error, 'Companion startup failed');
  await app.close();
  process.exitCode = 1;
}
