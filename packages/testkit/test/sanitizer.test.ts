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
  readonly provider: { readonly steamid: string; readonly name: string; readonly version: string };
  readonly observer: { readonly steamid: string; readonly name: string };
  readonly map: {
    readonly team_ct: { readonly name: string };
    readonly team_t: { readonly name: string };
  };
  readonly player: {
    readonly steamid: string;
    readonly name: string;
    readonly clan: string;
    readonly weapons: { readonly weapon_0: { readonly name: string } };
  };
  readonly allplayers: Record<
    string,
    {
      readonly name: string;
      readonly clan: string;
      readonly weapons: { readonly weapon_0: { readonly name: string } };
    }
  >;
  readonly previously: { readonly player: { readonly clan: string } };
  readonly futureEvidence: {
    readonly stableValue: string;
    readonly stableNumber: number;
    readonly localPath: string;
  };
}

interface TeamSides {
  readonly team_ct: { readonly name: string };
  readonly team_t: { readonly name: string };
}

interface SideSwitchSanitizedPayload {
  readonly map: TeamSides;
  readonly player: { readonly clan: string };
  readonly previously: { readonly player: { readonly clan: string } };
  readonly added: {
    readonly map: TeamSides;
    readonly player: { readonly clan: string };
  };
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
    endpoint: 'http://127.0.0.1:3000/gsi',
    futureEvidence: {
      stableValue: 'preserve-me',
      stableNumber: 42,
      localPath: 'C:\\Users\\broadcast\\AppData\\Local\\capture.json',
    },
  };
}

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'rivalhub-testkit-sanitizer-'));
}

function sideSwitchPayload(
  teamCtName: string,
  teamTName: string,
  playerTeam: 'CT' | 'T',
  teamName: string,
): Record<string, unknown> {
  return {
    provider: { version: '1.0.0' },
    map: {
      team_ct: { name: teamCtName },
      team_t: { name: teamTName },
      phase: 'live',
    },
    player: {
      name: 'Raw Side Switch Player',
      clan: teamName,
      team: playerTeam,
    },
    previously: { player: { clan: teamName } },
    added: {
      map: {
        team_ct: { name: teamCtName },
        team_t: { name: teamTName },
      },
      player: { clan: teamName },
    },
  };
}

describe('deterministic capture sanitizer', () => {
  it('produces byte-identical sanitized output, preserves evidence, and records provenance', async () => {
    const root = await temporaryDirectory();
    try {
      const rawDir = join(root, 'raw');
      const firstOutput = join(root, 'first-sanitized-output');
      const secondOutput = join(root, 'second-sanitized-output');
      const frames = [
        testFrame(1, 1_000, sensitivePayload()),
        testFrame(2, 2_000, {
          ...sensitivePayload(),
          previously: { player: { name: PLAYER_NAME, clan: `${TEAM_CT} ` } },
        }),
      ];
      await writeCapture(rawDir, frames, {
        manifest: {
          windowsVersion: 'Windows 11 Pro for Workstations',
          notes: 'raw manifest secret should not enter sanitized output',
          gsiConfig: {
            parameters: { timeout: 5, buffer: 1, uri: 'https://example.invalid/gsi', future: true },
            components: ['provider', 'map'],
            auth: { token: AUTH_TOKEN },
            endpoint: 'http://localhost:3000/gsi',
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
        sanitizerVersion: 2,
        lifecycleCoverage: 'partial',
      });
      expect(verified.computedFramesSha256).toBe(verified.manifest.framesSha256);

      const firstFrame = JSON.parse(firstFrames.split('\n')[0] ?? '') as {
        payload: SanitizedPayload;
      };
      const payload = firstFrame.payload;
      expect(firstFrames).toContain(PLAYER_ID);
      expect(firstFrames).toContain(OBSERVER_ID);
      expect(firstFrames).toContain(PLAYER_NAME);
      expect(firstFrames).toContain(OBSERVER_NAME);
      expect(firstFrames).not.toContain(AUTH_TOKEN);
      expect(firstFrames).not.toContain('127.0.0.1');
      expect(firstFrames).not.toContain('C:\\Users\\broadcast');
      expect(payload.map.team_ct.name).toBe(TEAM_CT);
      expect(payload.map.team_t.name).toBe(TEAM_T);
      expect(payload.player).toMatchObject({
        steamid: PLAYER_ID,
        name: PLAYER_NAME,
        clan: `${TEAM_CT} `,
      });
      expect(payload.observer).toEqual({ steamid: OBSERVER_ID, name: OBSERVER_NAME });
      expect(payload.previously.player.clan).toBe(`${TEAM_CT} `);
      expect(payload.provider.version).toBe('1.0.0');
      expect(payload.player.weapons.weapon_0.name).toBe('weapon_knife');
      const firstAllPlayerKey = Object.keys(payload.allplayers)[0] ?? '';
      expect(firstAllPlayerKey).toBe(PLAYER_ID);
      const firstAllPlayer = payload.allplayers[firstAllPlayerKey];
      if (firstAllPlayer === undefined) throw new Error('sanitized allplayers is empty');
      expect(firstAllPlayer.name).toBe(PLAYER_NAME);
      expect(firstAllPlayer.clan).toBe(`${TEAM_CT} `);
      expect(firstAllPlayer.weapons.weapon_0.name).toBe('weapon_ak47');
      expect(payload.futureEvidence).toEqual({
        stableValue: 'preserve-me',
        stableNumber: 42,
        localPath: '[REDACTED_LOCAL_PATH]',
      });

      expect(verified.manifest.notes).toBeUndefined();
      expect(verified.manifest.gsiConfig).toEqual({
        parameters: { timeout: 5, buffer: 1, uri: 'https://example.invalid/gsi', future: true },
        components: ['provider', 'map'],
      });
      expect(verified.manifest.windowsVersion).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects incomplete or dropped source captures as sanitized inputs', async () => {
    const root = await temporaryDirectory();
    try {
      const rawDir = join(root, 'raw');
      await writeCapture(rawDir, [testFrame(1, 1_000)], {
        manifest: { complete: false, droppedFrames: 1 },
      });
      await expect(
        sanitizeCapture({
          inputDir: rawDir,
          outputDir: join(root, 'sanitized-output'),
          scenario: 'ineligible',
          lifecycleCoverage: 'partial',
        }),
      ).rejects.toMatchObject({ code: 'INELIGIBLE_GOLD_SOURCE' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when a credential value also appears outside its secret field', async () => {
    const root = await temporaryDirectory();
    try {
      const rawDir = join(root, 'raw');
      await writeCapture(rawDir, [
        testFrame(1, 1_000, { auth: { token: AUTH_TOKEN }, diagnosticLabel: AUTH_TOKEN }),
      ]);
      await expect(
        sanitizeCapture({
          inputDir: rawDir,
          outputDir: join(root, 'sanitized-output'),
          scenario: 'credential-leak-regression',
          lifecycleCoverage: 'partial',
        }),
      ).rejects.toMatchObject({ code: 'SANITIZATION_LEAK' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps team identity stable when sides switch between frames', async () => {
    const root = await temporaryDirectory();
    try {
      const rawDir = join(root, 'raw');
      const teamA = 'Side Switch Team A';
      const teamB = 'Side Switch Team B';
      await writeCapture(rawDir, [
        testFrame(1, 1_000, sideSwitchPayload(teamA, teamB, 'CT', teamA)),
        testFrame(2, 2_000, sideSwitchPayload(teamB, teamA, 'T', teamA)),
      ]);

      const outputDir = join(root, 'sanitized-output');
      await sanitizeCapture({
        inputDir: rawDir,
        outputDir,
        scenario: 'team-side-switch-regression',
        lifecycleCoverage: 'partial',
      });

      const frameLines = (await readFile(join(outputDir, 'frames.jsonl'), 'utf8'))
        .trim()
        .split('\n');
      expect(frameLines).toHaveLength(2);
      const payloads = frameLines.map(
        (line) => (JSON.parse(line) as { readonly payload: SideSwitchSanitizedPayload }).payload,
      );
      const first = payloads[0];
      const second = payloads[1];
      if (first === undefined || second === undefined) {
        throw new Error('side-switch regression did not produce two payloads');
      }

      const fixtureTeamA = first.map.team_ct.name;
      const fixtureTeamB = first.map.team_t.name;
      expect(fixtureTeamA).toBe(teamA);
      expect(fixtureTeamB).toBe(teamB);
      expect(fixtureTeamA).not.toBe(fixtureTeamB);

      expect(second.map.team_ct.name).toBe(fixtureTeamB);
      expect(second.map.team_t.name).toBe(fixtureTeamA);
      expect(first.player.clan).toBe(fixtureTeamA);
      expect(first.previously.player.clan).toBe(fixtureTeamA);
      expect(first.added.player.clan).toBe(fixtureTeamA);
      expect(second.player.clan).toBe(fixtureTeamA);
      expect(second.previously.player.clan).toBe(fixtureTeamA);
      expect(second.added.player.clan).toBe(fixtureTeamA);
      expect(first.added.map.team_ct.name).toBe(fixtureTeamA);
      expect(first.added.map.team_t.name).toBe(fixtureTeamB);
      expect(second.added.map.team_ct.name).toBe(fixtureTeamB);
      expect(second.added.map.team_t.name).toBe(fixtureTeamA);
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
      const outputDir = join(root, 'sanitized-output');
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
