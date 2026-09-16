import type { ProjectionCursor } from './cursor.js';
import type { ProgramSafeRuntimeView } from './program-safe-runtime.js';

/** M2 establishes the channel seam without reserving future-event fields. */
export interface ObserverAssistProjection {
  readonly cursor: ProjectionCursor;
  readonly availability: 'unavailable';
}

export function projectObserverAssist(runtime: ProgramSafeRuntimeView): ObserverAssistProjection {
  return {
    cursor: runtime.cursor,
    availability: 'unavailable',
  };
}
