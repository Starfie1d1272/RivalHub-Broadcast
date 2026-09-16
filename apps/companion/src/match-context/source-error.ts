/**
 * Expected source-side failure from a MatchContext or ScheduleWindow loader.
 *
 * Loaders must wrap network, availability, file, and source-format failures
 * in this error. Other exceptions are treated as programmer/invariant errors
 * and are deliberately allowed to cross the acquisition boundary.
 */
export class SourceLoadError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SourceLoadError';
    this.cause = cause;
  }
}
