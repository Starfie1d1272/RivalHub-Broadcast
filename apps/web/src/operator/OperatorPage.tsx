import { useState, useSyncExternalStore } from 'react';
import type { FormEvent } from 'react';

import type { OperatorSnapshot } from '@rivalhub-broadcast/protocol/operator';

import { type LocalChannelConnectionState, useLocalChannelClient } from '../realtime';

type OperatorSeriesProgress = NonNullable<OperatorSnapshot['payload']['seriesProgress']>;

function connectionStateLabel(state: LocalChannelConnectionState): string {
  switch (state) {
    case 'live':
      return '已连接';
    case 'connecting':
      return '正在连接';
    case 'awaiting-baseline':
      return '等待初始状态';
    case 'reconnecting':
      return '正在重连';
    case 'protocol-error':
      return '协议不兼容';
    case 'closed':
      return '已关闭';
    default:
      return '未启动';
  }
}

function seriesBindingLabel(bindingState: OperatorSeriesProgress['bindingState']): string {
  switch (bindingState) {
    case 'bound':
      return '已绑定';
    case 'needs_operator':
      return '等待 Operator 确认';
    case 'unbound':
      return '未绑定';
  }
}

export function OperatorPage() {
  const client = useLocalChannelClient('operator');
  const connection = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const snapshot = connection.current;
  const series = snapshot?.payload.seriesProgress ?? null;
  const [mapOrder, setMapOrder] = useState('1');
  const [reason, setReason] = useState('');
  const [commandState, setCommandState] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setCommandState(null);
    try {
      const response = await fetch('/operator/series/bind', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          kind: 'bind-current-map-execution-to-series-map',
          mapOrder: Number(mapOrder),
          reason,
        }),
      });
      const body = (await response.json()) as { readonly code?: string; readonly error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? body.code ?? `HTTP ${response.status}`);
      }
      setCommandState(`命令已确认：${body.code ?? 'operator_bind_applied'}`);
    } catch (error: unknown) {
      setCommandState(`命令未执行：${error instanceof Error ? error.message : '请求失败'}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="operator-shell" data-surface="operator">
      <header className="operator-header">
        <p className="operator-eyebrow">RivalHub Broadcast / 制作控制</p>
        <h1>先确认，再继续。</h1>
        <p>
          这里显示 SeriesProgress 的绑定与恢复诊断。异常地图不会自动猜测；只有明确的 Operator
          命令才会恢复绑定。
        </p>
      </header>

      <nav aria-label="制播页面" className="shell__nav">
        <a href="/program">正式节目</a>
        <a aria-current="page" href="/operator">
          制作控制
        </a>
        <a href="/operator/hud">HUD 控制台</a>
        <a href="/debug">运行诊断</a>
      </nav>

      <section aria-label="Operator 连接状态" className="operator-status">
        <span>本地实时连接</span>
        <strong data-connection-state={connection.state}>
          {connectionStateLabel(connection.state)}
        </strong>
        <span>
          {series === null
            ? 'SeriesProgress：未建立'
            : `BO${series.requiredWins === 1 ? '1' : series.requiredWins === 2 ? '3' : '5'}`}
        </span>
      </section>

      <section aria-label="SeriesProgress 状态" className="operator-panel">
        <header>
          <span>01 / SeriesProgress</span>
          <h2>{series === null ? '等待比赛上下文' : seriesBindingLabel(series.bindingState)}</h2>
        </header>
        {series === null ? (
          <p>当前没有已绑定的 MatchContext。</p>
        ) : (
          <>
            <dl className="operator-metrics">
              <div>
                <dt>系列比分</dt>
                <dd>
                  {series.score.a} : {series.score.b}
                </dd>
              </div>
              <div>
                <dt>当前地图序号</dt>
                <dd>{series.currentMapOrder ?? '—'}</dd>
              </div>
              <div>
                <dt>地图计划</dt>
                <dd>{series.maps.map((map) => `${map.mapOrder}:${map.status}`).join(' · ')}</dd>
              </div>
            </dl>
            <div className="operator-issues" aria-live="polite">
              <h3>当前诊断</h3>
              {series.issues.length === 0 ? (
                <p>没有待处理诊断。</p>
              ) : (
                <ul>
                  {series.issues.map((issue, index) => (
                    <li key={`${issue.code}-${issue.mapOrder ?? 'series'}-${index}`}>
                      <strong>{issue.code}</strong>：{issue.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>

      <form className="operator-panel operator-form" onSubmit={(event) => void submit(event)}>
        <header>
          <span>02 / OperatorCommand</span>
          <h2>绑定当前地图执行</h2>
        </header>
        <label>
          计划地图序号
          <input
            min="1"
            max="5"
            onChange={(event) => setMapOrder(event.target.value)}
            required
            type="number"
            value={mapOrder}
          />
        </label>
        <label>
          确认理由
          <textarea
            maxLength={512}
            onChange={(event) => setReason(event.target.value)}
            required
            rows={3}
            value={reason}
          />
        </label>
        <button disabled={submitting} type="submit">
          {submitting ? '提交中…' : '确认绑定'}
        </button>
        {commandState === null ? null : <p role="status">{commandState}</p>}
      </form>
    </main>
  );
}
