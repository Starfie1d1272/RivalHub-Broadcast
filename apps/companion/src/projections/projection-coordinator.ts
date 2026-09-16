import {
  identityEvidenceFromObservation,
  createIdentityResolver,
  type IdentityResolution,
  type IdentityResolver,
} from '@rivalhub-broadcast/core/identity';
import {
  projectObserverAssist,
  projectProgram,
  selectProgramSafeRuntimeView,
  type ObserverAssistProjection,
  type ProgramProjection,
} from '@rivalhub-broadcast/core/projection';
import type { RuntimeReduceResult } from '@rivalhub-broadcast/core/runtime';
import { assistSnapshotSchema, type AssistSnapshot } from '@rivalhub-broadcast/protocol/assist';
import {
  operatorSnapshotSchema,
  type OperatorSnapshot,
} from '@rivalhub-broadcast/protocol/operator';
import { programSnapshotSchema, type ProgramSnapshot } from '@rivalhub-broadcast/protocol/program';
import { radarSnapshotSchema, type RadarSnapshot } from '@rivalhub-broadcast/protocol/radar';
import {
  ASSIST_SCHEMA_VERSION,
  LOCAL_PROTOCOL_VERSION,
  OPERATOR_SCHEMA_VERSION,
  PROGRAM_SCHEMA_VERSION,
  RADAR_SCHEMA_VERSION,
} from '@rivalhub-broadcast/protocol/version';
import { projectRadarFrame, type RadarFrame } from '@rivalhub-broadcast/radar';

import type { MatchContextBinding } from '../match-context/index.js';
import type { CstvSourceManagers } from '../telemetry/cstv-source-manager.js';
import type { ProgramRuntime } from '../runtime/program-runtime.js';
import {
  createLocalChannelPublisher,
  type LocalChannelPublisher,
} from '../local-protocol/channel-publisher.js';
import { mapObserverAssistProjection } from '../local-protocol/assist-wire.js';
import { mapOperatorProjection } from '../local-protocol/operator-wire.js';
import { mapProgramProjection } from '../local-protocol/program-wire.js';
import { mapRadarFrame } from '../local-protocol/radar-wire.js';
import { projectOperator, type OperatorProjection } from './operator-projection.js';

export interface ProjectionBundle {
  readonly program: ProgramProjection;
  readonly radar: RadarFrame;
  readonly operator: OperatorProjection;
  readonly assist: ObserverAssistProjection;
  readonly identity: IdentityResolution;
}

export interface ProjectionPublishers {
  readonly program?: LocalChannelPublisher<ProgramSnapshot>;
  readonly radar?: LocalChannelPublisher<RadarSnapshot>;
  readonly operator?: LocalChannelPublisher<OperatorSnapshot>;
  readonly assist?: LocalChannelPublisher<AssistSnapshot>;
}

export interface ProjectionCoordinatorOptions {
  readonly programRuntime: ProgramRuntime;
  readonly cstvSources: CstvSourceManagers;
  readonly identityResolver?: IdentityResolver;
  readonly matchContextBinding?: MatchContextBinding;
  readonly nowMonotonicMs?: () => number;
  readonly publishers?: ProjectionPublishers;
  readonly onDiagnostic?: (diagnostic: { readonly code: string }) => void;
}

const defaultNowMonotonicMs = (): number => globalThis.performance?.now() ?? Date.now();

function defaultPublishers(
  onDiagnostic: ((diagnostic: { readonly code: string }) => void) | undefined,
): Required<ProjectionPublishers> {
  const diagnosticOption = onDiagnostic === undefined ? {} : { onDiagnostic };
  return {
    program: createLocalChannelPublisher({
      id: 'program',
      schema: programSnapshotSchema,
      ...diagnosticOption,
    }),
    radar: createLocalChannelPublisher({
      id: 'radar',
      schema: radarSnapshotSchema,
      ...diagnosticOption,
    }),
    operator: createLocalChannelPublisher({
      id: 'operator',
      schema: operatorSnapshotSchema,
      ...diagnosticOption,
    }),
    assist: createLocalChannelPublisher({
      id: 'assist',
      schema: assistSnapshotSchema,
      ...diagnosticOption,
    }),
  };
}

function mergePublishers(
  publishers: ProjectionPublishers | undefined,
  onDiagnostic: ((diagnostic: { readonly code: string }) => void) | undefined,
): Required<ProjectionPublishers> {
  const defaults = defaultPublishers(onDiagnostic);
  return {
    program: publishers?.program ?? defaults.program,
    radar: publishers?.radar ?? defaults.radar,
    operator: publishers?.operator ?? defaults.operator,
    assist: publishers?.assist ?? defaults.assist,
  };
}

function report(
  onDiagnostic: ((diagnostic: { readonly code: string }) => void) | undefined,
  code: string,
): void {
  try {
    onDiagnostic?.({ code });
  } catch {
    // Projection diagnostics must not interrupt the Runtime mutation path.
  }
}

export class ProjectionCoordinator {
  private readonly programRuntime: ProgramRuntime;
  private readonly cstvSources: CstvSourceManagers;
  private readonly identityResolver: IdentityResolver;
  private readonly nowMonotonicMs: () => number;
  private readonly publishers: Required<ProjectionPublishers>;
  private readonly onDiagnostic: ((diagnostic: { readonly code: string }) => void) | undefined;
  private contextBinding: MatchContextBinding | undefined;
  private boundMatchId: string | undefined;
  private lastIdentityEvidence:
    { readonly sourceGeneration: number; readonly receiveSequence: number } | undefined;
  private current: ProjectionBundle;

  constructor(options: ProjectionCoordinatorOptions) {
    this.programRuntime = options.programRuntime;
    this.cstvSources = options.cstvSources;
    this.identityResolver = options.identityResolver ?? createIdentityResolver();
    this.nowMonotonicMs = options.nowMonotonicMs ?? defaultNowMonotonicMs;
    this.onDiagnostic = options.onDiagnostic;
    this.publishers = mergePublishers(options.publishers, options.onDiagnostic);
    this.contextBinding = options.matchContextBinding;
    if (this.contextBinding !== undefined) {
      this.identityResolver.bind(this.contextBinding.context);
      this.boundMatchId = this.contextBinding.context.matchId;
    }
    this.current = this.refresh();
  }

  setMatchContextBinding(binding: MatchContextBinding | undefined): ProjectionBundle {
    this.contextBinding = binding;
    if (binding === undefined) {
      this.boundMatchId = undefined;
      this.lastIdentityEvidence = undefined;
      this.identityResolver.unbind();
    } else {
      this.identityResolver.bind(binding.context);
      this.boundMatchId = binding.context.matchId;
      this.lastIdentityEvidence = undefined;
    }
    return this.refresh();
  }

  afterRuntimeMutation(result?: RuntimeReduceResult): ProjectionBundle {
    if (result !== undefined && result.disposition.kind !== 'accepted') return this.current;
    return this.refresh();
  }

  refresh(): ProjectionBundle {
    const runtimeSnapshot = this.programRuntime.getSnapshot();
    const runtimeState = runtimeSnapshot.current;
    const runtimeView = selectProgramSafeRuntimeView(runtimeState);
    const identity = this.resolveIdentity(runtimeSnapshot);
    const nowMonotonicMs = this.nowMonotonicMs();
    const context = this.contextBinding?.context;
    const program = projectProgram({
      runtime: runtimeView,
      ...(context === undefined ? {} : { context }),
      ...(this.contextBinding === undefined
        ? {}
        : { contextFreshness: this.contextBinding.freshness }),
      identity,
      nowMonotonicMs,
      continuityPolicy: runtimeSnapshot.continuityPolicy,
    });
    const radar = projectRadarFrame({
      runtime: runtimeView,
      identity,
      nowMonotonicMs,
      continuityPolicy: runtimeSnapshot.continuityPolicy,
    });
    const operator = projectOperator({
      runtime: runtimeSnapshot,
      context: this.contextBinding,
      identity,
      cstvSources: this.cstvSources,
      nowMonotonicMs,
    });
    const assist = projectObserverAssist(runtimeView);
    this.current = { program, radar, operator, assist, identity };
    this.publish(program, radar, operator, assist);
    return this.current;
  }

  getCurrent(): ProjectionBundle {
    return this.current;
  }

  getPublisher(channel: 'program'): LocalChannelPublisher<ProgramSnapshot>;
  getPublisher(channel: 'radar'): LocalChannelPublisher<RadarSnapshot>;
  getPublisher(channel: 'operator'): LocalChannelPublisher<OperatorSnapshot>;
  getPublisher(channel: 'assist'): LocalChannelPublisher<AssistSnapshot>;
  getPublisher(
    channel: keyof ProjectionPublishers,
  ): LocalChannelPublisher<ProgramSnapshot | RadarSnapshot | OperatorSnapshot | AssistSnapshot> {
    return this.publishers[channel];
  }

  async close(): Promise<void> {
    await Promise.all([
      this.publishers.program.close(),
      this.publishers.radar.close(),
      this.publishers.operator.close(),
      this.publishers.assist.close(),
    ]);
  }

  private resolveIdentity(
    runtimeSnapshot: ReturnType<ProgramRuntime['getSnapshot']>,
  ): IdentityResolution {
    if (this.contextBinding === undefined) {
      this.boundMatchId = undefined;
      return this.identityResolver.unbind();
    }

    if (this.boundMatchId !== this.contextBinding.context.matchId) {
      this.identityResolver.bind(this.contextBinding.context);
      this.boundMatchId = this.contextBinding.context.matchId;
    }

    const observation = runtimeSnapshot.current.programTelemetry;
    const cursor = runtimeSnapshot.current.programSource.lastAccepted;
    const currentGeneration = runtimeSnapshot.current.programSource.generation;
    const currentReceiveSequence =
      cursor?.generation === currentGeneration ? cursor.sequence : undefined;
    if (
      observation === undefined ||
      cursor === undefined ||
      cursor.generation !== currentGeneration
    ) {
      this.identityResolver.bind(this.contextBinding.context);
      return this.identityResolver.getResolution();
    }

    const currentResolution = this.identityResolver.getResolution();
    const evidenceIsNew =
      currentReceiveSequence !== undefined &&
      (this.lastIdentityEvidence === undefined ||
        this.lastIdentityEvidence.sourceGeneration !== currentGeneration ||
        this.lastIdentityEvidence.receiveSequence !== currentReceiveSequence);
    if (
      (currentResolution.sourceGeneration !== currentGeneration ||
        currentResolution.mapEpoch !== runtimeSnapshot.current.map.epoch) &&
      !evidenceIsNew
    ) {
      this.identityResolver.bind(this.contextBinding.context);
      return this.identityResolver.getResolution();
    }

    const resolution = this.identityResolver.resolve(
      identityEvidenceFromObservation(
        observation,
        currentGeneration,
        runtimeSnapshot.current.map.epoch,
      ),
    );
    if (currentReceiveSequence !== undefined) {
      this.lastIdentityEvidence = {
        sourceGeneration: currentGeneration,
        receiveSequence: currentReceiveSequence,
      };
    }
    return resolution;
  }

  private publish(
    program: ProgramProjection,
    radar: RadarFrame,
    operator: OperatorProjection,
    assist: ObserverAssistProjection,
  ): void {
    this.publishChannel('program', () =>
      this.publishers.program.publish({
        type: 'snapshot',
        protocolVersion: LOCAL_PROTOCOL_VERSION,
        channel: 'program',
        schemaVersion: PROGRAM_SCHEMA_VERSION,
        cursor: program.cursor,
        payload: mapProgramProjection(program),
      }),
    );
    this.publishChannel('radar', () =>
      this.publishers.radar.publish({
        type: 'snapshot',
        protocolVersion: LOCAL_PROTOCOL_VERSION,
        channel: 'radar',
        schemaVersion: RADAR_SCHEMA_VERSION,
        cursor: radar.cursor,
        payload: mapRadarFrame(radar),
      }),
    );
    this.publishChannel('operator', () =>
      this.publishers.operator.publish({
        type: 'snapshot',
        protocolVersion: LOCAL_PROTOCOL_VERSION,
        channel: 'operator',
        schemaVersion: OPERATOR_SCHEMA_VERSION,
        cursor: operator.cursor,
        payload: mapOperatorProjection(operator),
      }),
    );
    this.publishChannel('assist', () =>
      this.publishers.assist.publish({
        type: 'snapshot',
        protocolVersion: LOCAL_PROTOCOL_VERSION,
        channel: 'assist',
        schemaVersion: ASSIST_SCHEMA_VERSION,
        cursor: assist.cursor,
        payload: mapObserverAssistProjection(assist),
      }),
    );
  }

  private publishChannel(channel: string, publish: () => void): void {
    try {
      publish();
    } catch {
      report(this.onDiagnostic, `${channel}-wire-validation-failed`);
    }
  }
}

export function createProjectionCoordinator(
  options: ProjectionCoordinatorOptions,
): ProjectionCoordinator {
  return new ProjectionCoordinator(options);
}
