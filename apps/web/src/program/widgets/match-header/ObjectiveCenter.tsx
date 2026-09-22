/** Icon/progress composition adapted from Lexogrine BombTimer.tsx / PlantDefuse.tsx,
 * cs2-react-hud@7874750c97fcecd8f72eb3fad382917e035ec651 (MIT).
 * User reference choreography consumes semantic progress; no browser countdown owner. */
import { getCs2Asset, getCs2Item } from '@rivalhub-broadcast/cs2-assets';
import type { CSSProperties } from 'react';
import type { MatchHeaderPresentation } from './presentation';
import type { ObjectiveCenterPresentation } from './objective-presentation';
function Icon({ id }: { readonly id: string }) {
  const item = getCs2Item(id);
  const asset = item === undefined ? undefined : getCs2Asset(item.assetId);
  return asset === undefined ? null : (
    <span
      role="img"
      aria-label={id === 'objective.c4' ? 'C4' : '拆弹器'}
      data-asset-id={id}
      className="objective-center__icon"
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
  return (
    <div
      className="objective-center"
      data-objective-mode={c.mode}
      data-danger={c.danger}
      data-timing-available={c.fuse !== null}
      aria-label={
        c.mode === 'planting' ? '正在安装 C4' : c.mode === 'defusing' ? '正在拆弹' : 'C4 已安装'
      }
    >
      {c.mode === 'defusing' ? (
        <>
          <div
            className="objective-center__ring"
            data-objective-track="action"
            data-progress={c.action === null || c.stateOnly ? 'unavailable' : 'determinate'}
          >
            <Icon id={c.hasKit ? 'equipment.defuse-kit' : 'objective.c4'} />
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
            {c.playerName ?? '拆弹中'}
          </span>
        </>
      ) : (
        <>
          <div className="objective-center__bomb">
            <Icon id="objective.c4" />
            {c.mode === 'planting' ? (
              <div
                className="objective-center__code"
                aria-label="安装进度"
                data-objective-track="action"
                data-progress={c.action === null ? 'unavailable' : 'determinate'}
              >
                {[0, 1, 2, 3].map((index) => (
                  <i key={index} data-filled={c.action !== null && c.action >= (index + 1) / 4} />
                ))}
              </div>
            ) : null}
          </div>
          {c.stateOnly || (c.mode === 'planting' && c.action === null) ? (
            <span className="objective-center__caption">
              {c.mode === 'planting' ? '安装中' : '已安装'}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}
