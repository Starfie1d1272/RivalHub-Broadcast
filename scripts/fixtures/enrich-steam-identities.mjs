import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const fixtureDirectory = fileURLToPath(
  new URL('../../fixtures/gsi/acceptance/ancient-round-03/', import.meta.url),
);
const assetDirectory = fileURLToPath(
  new URL('../../apps/web/public/fixtures/ancient-round-03/assets/', import.meta.url),
);
const manifestPath = join(fixtureDirectory, 'manifest.json');
const framesPath = join(fixtureDirectory, 'frames.jsonl');
const enrichmentPath = join(fixtureDirectory, 'steam-enrichment.json');
const API_ENDPOINT = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

async function readIdentityRoster() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (
    manifest.provenance?.fixtureKind !== 'sanitized-real-capture' ||
    manifest.provenance?.sanitizerVersion !== 2 ||
    manifest.provenance?.sourceCaptureId !== '20260914T060149Z-4cda66b7-recovered-match' ||
    manifest.provenance?.sourceFrameSelection?.kind !== 'sequence-range' ||
    manifest.provenance.sourceFrameSelection.firstSequence !== 587 ||
    manifest.provenance.sourceFrameSelection.lastSequence !== 1214
  ) {
    throw new Error('Steam enrichment only accepts the fixed #76 Ancient round 3 capture.');
  }

  const frameBytes = await readFile(framesPath);
  const frameHash = createHash('sha256').update(frameBytes).digest('hex');
  if (frameHash !== manifest.framesSha256)
    throw new Error('Acceptance capture hash does not match its manifest.');

  const ids = new Set();
  const input = createInterface({ input: createReadStream(framesPath), crlfDelay: Infinity });
  for await (const line of input) {
    if (line.length === 0) continue;
    const frame = JSON.parse(line);
    const players = frame.payload?.allplayers;
    if (!players || typeof players !== 'object' || Array.isArray(players)) continue;
    for (const id of Object.keys(players)) if (/^\d{17}$/.test(id)) ids.add(id);
  }
  if (ids.size !== 10) throw new Error('Expected ten real Steam64 values in the fixed capture.');
  return { manifest, steam64s: [...ids].sort() };
}

async function fetchPlayerSummaries(steam64s, apiKey) {
  const url = new URL(API_ENDPOINT);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('steamids', steam64s.join(','));
  let response;
  try {
    response = await globalThis.fetch(url, { headers: { accept: 'application/json' } });
  } catch (error) {
    const code = typeof error?.cause?.code === 'string' ? ` (${error.cause.code})` : '';
    // eslint-disable-next-line preserve-caught-error -- the original error may retain the URL containing the local API key.
    throw new Error(`Steam Web API request failed${code}; request details were suppressed.`);
  }
  if (!response.ok) throw new Error(`Steam Web API returned HTTP ${response.status}.`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('Steam Web API returned invalid JSON.');
  }
  const players = body?.response?.players;
  if (!Array.isArray(players)) throw new Error('Steam Web API response omitted player summaries.');
  const byId = new Map(players.map((player) => [String(player.steamid), player]));
  if (steam64s.some((steam64) => !byId.has(steam64))) {
    throw new Error('Steam Web API did not return every requested Steam64.');
  }
  return steam64s.map((steam64) => {
    const player = byId.get(steam64);
    if (
      typeof player.personaname !== 'string' ||
      typeof player.avatarfull !== 'string' ||
      !player.avatarfull.startsWith('https://')
    ) {
      throw new Error('Steam Web API returned incomplete public profile data.');
    }
    return { steam64, personaName: player.personaname, avatarfull: player.avatarfull };
  });
}

async function downloadAvatar(player) {
  let response;
  try {
    response = await globalThis.fetch(player.avatarfull, { headers: { accept: 'image/*' } });
  } catch {
    throw new Error('Steam avatar download failed; request details were suppressed.');
  }
  if (!response.ok) throw new Error(`Steam avatar returned HTTP ${response.status}.`);
  const mediaType = response.headers.get('content-type')?.split(';')[0]?.toLowerCase();
  const extension =
    mediaType === 'image/jpeg'
      ? 'jpg'
      : mediaType === 'image/png'
        ? 'png'
        : mediaType === 'image/webp'
          ? 'webp'
          : undefined;
  if (extension === undefined) throw new Error('Steam avatar has an unsupported image format.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > 5_000_000)
    throw new Error('Steam avatar size is invalid.');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const file = `avatar-${player.steam64}-${sha256.slice(0, 12)}.${extension}`;
  await writeFile(join(assetDirectory, file), bytes, { flag: 'wx' }).catch(async (error) => {
    if (error?.code === 'EEXIST') {
      const existing = await readFile(join(assetDirectory, file));
      if (createHash('sha256').update(existing).digest('hex') === sha256) return;
    }
    throw new Error('Could not materialize Steam avatar asset.');
  });
  return {
    assetPath: `apps/web/public/fixtures/ancient-round-03/assets/${file}`,
    publicUrl: `/fixtures/ancient-round-03/assets/${file}`,
    sha256,
    sourceUrl: player.avatarfull,
    mediaType,
  };
}

try {
  const apiKey = process.env.STEAM_WEB_API_KEY;
  if (!apiKey) throw new Error('Set STEAM_WEB_API_KEY in the local environment before importing.');
  if (!/^[A-Fa-f0-9]{32}$/.test(apiKey))
    throw new Error('STEAM_WEB_API_KEY has an invalid format.');

  const { manifest, steam64s } = await readIdentityRoster();
  const profiles = await fetchPlayerSummaries(steam64s, apiKey);
  await mkdir(assetDirectory, { recursive: true });
  const players = [];
  for (const profile of profiles) {
    const avatar = await downloadAvatar(profile);
    players.push({ steam64: profile.steam64, personaName: profile.personaName, avatar });
  }
  const enrichment = {
    schemaVersion: 1,
    source: {
      captureId: manifest.provenance.sourceCaptureId,
      sourceFramesSha256: manifest.provenance.sourceFramesSha256,
      sourceFrameSelection: manifest.provenance.sourceFrameSelection,
      endpoint: 'ISteamUser/GetPlayerSummaries/v2',
      apiKeySource: 'STEAM_WEB_API_KEY environment variable',
    },
    players,
  };
  const temporaryPath = `${enrichmentPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(enrichment, null, 2)}\n`, { flag: 'wx' });
  await rename(temporaryPath, enrichmentPath);
  process.stdout.write(
    `Materialized Steam profile enrichment for ${players.length} capture identities.\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : 'Steam enrichment failed.';
  fail(message);
}
