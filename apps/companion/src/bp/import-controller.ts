import type { FastifyInstance } from 'fastify';
import { validateBroadcastManifest } from '@rivalhub-broadcast/rivalhub';
import type { MatchContextController } from '../match-context/index.js';
import { checkLocalWebOrigin, type LocalWebOriginPolicy } from '../local-web/origin-policy.js';
import type { BpSession } from './controller.js';

export function registerBpImportRoute(
  app: FastifyInstance,
  options: {
    readonly originPolicy: LocalWebOriginPolicy;
    readonly controller: MatchContextController | null;
    readonly session: BpSession;
    readonly clear: () => void;
  },
) {
  let importing = false;
  app.post('/operator/bp-manifest', { bodyLimit: 262_144 }, async (request, reply) => {
    if (
      options.originPolicy.mode !== 'loopback' ||
      !checkLocalWebOrigin(options.originPolicy, request.headers.origin).allowed
    ) {
      return reply.code(403).send({ error: 'operator_origin_forbidden' });
    }
    if (!options.controller) return reply.code(503).send({ error: 'match_import_unavailable' });
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body.expectedRevision !== 'string' || !('manifest' in body)) {
      return reply.code(400).send({ error: 'invalid_manifest_command' });
    }
    if (importing || options.session.get().revision !== body.expectedRevision) {
      return reply.code(409).send({ error: 'bp_conflict' });
    }
    importing = true;
    try {
      // A failed selection must never leave the previous match on air.
      options.controller.clearActive();
      options.clear();
      options.session.get();
      const validated = validateBroadcastManifest(body.manifest);
      if (!validated.ok) return reply.code(400).send({ error: 'invalid_manifest' });
      const selected = await options.controller.selectMatch(validated.value.match.matchId, {
        kind: 'fixture',
        load: () => Promise.resolve(validated.value),
      });
      if (!selected.ok) return reply.code(400).send({ error: 'manifest_selection_failed' });
      return {
        ok: true,
        persisted: !selected.diagnostics.some((d) => d.code === 'lkg_persistence_failed'),
      };
    } finally {
      importing = false;
    }
  });
}
