import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';

import {
  HUD_CANVAS_HEIGHT,
  HUD_CANVAS_WIDTH,
  type HudResolvedPreset,
  type HudWidgetId,
} from '@rivalhub-broadcast/hud-config';
import type { ProgramSnapshot } from '@rivalhub-broadcast/protocol/program';

import { HudEditorOverlay } from '../program/HudEditorOverlay';
import { GameplayHud } from '../program/GameplayHud';
import type { LocalChannelConnectionState } from '../realtime';

export interface HudCanvasPreviewProps {
  readonly resolvedPreset: HudResolvedPreset;
  readonly snapshot: ProgramSnapshot | null;
  readonly connectionState: LocalChannelConnectionState;
  readonly liveSource: boolean;
  readonly selectedWidgetId: HudWidgetId | null;
  readonly showGrid: boolean;
  readonly showCenter: boolean;
  readonly showSafeArea: boolean;
  readonly onWidgetPointerDown?:
    ((widgetId: HudWidgetId, event: PointerEvent<HTMLButtonElement>) => void) | undefined;
  readonly onRadarResizePointerDown?:
    ((event: PointerEvent<HTMLButtonElement>) => void) | undefined;
}

export function HudCanvasPreview({
  resolvedPreset,
  snapshot,
  connectionState,
  liveSource,
  selectedWidgetId,
  showGrid,
  showCenter,
  showSafeArea,
  onWidgetPointerDown,
  onRadarResizePointerDown,
}: HudCanvasPreviewProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const updateScale = () => {
      const width = frameRef.current?.getBoundingClientRect().width ?? HUD_CANVAS_WIDTH;
      setScale(width / HUD_CANVAS_WIDTH);
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  const guideStyle = { width: HUD_CANVAS_WIDTH, height: HUD_CANVAS_HEIGHT } satisfies CSSProperties;

  return (
    <div className="hud-console__canvas-frame" ref={frameRef}>
      <div
        aria-label="节目 HUD 预览画布"
        className="hud-console__canvas-logical"
        style={{ transform: `scale(${scale})` }}
      >
        {showGrid ? (
          <div className="hud-console__guide hud-console__guide--grid" style={guideStyle} />
        ) : null}
        {showCenter ? (
          <div className="hud-console__guide hud-console__guide--center" style={guideStyle} />
        ) : null}
        {showSafeArea ? (
          <div className="hud-console__guide hud-console__guide--safe" style={guideStyle} />
        ) : null}
        <GameplayHud
          resolvedPreset={resolvedPreset}
          snapshot={liveSource && connectionState !== 'live' ? null : snapshot}
        />
        <HudEditorOverlay
          onRadarResizePointerDown={onRadarResizePointerDown}
          onWidgetPointerDown={onWidgetPointerDown}
          resolvedPreset={resolvedPreset}
          selectedWidgetId={selectedWidgetId}
        />
      </div>
    </div>
  );
}
