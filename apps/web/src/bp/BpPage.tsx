import { BpImport } from './BpImport';
import { useEffect, useRef, useState } from 'react';
import { OperatorShell } from '../operator/OperatorShell';
import { BpControls } from './BpControls';
import { BpPresentation } from './BpPresentation';
import { useBpSession } from './client';

export function BpPage({ operator = false }: { readonly operator?: boolean }) {
  const { snapshot, animate } = useBpSession();
  const container = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!operator || !container.current) return;
    const observer = new ResizeObserver((entries) =>
      setScale((entries[0]?.contentRect.width ?? 1920) / 1920),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [operator]);
  const view = <BpPresentation snapshot={snapshot} animate={animate} />;
  if (!operator) return view;
  return (
    <OperatorShell active="/operator">
      <main className="operator-shell" data-surface="bp-operator">
        <header className="product-heading">
          <h1>地图禁选</h1>
          <p>一键播放，逐项展示。完整 BP 保持显示，收起后透明退场。</p>
        </header>
        <BpControls snapshot={snapshot} />
        <BpImport revision={snapshot?.revision} />
        <p>
          <a href="/program/bp" target="_blank" rel="noreferrer">
            打开 BP 播出画面 ↗
          </a>{' '}
          · OBS 浏览器源地址：<code>{window.location.origin}/program/bp</code> · 1920 × 1080
        </p>
        <div className="bp-preview" ref={container}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>{view}</div>
        </div>
        <p className="bp-preview-note">预览与 OBS 共用当前播放进度。灰色背景仅供检查透明画面。</p>
      </main>
    </OperatorShell>
  );
}
