import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { sanitizeCapture } from '../src/capture/sanitizer.js';
import { verifyCapture } from '../src/capture/reader.js';
import { writeCapture, testFrame } from './helpers.js';

const PLAYER_ID = '76561198000000001';
const OBSERVER_ID = '76561198000000002';
const PLAYER_NAME = 'Raw Player Name';
const OBSERVER_NAME = 'Raw Observer Name';
const TEAM_CT = 'Raw CT Team';
const TEAM_T = 'Raw T Team';
const AUTH_TOKEN = 'raw-auth-token-value';

interface SanitizedPayload {
  readonly map: {
    readonly team_ct: { readonly name: string };
    readonly team_t: { readonly name: string };
  };
  readonly player: {
    readonly clan: string;
    readonly weapons: { readonly weapon_0: { readonly name: string } };
  };
  readonly allplayers: Record<
    string,
    {
      readonly weapons: { readonly weapon_0: { readonly name: string } };
    }
  >;
  readonly previously: { readonly player: { readonly clan: string } };
  readonly provider: { readonly version: string };
  readonly futureEvidence: { readonly stableValue: string; readonly stableNumber: number };
}

function sensitivePayload(): Record<string, unknown> {
  return {
    provider: {
      steamid: OBSERVER_ID,
      name: 'Counter-Strike: Global Offensive',
      version: '1.0.0',
    },
    observer: { steamid: OBSERVER_ID, name: OBSERVER_NAME },
    map: {
      team_ct: { name: TEAM_CT },
      team_t: { name: TEAM_T },
      phase: 'live',
    },
    player: {
      steamid: PLAYER_ID,
      name: PLAYER_NAME,
      clan: `${TEAM_CT} `,
      team: 'CT',
      weapons: { weapon_0: { name: 'weapon_knife' } },
    },
    allplayers: {
      [PLAYER_ID]: {
        name: PLAYER_NAME,
        clan: `${TEAM_CT} `,
        team: 'CT',
        weapons: { weapon_0: { name: 'weapon_ak47' } },
      },
    },
    previously: {
      player: { name: PLAYER_NAME, clan: `${TEAM_CT} ` },
      allplayers: { [PLAYER_ID]: { name: PLAYER_NAME, clan: `${TEAM_CT} ` } },
    },
    added: {
      map: { team_ct: { name: TEAM_CT }, team_t: { name: TEAM_T } },
      allplayers: { [PLAYER_ID]: { name: PLAYER_NAME, clan: `${TEAM_CT} ` } },
    },
    auth: { token: AUTH_TOKEN },
    endpoint: 'https://example.invalid/raw-endpoint',
    futureEvidence: { stableValue: 'preserve-me', stableNumber: 42 },
  };
}

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'rivalhub-testkit-sanitizer-'));
}

describe('deterministic capture sanitizer', () => {
  it('produces byte-identical gold, preserves evidence, and records provenance', async () => {
    const root = await temporaryDirectory();
    try {
      const rawDir = join(root, 'raw');
      const firstOutput = join(root, 'gold-a');
      const secondOutput = join(root, 'gold-b');
      const frames = [
        testFrame(1, 1_000, sensitivePayload()),
        testFrame(2, 2_000, {
          ...sensitivePayload(),
          previously: { player: { name: PLAYER_NAME, clan: `${TEAM_CT} ` } },
        }),
      ];
      await writeCapture(rawDir, frames, {
        manifest: {
          notes: 'raw manifest secret should not enter gold',
          gsiConfig: {
            parameters: { timeout: 5, buffer: 1, uri: 'https://secret.invalid', future: true },
            components: ['provider', 'map'],
            auth: { token: AUTH_TOKEN },
          },
        },
      });

      const first = await sanitizeCapture({
        inputDir: rawDir,
        outputDir: firstOutput,
        scenario: 'sanitizer-regression',
        lifecycleCoverage: 'partial',
      });
      const second = await sanitizeCapture({
        inputDir: rawDir,
        outputDir: secondOutput,
        scenario: 'sanitizer-regression',
        lifecycleCoverage: 'partial',
      });

      const firstManifest = await readFile(join(firstOutput, 'manifest.json'), 'utf8');
      const secondManifest = await readFile(join(secondOutput, 'manifest.json'), 'utf8');
      const firstFrames = await readFile(join(firstOutput, 'frames.jsonl'), 'utf8');
      const secondFrames = await readFile(join(secondOutput, 'frames.jsonl'), 'utf8');
      expect(firstManifest).toBe(secondManifest);
      expect(firstFrames).toBe(secondFrames);
      expect(firstFrames.endsWith('\n')).toBe(true);
      expect(firstFrames.includes('\r')).toBe(false);

      const verified = await verifyCapture(firstOutput);
      expect(first.manifest).toEqual(second.manifest);
      expect(verified.manifest.provenance).toEqual({
        fixtureKind: 'sanitized-real-capture',
        sourceCaptureId: 'test-capture',
        sourceFramesSha256: createHash('sha256')
          .update(`${frames.map((frame) => JSON.stringify(frame)).join('\n')}\n`, 'utf8')
          .digest('hex'),
        sourceFrameSelection: { kind: 'all' },
        sanitizerVersion: 1,
        lifecycleCoverage: 'partial',
      });
      expect(verified.computedFramesSha256).toBe(verified.manifest.framesSha256);

      const firstFrame = JSON.parse(firstFrames.split('\n')[0] ?? '') as {
        payload: SanitizedPayload;
      };
      const payload = firstFrame.payload;
      expect(firstFrames).not.toContain(PLAYER_ID);
      expect(firstFrames).not.toContain(OBSERVER_ID);
      expect(firstFrames).not.toContain(PLAYER_NAME);
      expect(firstFrames).not.toContain(OBSERVER_NAME);
      expect(firstFrames).not.toContain(AUTH_TOKEN);
      expect(firstFrames).not.toContain('raw-endpoint');
      expect(payload.map.team_ct.name).toBe(payload.player.clan);
      expect(payload.map.team_ct.name).toBe(payload.previously.player.clan);
      expect(payload.map.team_t.name).not.toBe(payload.map.team_ct.name);
      expect(payload.provider.version).toBe('1.0.0');
      expect(payload.player.weapons.weapon_0.name).toBe('weapon_knife');
      const firstAllPlayerKey = Object.keys(payload.allplayers)[0] ?? '';
      const firstAllPlayer = payload.allplayers[firstAllPlayerKey];
      if (firstAllPlayer === undefined) throw new Error('sanitized allplayers is empty');
      expect(firstAllPlayer.weapons.weapon_0.name).toBe('weapon_ak47');
      expect(payload.futureEvidence).toEqual({ stableValue: 'preserve-me', stableNumber: 42 });

      expect(verified.manifest.notes).toBeUndefined();
      expect(verified.manifest.gsiConfig).toEqual({
        parameters: { timeout: 5, buffer: 1 },
        components: ['provider', 'map'],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects incomplete or dropped source captures as gold inputs', async () => {
    const root = await temporaryDirectory();
    try {
      const rawDir = join(root, 'raw');
      await writeCapture(rawDir, [testFrame(1, 1_000)], {
        manifest: { complete: false, droppedFrames: 1 },
      });
      await expect(
        sanitizeCapture({
          inputDir: rawDir,
          outputDir: join(root, 'gold'),
          scenario: 'ineligible',
          lifecycleCoverage: 'partial',
        }),
      ).rejects.toMatchObject({ code: 'INELIGIBLE_GOLD_SOURCE' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects in-place and existing output paths', async () => {
    const root = await temporaryDirectory();
    try {
      const rawDir = join(root, 'raw');
      await writeCapture(rawDir, [testFrame(1, 1_000, sensitivePayload())]);
      await expect(
        sanitizeCapture({
          inputDir: rawDir,
          outputDir: rawDir,
          scenario: 'invalid-output',
          lifecycleCoverage: 'partial',
        }),
      ).rejects.toMatchObject({ code: 'OUTPUT_PATH_INVALID' });
      const outputDir = join(root, 'gold');
      await sanitizeCapture({
        inputDir: rawDir,
        outputDir,
        scenario: 'first',
        lifecycleCoverage: 'partial',
      });
      await expect(
        sanitizeCapture({
          inputDir: rawDir,
          outputDir,
          scenario: 'second',
          lifecycleCoverage: 'partial',
        }),
      ).rejects.toMatchObject({ code: 'OUTPUT_EXISTS' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
