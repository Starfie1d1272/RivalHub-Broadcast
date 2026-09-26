import { useEffect, useState } from 'react';
import { bpSnapshotSchema, type BpSnapshot } from '@rivalhub-broadcast/protocol/bp';

export function useBpSession() {
  const [value, setValue] = useState<{ snapshot: BpSnapshot | null; animate: boolean }>({
    snapshot: null,
    animate: false,
  });
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    let etag: string | null = null;
    let baseline = true;
    async function poll() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 1500);
      try {
        const response = await fetch('/local/v1/bp', {
          signal: controller.signal,
          headers: etag === null ? {} : { 'If-None-Match': etag },
        });
        if (response.status !== 304) {
          if (!response.ok) throw new Error('BP unavailable');
          const snapshot = bpSnapshotSchema.parse(await response.json());
          if (active) {
            const animate = !baseline;
            setValue({ snapshot, animate });
            etag = response.headers.get('etag');
            baseline = false;
          }
        }
      } catch {
        if (active) {
          setValue({ snapshot: null, animate: false });
          etag = null;
          baseline = true;
        }
      } finally {
        clearTimeout(timeout);
        if (active) timer = setTimeout(() => void poll(), 250);
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
    };
  }, []);
  return value;
}

export async function sendBpCommand(kind: 'play' | 'hide', expectedRevision: string) {
  const response = await fetch('/operator/bp-command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, expectedRevision }),
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? 'BP 状态已更新，请核对后重试。'
        : '操作未确认，请检查连接和当前状态。',
    );
}
