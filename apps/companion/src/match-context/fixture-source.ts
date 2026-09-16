import { readFile } from 'node:fs/promises';

import { SourceLoadError } from './source-error.js';

export type FixtureSourceKind = 'fixture';

export interface FixtureSource {
  readonly kind: FixtureSourceKind;
  readonly path: string;
  readonly load: () => Promise<unknown>;
}

export async function readFixtureJson(path: string): Promise<unknown> {
  try {
    const bytes = await readFile(path, 'utf8');
    return JSON.parse(bytes) as unknown;
  } catch (error: unknown) {
    if (error instanceof SourceLoadError) throw error;
    throw new SourceLoadError(`fixture source 读取失败：${path}`, error);
  }
}

export function createFixtureManifestSource(path: string): FixtureSource {
  return { kind: 'fixture', path, load: () => readFixtureJson(path) };
}

export function createFixtureScheduleWindowSource(path: string): FixtureSource {
  return { kind: 'fixture', path, load: () => readFixtureJson(path) };
}
