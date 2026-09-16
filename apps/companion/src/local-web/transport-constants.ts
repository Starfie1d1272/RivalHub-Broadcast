export const LOCAL_WEB_SUBPROTOCOL = 'rivalhub-broadcast.local.v1' as const;

export const LOCAL_WEB_WS_MAX_PAYLOAD_BYTES = 64 * 1024;
export const MAX_LOCAL_WS_BUFFER_BYTES = 256 * 1024;
export const MAX_LOCAL_SNAPSHOT_BYTES = 256 * 1024;
export const HEARTBEAT_INTERVAL_MS = 15_000;

export const LOCAL_WEB_ROUTES = {
  program: '/local/v1/program',
  radar: '/local/v1/radar',
  operator: '/local/v1/operator',
  assist: '/local/v1/assist',
} as const;

export type LocalWebChannel = keyof typeof LOCAL_WEB_ROUTES;
