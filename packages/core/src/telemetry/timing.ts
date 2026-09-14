export interface TelemetryReceiveContext {
  readonly sequence: number;
  readonly receivedAt: string;
  readonly receivedMonotonicMs: number;
}
