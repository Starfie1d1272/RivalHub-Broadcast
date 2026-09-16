import { assistPayloadSchema, type AssistPayload } from '@rivalhub-broadcast/protocol/assist';
import type { ObserverAssistProjection } from '@rivalhub-broadcast/core/projection';

export function mapObserverAssistProjection(projection: ObserverAssistProjection): AssistPayload {
  return assistPayloadSchema.parse({ availability: projection.availability });
}
