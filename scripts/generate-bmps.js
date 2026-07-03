const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'resources');
const svg = fs.readFileSync(path.join(ROOT, 'shiryu-ai-studio.svg'), 'utf8');

const bigSizes = [
  { name: 'inno-big-100.bmp', w: 164, h: 314 },
  { name: 'inno-big-125.bmp', w: 192, h: 386 },
  { name: 'inno-big-150.bmp', w: 246, h: 459 },
  { name: 'inno-big-175.bmp', w: 273, h: 556 },
  { name: 'inno-big-200.bmp', w: 328, h: 604 },
  { name: 'inno-big-225.bmp', w: 355, h: 700 },
  { name: 'inno-big-250.bmp', w: 410, h: 797 },
];

const smallSizes = [
  { name: 'inno-small-100.bmp', w: 55, h: 55 },
  { name: 'inno-small-125.bmp', w: 64, h: 68 },
  { name: 'inno-small-150.bmp', w: 83, h: 80 },
  { name: 'inno-small-175.bmp', w: 92, h: 97 },
  { name: 'inno-small-200.bmp', w: 110, h: 106 },
  { name: 'inno-small-225.bmp', w: 119, h: 123 },
  { name: 'inno-small-250.bmp', w: 138, h: 140 },
];

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Users/OkashiKami/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
  });
  const page = await browser.newPage();

  // Generate big BMPs (sidebar - flame on dark bg, centered vertically)
  for (const { name, w, h } of bigSizes) {
    const iconSize = Math.min(w - 20, Math.floor(h * 0.6));
    const sizedSvg = svg
      .replace('width="512"', `width="${iconSize}"`)
      .replace('height="512"', `height="${iconSize}"`);

    const html = `<!DOCTYPE html><html><head><style>
      * { margin: 0; padding: 0; }
      body { background: #0a0e27; width: ${w}px; height: ${h}px; display: flex; align-items: center; justify-content: center; }
    </style></head><body>${sizedSvg}</body></html>`;

    await page.setViewportSize({ width: w, height: h });
    await page.setContent(html, { waitUntil: 'networkidle' });

    const buf = await page.screenshot({ type: 'png', omitBackground: false });
    const outPath = path.join(ROOT, 'win32', name);
    fs.writeFileSync(outPath, buf);
    console.log(`Created: ${name} (${w}x${h})`);
  }

  // Generate small BMPs (header - just the icon)
  for (const { name, w, h } of smallSizes) {
    const iconSize = Math.min(w, h);
    const sizedSvg = svg
      .replace('width="512"', `width="${iconSize}"`)
      .replace('height="512"', `height="${iconSize}"`);

    const html = `<!DOCTYPE html><html><head><style>
      * { margin: 0; padding: 0; }
      body { background: transparent; width: ${w}px; height: ${h}px; display: flex; align-items: center; justify-content: center; }
    </style></head><body>${sizedSvg}</body></html>`;

    await page.setViewportSize({ width: w, height: h });
    await page.setContent(html, { waitUntil: 'networkidle' });

    const buf = await page.screenshot({ type: 'png', omitBackground: true });
    const outPath = path.join(ROOT, 'win32', name);
    fs.writeFileSync(outPath, buf);
    console.log(`Created: ${name} (${w}x${h})`);
  }

  await browser.close();
  console.log('All BMP PNGs generated! (Convert to BMP next)');
})();
