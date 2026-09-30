// Renders the SVG app icon to the PNG sizes required for PWA installability.
// Dev-only helper (uses the pre-installed Chromium via Playwright). Run: node scripts/render-icons.mjs
import { chromium } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

const svg = readFileSync('client/public/icons/icon.svg', 'utf8');
// Use the pre-installed Chromium when present (CI/cloud images), else Playwright's own.
const preinstalled = '/opt/pw-browsers/chromium';
const executablePath = process.env.CHROMIUM_PATH || (existsSync(preinstalled) ? preinstalled : undefined);
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();
for (const [size, file, pad] of [
  [192, 'icon-192.png', 0],
  [512, 'icon-512.png', 0],
  [512, 'icon-maskable-512.png', 56],
]) {
  await page.setViewportSize({ width: size, height: size });
  const inner = size - pad * 2;
  await page.setContent(
    `<html><body style="margin:0;background:#0f2a4a;display:grid;place-items:center;width:${size}px;height:${size}px">
     <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
  );
  await page.screenshot({ path: `client/public/icons/${file}`, omitBackground: false });
  console.log('wrote', file);
}
await browser.close();
