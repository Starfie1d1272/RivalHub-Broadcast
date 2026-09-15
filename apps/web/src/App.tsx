import { useEffect, useState } from 'react';

import {
  formatDebugJson,
  numberValue,
  parseDebugRuntimeResponse,
  recordValue,
  stringValue,
  type DebugFreshness,
  type DebugRuntimeResponse,
} from './debug/runtime';

export const surfaceDefinitions = [
  {
    id: 'program',
    path: '/program',
    title: 'Program',
    description: '节目输出占位页面。真实 scene 与 HUD 属于后续 milestone。',
  },
  {
    id: 'operator',
    path: '/operator',
    title: 'Operator',
    description: '导播控制占位页面。真实运行控制属于后续 milestone。',
  },
  {
    id: 'debug',
    path: '/debug',
    title: 'Debug',
    description: '查看 Companion 当前的输入、归一化结果、运行时状态与退化信号。',
  },
] as const;

export type SurfaceDefinition = (typeof surfaceDefinitions)[number];

export function surfaceForPath(pathname: string): SurfaceDefinition {
  return surfaceDefinitions.find((surface) => surface.path === pathname) ?? surfaceDefinitions[0];
}

export function SurfacePage({ surface }: { readonly surface: SurfaceDefinition }) {
  return (
    <main className="shell" data-surface={surface.id}>
      <header className="shell__header">
        <p className="shell__eyebrow">RivalHub Broadcast</p>
        <h1>{surface.title}</h1>
        <p>{surface.description}</p>
      </header>

      <nav aria-label="Broadcast surfaces" className="shell__nav">
        {surfaceDefinitions.map((definition) => (
          <a
            aria-current={definition.path === surface.path ? 'page' : undefined}
            href={definition.path}
            key={definition.path}
          >
            {definition.title}
          </a>
        ))}
      </nav>

      <p className="shell__note">工程 shell 已就绪；本页面暂不连接运行时数据。</p>
    </main>
  );
}

type DebugFetchState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: DebugRuntimeResponse }
  | { readonly kind: 'error'; readonly message: string };

const DEBUG_POLL_INTERVAL_MS = 1_000;

function freshnessLabel(freshness: DebugFreshness): string {
  switch (freshness) {
    case 'fresh':
      return 'Fresh';
    case 'stale':
      return 'Stale';
    case 'awaiting':
      return 'Awaiting GSI';
  }
}

function useDebugRuntime(): DebugFetchState {
  const [state, setState] = useState<DebugFetchState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const poll = async (): Promise<void> => {
      try {
        const response = await fetch('/debug/runtime', {
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`Companion HTTP ${response.status}`);
        const parsed = parseDebugRuntimeResponse(await response.json());
        if (parsed === undefined) throw new Error('响应结构无法识别');
        if (active) setState({ kind: 'ready', data: parsed });
      } catch (error: unknown) {
        if (active) {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : '无法连接 Companion',
          });
        }
      } finally {
        if (active) timer = window.setTimeout(() => void poll(), DEBUG_POLL_INTERVAL_MS);
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return state;
}

function DebugNav() {
  return (
    <nav aria-label="Broadcast surfaces" className="debug-nav">
      {surfaceDefinitions.map((definition) => (
        <a
          aria-current={definition.id === 'debug' ? 'page' : undefined}
          href={definition.path}
          key={definition.path}
        >
          {definition.title}
        </a>
      ))}
    </nav>
  );
}

function DebugMetric({
  label,
  value,
  note,
  tone = 'neutral',
}: {
  readonly label: string;
  readonly value: string;
  readonly note: string;
  readonly tone?: 'neutral' | 'signal' | 'warning';
}) {
  return (
    <article className="debug-metric" data-tone={tone}>
      <span className="debug-metric__label">{label}</span>
      <strong>{value}</strong>
      <span className="debug-metric__note">{note}</span>
    </article>
  );
}

function DebugEvidencePanel({
  eyebrow,
  title,
  value,
  tone = 'neutral',
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly value: unknown;
  readonly tone?: 'neutral' | 'signal' | 'warning';
}) {
  return (
    <article className="debug-panel" data-tone={tone}>
      <header className="debug-panel__header">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </header>
      <pre className="debug-panel__body">{formatDebugJson(value)}</pre>
    </article>
  );
}

function DebugContent({ data }: { readonly data: DebugRuntimeResponse }) {
  const runtime = data.runtime.current;
  const map = recordValue(runtime, 'map');
  const recorder = data.recorderHealth;
  const runtimeSeq = numberValue(runtime, 'runtimeSeq');
  const mapEpoch = numberValue(map, 'epoch');
  const mapName = stringValue(map, 'name') ?? '未建立';
  const receiveSequence = numberValue(data.raw.current, 'sequence');
  const statusTone = data.freshness === 'stale' ? 'warning' : 'signal';

  return (
    <>
      <section aria-label="Runtime summary" className="debug-metrics">
        <DebugMetric
          label="Source freshness"
          note={`generation ${data.sourceGeneration ?? '—'}`}
          tone={statusTone}
          value={freshnessLabel(data.freshness)}
        />
        <DebugMetric
          label="Runtime sequence"
          note={`map epoch ${mapEpoch ?? '—'}`}
          value={runtimeSeq === undefined ? '—' : String(runtimeSeq)}
        />
        <DebugMetric label="Current map" note="Program source" value={mapName} />
        <DebugMetric
          label="Receive sequence"
          note={`recorder ${stringValue(recorder, 'state') ?? 'unknown'}`}
          value={receiveSequence === undefined ? '—' : String(receiveSequence)}
        />
      </section>

      <section className="debug-evidence-grid" aria-label="Current evidence">
        <DebugEvidencePanel
          eyebrow="01 / ingress"
          title="Accepted raw"
          tone="signal"
          value={data.raw.current}
        />
        <DebugEvidencePanel
          eyebrow="02 / adapter"
          title="Normalized observation"
          value={data.normalized.current}
        />
        <DebugEvidencePanel
          eyebrow="03 / core"
          title="Runtime state"
          value={data.runtime.current}
        />
      </section>

      <section className="debug-lower-grid" aria-label="Runtime diagnostics">
        <DebugEvidencePanel
          eyebrow="04 / continuity"
          title="Recent transitions"
          value={data.recentTransitions}
        />
        <DebugEvidencePanel
          eyebrow="05 / health"
          title="Recorder & delivery"
          value={{ recorder: data.recorderHealth, delivery: data.deliveryHealth }}
        />
        <DebugEvidencePanel
          eyebrow="06 / diagnostics"
          title="Latest adapter batch"
          tone={data.latestGsiDiagnostics === null ? 'neutral' : 'warning'}
          value={data.latestGsiDiagnostics}
        />
        <DebugEvidencePanel
          eyebrow="07 / companion"
          title="Recent runtime diagnostics"
          tone={data.recentRuntimeDiagnostics.length === 0 ? 'neutral' : 'warning'}
          value={data.recentRuntimeDiagnostics}
        />
      </section>

      <p className="debug-footer-note">
        producer <code>{data.producerInstanceId ?? '未创建'}</code>
        <span aria-hidden="true"> · </span>
        raw / normalized / runtime 均为当前 bounded evidence；此页面不保存历史快照。
      </p>
    </>
  );
}

export function DebugPage() {
  const state = useDebugRuntime();

  return (
    <main className="debug-shell" data-surface="debug">
      <header className="debug-header">
        <div className="debug-header__signal" aria-hidden="true">
          <span>LOCAL</span>
          <i />
          <span>RUNTIME</span>
        </div>
        <div>
          <p className="debug-eyebrow">RivalHub Broadcast / diagnostic instrument</p>
          <h1>看见每一帧如何抵达。</h1>
          <p className="debug-intro">
            Companion 的当前证据面：从已接收的 raw frame，到 adapter，再到唯一 RuntimeState。
          </p>
        </div>
      </header>

      <DebugNav />

      {state.kind === 'loading' ? (
        <section className="debug-state" aria-live="polite">
          <span className="debug-state__mark">…</span>
          <div>
            <h2>正在连接 Companion</h2>
            <p>等待第一份诊断快照。</p>
          </div>
        </section>
      ) : null}

      {state.kind === 'error' ? (
        <section className="debug-state debug-state--error" role="alert">
          <span className="debug-state__mark">!</span>
          <div>
            <h2>Companion 暂不可用</h2>
            <p>{state.message}。页面会继续每秒重试。</p>
          </div>
        </section>
      ) : null}

      {state.kind === 'ready' ? <DebugContent data={state.data} /> : null}
    </main>
  );
}

export function App() {
  const surface = surfaceForPath(window.location.pathname);
  return surface.id === 'debug' ? <DebugPage /> : <SurfacePage surface={surface} />;
}
