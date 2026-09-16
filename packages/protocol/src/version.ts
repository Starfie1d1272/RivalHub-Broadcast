export const LOCAL_PROTOCOL_VERSION = 1 as const;
export const PROGRAM_SCHEMA_VERSION = 1 as const;
export const RADAR_SCHEMA_VERSION = 1 as const;
export const OPERATOR_SCHEMA_VERSION = 1 as const;
export const ASSIST_SCHEMA_VERSION = 1 as const;

export const LOCAL_PROTOCOL_SUBPROTOCOL = 'rivalhub-broadcast.local.v1' as const;

export const LOCAL_CHANNELS = ['program', 'radar', 'operator', 'assist'] as const;
export type LocalChannel = (typeof LOCAL_CHANNELS)[number];
