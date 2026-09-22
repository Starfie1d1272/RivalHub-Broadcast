import type { HudWidgetRendererProps } from '../../hud-renderer-registry';

import { buildMatchHeaderPresentation } from './presentation';

/**
 * Presentation adaptation based on Eon maps-sleek at
 * a37326cd59d37dc6c157832ba06b01c232d878e1 (ISC), using the compact per-map
 * cell and current/finished/pending hierarchy from maps-sleek.html/css/js.
 * The Vue option tree, raw match state, map-image assumptions, and name-based
 * current-map inference are intentionally omitted.
 */

export function SeriesStrip({ snapshot }: HudWidgetRendererProps) {
  const presentation = buildMatchHeaderPresentation(snapshot.payload);
  if (presentation.seriesMaps === null) return null;

  return (
    <section
      aria-label="系列赛地图"
      className="match-header match-header__series-strip"
      data-match-header-widget="series-strip"
    >
      <div className="match-header__series-maps" role="list">
        {presentation.seriesMaps.map((map) => (
          <div
            aria-label={`${map.mapName}，${map.winnerName === null ? map.statusText : `${map.winnerName} ${map.statusText} ✓`}`}
            className={`match-header__series-map match-header__series-map--${map.status}${
              map.winner === null ? '' : ` match-header__series-map--winner-${map.winner}`
            }`}
            data-map-order={map.mapOrder}
            data-map-status={map.status}
            key={map.mapOrder}
            role="listitem"
          >
            <span className="match-header__series-map-name" title={map.mapName}>
              {map.mapName}
            </span>
            {map.pickerLogoUrl ? (
              <img alt="" className="match-header__series-map-picker" src={map.pickerLogoUrl} />
            ) : null}
            {map.startSide ? (
              <span
                aria-label={`开始方 ${map.startSide}`}
                className={`match-header__series-map-start-side match-header__series-map-start-side--${map.startSide}`}
              >
                {map.startSide}
              </span>
            ) : null}
            <span className="match-header__series-map-selection" title={map.selectionText}>
              {map.selectionText}
            </span>
            <strong
              className={`match-header__series-map-status${
                map.winnerName === null ? '' : ' match-header__series-map-status--winner'
              }`}
            >
              {map.winnerName === null ? (
                map.statusText
              ) : (
                <>
                  <span className="match-header__series-map-winner-name" title={map.winnerName}>
                    {map.winnerName}
                  </span>
                  <span className="match-header__series-map-winner-score">{map.statusText}</span>
                  <span aria-label="WIN" className="match-header__series-map-winner-mark">
                    ✓
                  </span>
                </>
              )}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}
