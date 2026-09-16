import { readFile } from 'node:fs/promises';

export type FixtureSourceKind = 'fixture';

export interface FixtureSource {
  readonly kind: FixtureSourceKind;
  readonly path: string;
  readonly load: () => Promise<unknown>;
}

export async function readFixtureJson(path: string): Promise<unknown> {
  const bytes = await readFile(path, 'utf8');
  return JSON.parse(bytes) as unknown;
}

export function createFixtureManifestSource(path: string): FixtureSource {
  return { kind: 'fixture', path, load: () => readFixtureJson(path) };
}

export function createFixtureScheduleWindowSource(path: string): FixtureSource {
  return { kind: 'fixture', path, load: () => readFixtureJson(path) };
}
