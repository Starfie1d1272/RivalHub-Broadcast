import { getMapThumbnail, getSideLogo } from '@rivalhub-broadcast/cs2-assets';
import type { CSSProperties } from 'react';

import type { HudWidgetRendererProps } from '../../hud-renderer-registry';
import { buildMatchHeaderPresentation } from './presentation';

export function SeriesStrip({ snapshot }: HudWidgetRendererProps) {
  const presentation = buildMatchHeaderPresentation(snapshot.payload);
  const maps = presentation.seriesMaps;
  if (maps === null) return null;

  return (
    <section
      aria-label="Series maps"
      className="match-header match-header__series-strip"
      data-match-header-widget="series-strip"
    >
      <div
        className="match-header__series-maps"
        role="list"
        data-series-map-count={maps.length}
        style={{ '--series-map-count': maps.length } as CSSProperties}
      >
        {maps.map((map) => {
          const decider = map.selectionText === 'DECIDER';
          const mapAsset = getMapThumbnail(map.mapKey);
          const sideLogo = map.startSide === null ? null : getSideLogo(map.startSide);
          const statusText = decider
            ? 'DECIDER'
            : map.status === 'completed'
              ? map.statusText
              : map.statusText || 'PENDING';
          return (
            <div
              aria-label={`${map.mapName} ${statusText}`}
              className={`match-header__series-map match-header__series-map--${map.status}${decider ? ' match-header__series-map--decider' : ''}`}
              data-map-order={map.mapOrder}
              data-map-status={map.status}
              key={map.mapOrder}
              role="listitem"
            >
              <div className="match-header__series-map-art">
                <div
                  aria-hidden="true"
                  className="match-header__series-map-art-image"
                  style={
                    mapAsset === null
                      ? undefined
                      : { backgroundImage: `url("${mapAsset.outputPath}")` }
                  }
                />
                {map.pickerLogoUrl === null || decider ? null : (
                  <img
                    alt=""
                    className="match-header__series-map-picker"
                    onError={(event) => {
                      event.currentTarget.style.display = 'none';
                    }}
                    src={map.pickerLogoUrl}
                  />
                )}
                {map.startSide === null || decider ? null : (
                  <span
                    aria-label={`Start side ${map.startSide}`}
                    className={`match-header__series-map-start-side match-header__series-map-start-side--${map.startSide}`}
                    data-side={map.startSide}
                    style={
                      sideLogo === null
                        ? undefined
                        : ({
                            '--match-header-side-logo': `url("${sideLogo.outputPath}")`,
                          } as CSSProperties)
                    }
                  ></span>
                )}
              </div>
              <span className="match-header__series-map-name" title={map.mapName}>
                {map.mapName}
              </span>
              <strong className="match-header__series-map-status">{statusText}</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}
