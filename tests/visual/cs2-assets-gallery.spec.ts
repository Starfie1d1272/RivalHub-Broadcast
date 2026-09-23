import { expect, test } from '@playwright/test';

interface ManifestAssetEntry {
  readonly outputPath: string;
  readonly mediaType: string;
  readonly tintMode: string;
}

interface ManifestPayload {
  readonly assets: Record<string, ManifestAssetEntry>;
}

test.describe('CS2 official asset mask rendering gallery', () => {
  test('renders all 72 official CS2 assets via Chromium CSS mask with zero failed requests', async ({
    page,
  }) => {
    const failedRequests: string[] = [];
    const successfulSvgRequests = new Set<string>();

    page.on('requestfailed', (request) => {
      failedRequests.push(request.url());
    });

    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/assets/cs2/') && url.endsWith('.svg')) {
        if (response.status() === 200) {
          successfulSvgRequests.add(url);
        } else {
          failedRequests.push(`${url} (status ${response.status()})`);
        }
      }
    });

    // 1. Fetch real /assets/cs2/manifest.json at runtime
    const manifestResponse = await page.request.get('/assets/cs2/manifest.json');
    expect(manifestResponse.status()).toBe(200);
    const manifest = (await manifestResponse.json()) as ManifestPayload;

    const assetEntries: [string, ManifestAssetEntry][] = Object.entries(manifest.assets);
    expect(assetEntries).toHaveLength(72);

    // 2. Build deterministic gallery HTML page
    const tilesHtml = assetEntries
      .map(([assetId, asset]) => {
        return `
        <div class="tile" data-asset-id="${assetId}">
          <div class="asset-mask" style="mask-image: url('${asset.outputPath}'); -webkit-mask-image: url('${asset.outputPath}');"></div>
          <div class="label">${assetId}</div>
        </div>
      `;
      })
      .join('\n');

    const fullHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>CS2 Official Asset Mask Gallery</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background-color: #0b0e14;
            color: #d1d5db;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
            padding: 24px;
            width: 1920px;
            height: 1080px;
            overflow: hidden;
          }
          h1 {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 16px;
            color: #f3f4f6;
          }
          .grid {
            display: grid;
            grid-template-columns: repeat(12, 1fr);
            gap: 8px;
            width: 100%;
          }
          .tile {
            background: #151a23;
            border: 1px solid #232a36;
            border-radius: 4px;
            padding: 8px 4px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 96px;
          }
          .asset-mask {
            width: 56px;
            height: 48px;
            background-color: #e5e7eb;
            mask-repeat: no-repeat;
            -webkit-mask-repeat: no-repeat;
            mask-position: center;
            -webkit-mask-position: center;
            mask-size: contain;
            -webkit-mask-size: contain;
          }
          .label {
            font-size: 9px;
            margin-top: 6px;
            color: #9ca3af;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 100%;
          }
        </style>
      </head>
      <body>
        <div id="gallery-container">
          <h1>CS2 Official Assets Mask Gallery (72 Assets)</h1>
          <div class="grid">
            ${tilesHtml}
          </div>
        </div>
      </body>
      </html>
    `;

    // Navigate to origin first to establish base URL context
    await page.goto('/program?fixture=awaiting-neutral');
    await page.setContent(fullHtml, { waitUntil: 'networkidle' });

    // 3. Assertions
    expect(failedRequests).toEqual([]);
    expect(successfulSvgRequests.size).toBe(72);

    // Verify computed style for each tile mask
    const tileMasks = page.locator('.asset-mask');
    const maskCount = await tileMasks.count();
    expect(maskCount).toBe(72);

    for (let i = 0; i < maskCount; i++) {
      const maskImage = await tileMasks.nth(i).evaluate((el) => {
        const style = window.getComputedStyle(el);
        return style.maskImage || style.webkitMaskImage;
      });
      expect(maskImage).not.toBe('none');
      expect(maskImage).toContain('url(');
    }

    // 4. Visual snapshot baseline
    await expect(page.locator('#gallery-container')).toHaveScreenshot(
      'cs2-assets-mask-gallery.png',
      {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixels: 0,
        scale: 'css',
        threshold: 0,
      },
    );
  });
});
