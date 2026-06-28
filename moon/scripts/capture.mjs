import { statSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const DEFAULT_URL = process.env.GODOGEN_CAPTURE_URL ?? "http://127.0.0.1:5173";
const DEFAULT_WIDTH = Number.parseInt(process.env.GODOGEN_CAPTURE_WIDTH ?? "1280", 10);
const DEFAULT_HEIGHT = Number.parseInt(process.env.GODOGEN_CAPTURE_HEIGHT ?? "720", 10);
const DEFAULT_FPS = Number.parseInt(process.env.GODOGEN_CAPTURE_FPS ?? "30", 10);

const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|lavapipe|software|softpipe|mesa offscreen/i;

if (
  process.platform !== "darwin" &&
  !process.env.DISPLAY &&
  !process.env.WAYLAND_DISPLAY &&
  process.env.GODOGEN_UNDER_XVFB !== "1" &&
  process.env.GODOGEN_CAPTURE_NO_XVFB !== "1"
) {
  const result = spawnSync(
    "xvfb-run",
    ["-a", "-s", "-screen 0 1920x1080x24", process.execPath, ...process.argv.slice(1)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        GODOGEN_UNDER_XVFB: "1",
        GODOGEN_CAPTURE_HEADLESS: "0"
      }
    }
  );

  if (result.error) {
    console.error(
      `[capture] ${result.error.code === "ENOENT" ? "xvfb-run is required when no display is available" : result.error.message}`
    );
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

function usage() {
  console.error(`Usage:
  node scripts/capture.mjs still <png-path> [url]
  node scripts/capture.mjs frames <out-dir> <frame-count> [url] [fps]
  node scripts/capture.mjs video <out-dir> <seconds> [url]`);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    process.env.GOOGLE_CHROME_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (statSyncFile(candidate)) return candidate;
    } catch {
      // Continue scanning candidates.
    }
  }

  throw new Error(
    "No Chrome/Chromium executable found. Install Chrome/Chromium or set CHROME_BIN."
  );
}

function statSyncFile(path) {
  return statSync(path).isFile();
}

async function launchBrowser(recordDir) {
  const executablePath = findChrome();
  const headless = process.env.GODOGEN_CAPTURE_HEADLESS === "1";
  const browser = await chromium.launch({
    executablePath,
    headless,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--enable-features=Vulkan,VulkanFromANGLE",
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      "--use-angle=vulkan"
    ]
  });

  const context = await browser.newContext({
    viewport: { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
    deviceScaleFactor: 1,
    recordVideo: recordDir
      ? {
          dir: recordDir,
          size: { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
        }
      : undefined
  });

  return { browser, context };
}

async function openPage(context, url) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas", { state: "visible", timeout: 10_000 });
  await page.waitForTimeout(500);

  const gpu = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      return { ok: false, reason: "No canvas element found" };
    }

    const gl = canvas.getContext("webgl2");
    if (!gl) {
      return { ok: false, reason: "WebGL2 context is unavailable" };
    }

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    const vendor = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
      : gl.getParameter(gl.VENDOR);

    return {
      ok: true,
      renderer: String(renderer),
      vendor: String(vendor),
      width: canvas.width,
      height: canvas.height
    };
  });

  if (!gpu.ok) {
    throw new Error(gpu.reason);
  }

  if (SOFTWARE_RENDERERS.test(`${gpu.vendor} ${gpu.renderer}`)) {
    console.warn(
      `[capture] WARNING: WebGL2 is on a software renderer (${gpu.vendor} / ${gpu.renderer}). Capture continues but is slower and lower quality. If this host has a GPU, fix the browser GPU setup; if not, this is the best available path.`
    );
  } else {
    console.log(`[capture] WebGL2 renderer: ${gpu.vendor} / ${gpu.renderer}`);
  }
  return page;
}

async function captureStill(path, url) {
  await mkdir(dirname(path), { recursive: true });
  const { browser, context } = await launchBrowser();
  try {
    const page = await openPage(context, url);
    await page.screenshot({ path });
    console.log(`[capture] wrote ${path}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function captureFrames(outDir, frameCount, url, fps) {
  await mkdir(outDir, { recursive: true });
  const { browser, context } = await launchBrowser();
  try {
    const page = await openPage(context, url);
    const frameMs = 1000 / fps;
    for (let idx = 0; idx < frameCount; idx += 1) {
      const path = join(outDir, `frame${String(idx + 1).padStart(5, "0")}.png`);
      await page.screenshot({ path });
      await delay(frameMs);
    }
    console.log(`[capture] wrote ${frameCount} frames to ${outDir}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function captureVideo(outDir, seconds, url) {
  await mkdir(outDir, { recursive: true });
  const { browser, context } = await launchBrowser(outDir);
  let page;
  try {
    page = await openPage(context, url);
    console.log(`[capture] recording ${seconds}s from ${url}`);
    await page.waitForTimeout(seconds * 1000);
  } finally {
    await context.close();
    await browser.close();
  }

  const video = page?.video();
  if (!video) {
    throw new Error("Playwright did not produce a browser video");
  }

  const tmpVideo = await video.path();
  const target = join(outDir, "video.webm");
  await rename(tmpVideo, target);
  console.log(`[capture] wrote ${target}`);
}

const [mode, arg1, arg2, arg3, arg4] = process.argv.slice(2);

try {
  if (mode === "still" && arg1) {
    await captureStill(resolve(arg1), arg2 ?? DEFAULT_URL);
  } else if (mode === "frames" && arg1 && arg2) {
    await captureFrames(
      resolve(arg1),
      Number.parseInt(arg2, 10),
      arg3 ?? DEFAULT_URL,
      arg4 ? Number.parseInt(arg4, 10) : DEFAULT_FPS
    );
  } else if (mode === "video" && arg1 && arg2) {
    await captureVideo(resolve(arg1), Number.parseFloat(arg2), arg3 ?? DEFAULT_URL);
  } else {
    usage();
    process.exitCode = 2;
  }
} catch (error) {
  console.error(`[capture] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
