/** Icon/progress composition adapted from Lexogrine BombTimer.tsx / PlantDefuse.tsx,
 * cs2-react-hud@7874750c97fcecd8f72eb3fad382917e035ec651 (MIT).
 * User reference choreography consumes semantic progress; no browser countdown owner. */
import { getCs2Asset, getCs2Item } from '@rivalhub-broadcast/cs2-assets';
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { MatchHeaderPresentation } from './presentation';
import type { ObjectiveCenterPresentation } from './objective-presentation';
function Icon({ id, defusing = false }: { readonly id: string; readonly defusing?: boolean }) {
  const item = getCs2Item(id);
  const asset = item === undefined ? undefined : getCs2Asset(item.assetId);
  return asset === undefined ? null : (
    <span
      role="img"
      aria-label={id === 'objective.c4' ? 'C4' : '拆弹器'}
      data-asset-id={id}
      className={`objective-center__icon${defusing ? ' is-defusing' : ''}`}
      style={{ '--objective-icon': `url("${asset.outputPath}")` } as CSSProperties}
    />
  );
}
export function ObjectiveFuse({ center }: { readonly center: ObjectiveCenterPresentation }) {
  return (
    <div
      className="objective-center__fuse"
      data-objective-track="fuse"
      data-progress={center.fuse === null ? 'unavailable' : 'determinate'}
      data-danger={center.danger}
    >
      {center.fuse === null ? null : <span style={{ width: `${center.fuse * 100}%` }} />}
    </div>
  );
}
export function ObjectiveCenter({
  presentation,
}: {
  readonly presentation: MatchHeaderPresentation;
}) {
  const c = presentation.objective;
  const previousMode = useRef(c.mode);
  const [plantedTransition, setPlantedTransition] = useState(false);
  useEffect(() => {
    if (previousMode.current === 'planting' && c.mode === 'planted') {
      setPlantedTransition(true);
      const timer = window.setTimeout(() => setPlantedTransition(false), 240);
      previousMode.current = c.mode;
      return () => window.clearTimeout(timer);
    }
    previousMode.current = c.mode;
    setPlantedTransition(false);
  }, [c.mode]);
  return (
    <div
      className="objective-center"
      data-objective-mode={c.mode}
      data-danger={c.danger}
      data-planted-transition={plantedTransition}
      data-timing-available={c.fuse !== null}
      aria-label={
        c.mode === 'planting' ? 'PLANTING' : c.mode === 'defusing' ? 'DEFUSING' : 'PLANTED'
      }
    >
      {c.mode === 'defusing' ? (
        <>
          <div
            className="objective-center__ring"
            data-objective-track="action"
            data-progress={c.action === null || c.stateOnly ? 'unavailable' : 'determinate'}
          >
            <Icon id={c.hasKit ? 'equipment.defuse-kit' : 'objective.c4'} defusing />
            <svg viewBox="0 0 64 64" aria-hidden="true">
              <circle className="objective-center__ring-track" cx="32" cy="32" r="29" />
              {c.action === null || c.stateOnly ? null : (
                <circle
                  className="objective-center__ring-fill"
                  cx="0"
                  cy="0"
                  r="29"
                  pathLength="1"
                  strokeDasharray="1"
                  strokeDashoffset={1 - c.action}
                  transform="translate(32 32) scale(-1 1) rotate(-90)"
                />
              )}
            </svg>
          </div>
          <span className="objective-center__caption" title={c.playerName ?? undefined}>
            {c.playerName ?? 'DEFUSING'}
          </span>
        </>
      ) : (
        <>
          <div className="objective-center__bomb">
            <Icon id="objective.c4" />
            <span aria-hidden="true" className="objective-center__led" />
            {c.mode === 'planting' ? (
              <div
                className="objective-center__plant-progress"
                aria-label="安装进度"
                data-objective-track="action"
                data-progress={c.action === null ? 'unavailable' : 'determinate'}
              >
                <span style={{ width: `${(c.action ?? 0) * 100}%` }} />
              </div>
            ) : null}
          </div>
          {c.stateOnly || (c.mode === 'planting' && c.action === null) ? (
            <span className="objective-center__caption">
              {c.mode === 'planting' ? 'PLANTING' : 'PLANTED'}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}
