import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAMES_DIR = path.join(__dirname, '../../public/exports/frames');

function getAllowedDemoOrigins() {
  const configuredOrigins = (process.env.VIDEO_EXPORT_ALLOWED_ORIGINS || process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set(configuredOrigins);
}

function getAllowedDemoPathPrefix() {
  return process.env.VIDEO_EXPORT_ALLOWED_PATH_PREFIX || '/demo/';
}

function getCaptureOrigin() {
  return process.env.VIDEO_EXPORT_CAPTURE_ORIGIN || process.env.CLIENT_ORIGIN || 'http://localhost:5173';
}

function buildSafeDemoUrl(demoUrl) {
  const parsed = new URL(demoUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Invalid demoUrl protocol');
  }
  if (!getAllowedDemoOrigins().has(parsed.origin)) {
    throw new Error('demoUrl origin is not allowed');
  }
  if (!parsed.pathname.startsWith(getAllowedDemoPathPrefix())) {
    throw new Error('demoUrl path is not allowed');
  }

  return new URL(`${parsed.pathname}${parsed.search}`, getCaptureOrigin()).toString();
}

export async function captureDemo({ demoUrl, resolution, fps, duration, jobId, onProgress }) {
  const resolutions = {
    '1080p': { width: 1920, height: 1080 },
    '1440p': { width: 2560, height: 1440 },
    '4k': { width: 3840, height: 2160 },
  };

  const { width, height } = resolutions[resolution] || resolutions['1080p'];
  const framesDir = path.join(FRAMES_DIR, jobId);
  fs.mkdirSync(framesDir, { recursive: true });

  let browser;
  try {
    const safeDemoUrl = buildSafeDemoUrl(demoUrl);
    const navigationTimeout = Number(process.env.VIDEO_EXPORT_NAV_TIMEOUT_MS || 30000);

    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        `--window-size=${width},${height}`,
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(safeDemoUrl, { waitUntil: 'networkidle0', timeout: navigationTimeout });

    try {
      await page.waitForSelector('[data-demo-ready]', { timeout: 5000 });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const totalFrames = Math.max(1, duration * fps);
    const frameDuration = 1000 / fps;

    for (let i = 0; i < totalFrames; i += 1) {
      const framePath = path.join(framesDir, `frame_${String(i).padStart(6, '0')}.png`);
      await page.screenshot({ path: framePath, type: 'png' });
      await new Promise((resolve) => setTimeout(resolve, frameDuration));

      if (onProgress) {
        const progress = Math.round(((i + 1) / totalFrames) * 100);
        onProgress(Math.round(progress * 0.5));
      }
    }

    return { framesDir, width, height, fps, totalFrames };
  } finally {
    if (browser) await browser.close();
  }
}
