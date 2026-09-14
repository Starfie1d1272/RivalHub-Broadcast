export type SourceRecord = Record<string, unknown>;

export function asSourceRecord(value: unknown): SourceRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as SourceRecord)
    : undefined;
}

export function compareSourceKeys(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
