import { isIP } from 'node:net';

const LOOPBACK_ORIGIN_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export interface LocalWebOriginPolicyOptions {
  readonly host?: string;
  readonly lanMode?: boolean;
  readonly allowedOrigins?: readonly string[];
}

export interface LocalWebOriginPolicy {
  readonly mode: 'loopback' | 'lan';
  readonly bindHost: string;
  readonly allowedOrigins: readonly string[];
}

export type OriginCheckResult =
  | { readonly allowed: true; readonly normalizedOrigin: string }
  | {
      readonly allowed: false;
      readonly reason: 'missing' | 'invalid' | 'not-allowed';
      readonly normalizedOrigin?: string;
    };

function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
}

export function isLoopbackBindHost(host: string): boolean {
  const normalized = normalizeHost(host);
  if (normalized === 'localhost' || normalized === '::1') return true;
  return isIP(normalized) === 4 && normalized === '127.0.0.1';
}

function normalizeAllowedOrigin(origin: string): string {
  const parsed = new URL(origin.trim());
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`LOCAL_WEB_ALLOWED_ORIGINS 只允许 http/https origin：${origin}`);
  }
  if (
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error(
      `LOCAL_WEB_ALLOWED_ORIGINS 必须是完整 origin（不含 path/query/fragment）：${origin}`,
    );
  }
  return parsed.origin;
}

export function createLocalWebOriginPolicy(
  options: LocalWebOriginPolicyOptions = {},
): LocalWebOriginPolicy {
  const bindHost = options.host?.trim() || '127.0.0.1';
  const lanMode = options.lanMode ?? false;
  const allowedOrigins = (options.allowedOrigins ?? []).map(normalizeAllowedOrigin);
  const loopback = isLoopbackBindHost(bindHost);

  if (!loopback && !lanMode) {
    throw new Error(
      `HOST=${bindHost} 不是 loopback；必须显式启用 LOCAL_WEB_LAN_MODE=1 才能启动本地 Web host`,
    );
  }
  if (lanMode && allowedOrigins.length === 0) {
    throw new Error('LOCAL_WEB_LAN_MODE=1 时必须提供至少一个 LOCAL_WEB_ALLOWED_ORIGINS origin');
  }

  return {
    mode: lanMode ? 'lan' : 'loopback',
    bindHost,
    allowedOrigins: [...new Set(allowedOrigins)],
  };
}

function normalizedHttpOrigin(origin: string): URL | undefined {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    if (parsed.username !== '' || parsed.password !== '' || parsed.pathname !== '/') {
      return undefined;
    }
    if (parsed.search !== '' || parsed.hash !== '') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function checkLocalWebOrigin(
  policy: LocalWebOriginPolicy,
  origin: string | undefined,
): OriginCheckResult {
  if (origin === undefined || origin.trim().length === 0) {
    return { allowed: false, reason: 'missing' };
  }
  const parsed = normalizedHttpOrigin(origin);
  if (parsed === undefined || parsed.origin === 'null') {
    return { allowed: false, reason: 'invalid' };
  }

  const normalizedOrigin = parsed.origin;
  if (policy.mode === 'lan') {
    return policy.allowedOrigins.includes(normalizedOrigin)
      ? { allowed: true, normalizedOrigin }
      : { allowed: false, reason: 'not-allowed', normalizedOrigin };
  }

  const hostname = normalizeHost(parsed.hostname);
  return LOOPBACK_ORIGIN_HOSTS.has(hostname)
    ? { allowed: true, normalizedOrigin }
    : { allowed: false, reason: 'not-allowed', normalizedOrigin };
}

export function parseAllowedOrigins(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === '') return [];
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
