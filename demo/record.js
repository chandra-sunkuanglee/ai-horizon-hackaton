// Records the demo: drives the live dashboard in headless Chrome, one scene per narration line.
// Each scene lasts at least as long as its narration; actual start times go to timeline.json
// so build.py can place the audio exactly.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = "http://127.0.0.1:8000/";
const W = 1600, H = 900;
const GAP = 0.3; // seconds of breathing room after each narration line
const durations = JSON.parse(fs.readFileSync(path.join(HERE, "durations.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// AI Horizons Pittsburgh logo (black background; "lighten" blends it into the dark cards).
const LOGO = `data:image/png;base64,${fs.readFileSync(path.join(HERE, "logo.png")).toString("base64")}`;
const logo = (h) => `<img src="${LOGO}" style="height:${h}px;mix-blend-mode:lighten;display:block;margin:0 0 26px -6px">`;

// A visible cursor (headless Chrome has none) that follows mouse events and pulses on click.
const CURSOR = `
(() => {
  const add = () => {
    if (document.getElementById("__cur")) return;
    const c = document.createElement("div");
    c.id = "__cur";
    c.style.cssText = "position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;" +
      "background:rgba(255,255,255,.85);border:2px solid #2a78d6;box-shadow:0 0 0 4px rgba(42,120,214,.25);" +
      "pointer-events:none;z-index:2147483647;transition:transform .12s;transform:translate(-100px,-100px)";
    document.documentElement.appendChild(c);
    let x = -100, y = -100, s = 1;
    const put = () => (c.style.transform = "translate(" + x + "px," + y + "px) scale(" + s + ")");
    addEventListener("mousemove", (e) => { x = e.clientX; y = e.clientY; put(); }, true);
    addEventListener("mousedown", () => { s = 0.6; put(); }, true);
    addEventListener("mouseup", () => { s = 1; put(); }, true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", add); else add();
})();`;

const card = (inner) => `<!doctype html><html><head><style>
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#111110;color:#fff;
       font-family:"Segoe UI",system-ui,sans-serif}
  .wrap{max-width:1180px;padding:0 60px} h1{font-size:54px;margin:0 0 12px;letter-spacing:-.02em}
  h2{font-size:30px;margin:0 0 28px;color:#c3c2b7;font-weight:500} p{font-size:24px;color:#c3c2b7;margin:8px 0}
  .kick{color:#3987e5;font-size:22px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;margin-bottom:18px}
  .row{display:flex;gap:22px;margin-top:30px;flex-wrap:wrap}
  .box{flex:1;min-width:250px;background:#1a1a19;border:1px solid #2e2e2c;border-radius:14px;padding:22px 24px}
  .box b{display:block;font-size:34px;margin-bottom:6px} .box span{color:#c3c2b7;font-size:19px}
  .arrow{align-self:center;font-size:34px;color:#8f8e86} ul{font-size:23px;color:#c3c2b7;line-height:1.55;margin:0;padding-left:26px}
  .ok{color:#fff} .two{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:10px}
  h3{font-size:24px;margin:0 0 10px}
</style></head><body><div class="wrap">${inner}</div></body></html>`;

const CARDS = {
  s01_intro: card(`${logo(92)}<div class="kick">Hackathon submission · Housing track</div>
    <h1>Allegheny County Housing Sales Dashboard</h1>
    <h2>AI-powered map &amp; Q&amp;A over 10 years of property sales, honest about data quality</h2>
    <p>Chandra · M.S. Artificial Intelligence Systems Management · Carnegie Mellon University</p>`),
  s02_problem: card(`<h1>Messy public data → trustworthy answers</h1>
    <div class="row">
      <div class="box"><b>367,767</b><span>raw county sale records, 2016–2026</span></div>
      <div class="arrow">→</div>
      <div class="box"><b>257,760</b><span>clean priced sales (no $1 deeds, gifts, duplicates)</span></div>
      <div class="arrow">→</div>
      <div class="box"><b>82,179</b><span>assessor-validated arm's-length sales</span></div>
    </div>
    <div class="row">
      <div class="box"><b style="font-size:24px">1 · Cleaning pipeline</b><span>pandas, documented step by step</span></div>
      <div class="box"><b style="font-size:24px">2 · Map + dashboard</b><span>585,925 parcels → 175 shapes; FastAPI + React</span></div>
      <div class="box"><b style="font-size:24px">3 · Claude Q&amp;A</b><span>tool-using agent over the clean data</span></div>
    </div>`),
  s12_honest: card(`<h1>What's real, what's not</h1>
    <div class="two">
      <div><h3>✅ Working, not mocked</h3><ul class="ok">
        <li>Data cleaning pipeline</li><li>Interactive map from parcel boundaries</li>
        <li>Every chart and table (live API)</li><li>Claude answers via real tool calls</li>
        <li>Data-quality reporting</li></ul></div>
      <div><h3>⚠️ Limitations</h3><ul>
        <li>Runs locally; not deployed yet</li><li>No property-type field: medians mix houses, condos, land</li>
        <li>2026 is a partial year (to Sep 21)</li><li>Claude once drew a wrong conclusion from correct numbers</li>
        <li>Built with Claude Code as coding assistant</li></ul></div>
    </div>`),
  s13_outro: card(`${logo(64)}<div class="kick">Next steps</div>
    <h1>Deploy · Property types · Compare your home</h1>
    <h2>Thank you for watching!</h2>
    <p>Chandra · Carnegie Mellon University · AI Horizons Pittsburgh</p>`),
};

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: W, height: H },
  colorScheme: "dark",
  recordVideo: { dir: path.join(HERE, "raw"), size: { width: W, height: H } },
});
await context.addInitScript(CURSOR);
const page = await context.newPage();
const t0 = Date.now();
const timeline = [];

async function moveTo(x, y, steps = 30) {
  await page.mouse.move(x, y, { steps });
}
async function moveToEl(locator, dx = 0.5, dy = 0.5) {
  const b = await locator.boundingBox();
  await moveTo(b.x + b.width * dx, b.y + b.height * dy);
}
async function clickEl(locator) {
  await locator.scrollIntoViewIfNeeded();
  await moveToEl(locator);
  await sleep(250);
  await locator.click();
}
async function smoothScrollTo(selector, offset = 20) {
  await page.evaluate(([sel, off]) => {
    const el = document.querySelector(sel);
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - off, behavior: "smooth" });
  }, [selector, offset]);
  await sleep(1400);
}
async function scrollChat(to, ms = 3000) {
  await page.evaluate(([target, dur]) => {
    const el = document.querySelector(".chat-log");
    const start = el.scrollTop, end = target === "bottom" ? el.scrollHeight : target;
    const t = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t) / dur);
      el.scrollTop = start + (end - start) * (0.5 - Math.cos(Math.PI * k) / 2);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [to, ms]);
  await sleep(ms + 200);
}
async function waitForAnswer(timeout = 240000) {
  // The chat input is disabled while Claude is working.
  await page.waitForFunction(() => {
    const i = document.querySelector(".chat-input input");
    return i && !i.disabled;
  }, null, { timeout, polling: 500 });
}
// Page coordinates of a map place (by name) or of the n-th sale dot.
async function placePoint(name) {
  return page.evaluate((n) => {
    const el = document.querySelector(".map");
    let pt = null;
    el.__shapes.eachLayer((l) => {
      if (l.feature?.properties.name === n) pt = el.__map.latLngToContainerPoint(l.getBounds().getCenter());
    });
    const r = el.getBoundingClientRect();
    return pt && { x: r.left + pt.x, y: r.top + pt.y };
  }, name);
}
async function dotPoint(i) {
  return page.evaluate((idx) => {
    const el = document.querySelector(".map");
    const dots = el.__points ? el.__points.getLayers() : [];
    const r = el.getBoundingClientRect();
    const inView = dots
      .map((d) => el.__map.latLngToContainerPoint(d.getLatLng()))
      .filter((p) => p.x > 320 && p.x < r.width - 330 && p.y > 80 && p.y < r.height - 60);
    const p = inView[Math.min(idx, inView.length - 1)];
    return p && { x: r.left + p.x, y: r.top + p.y };
  }, i);
}
async function scene(id, fn) {
  const start = (Date.now() - t0) / 1000;
  console.log(`[${start.toFixed(1)}s] ${id}`);
  await fn();
  const minEnd = start + durations[id] + GAP;
  const now = (Date.now() - t0) / 1000;
  if (now < minEnd) await sleep((minEnd - now) * 1000);
  timeline.push({ id, start });
}

await scene("s01_intro", async () => { await page.setContent(CARDS.s01_intro); });
await scene("s02_problem", async () => { await page.setContent(CARDS.s02_problem); });

await scene("s03_overview", async () => {
  await page.goto(APP);
  await page.waitForSelector(".leaflet-overlay-pane canvas", { state: "attached" });
  await page.waitForFunction(() => document.querySelectorAll("table.muni tbody tr").length > 0);
  await sleep(1500);
  await moveToEl(page.locator(".filterbar .seg").first()); await sleep(2800);
  await moveToEl(page.locator(".filterbar select").first()); await sleep(1500);
  await moveToEl(page.locator(".filterbar select").nth(1)); await sleep(1500);
  await moveToEl(page.locator(".presets")); await sleep(2500);
  await moveToEl(page.locator(".tile").first(), 0.4, 0.55); await sleep(3500);
  await moveToEl(page.locator(".tile").nth(1), 0.4, 0.55); await sleep(3000);
});

await scene("s04_map", async () => {
  await smoothScrollTo(".map-card", 78);
  for (const name of ["22nd Ward - PITTSBURGH", "Fox Chapel", "Penn Hills", "Sewickley Heights", "Mt.Lebanon"]) {
    const p = await placePoint(name);
    if (p) { await moveTo(p.x, p.y, 45); await sleep(3200); }
  }
});

await scene("s05_click", async () => {
  const p = await placePoint("Mt.Lebanon");
  await moveTo(p.x, p.y, 15);
  await sleep(300);
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(() => document.querySelector(".map").__points, null, { timeout: 15000 });
  await sleep(2500);
  await moveToEl(page.locator(".map-detail .detail-grid")); await sleep(4500);
  for (const i of [5, 60]) {
    const d = await dotPoint(i);
    if (d) {
      await moveTo(d.x, d.y, 35);
      await sleep(300);
      await page.mouse.click(d.x, d.y);
      await sleep(3800);
    }
  }
});

await scene("s06_years", async () => {
  await page.keyboard.press("Escape");
  // Zoom back out so the whole county is visible for "about half the county turns grey".
  await page.evaluate(() => {
    document.querySelector(".map").__map.flyToBounds(
      [
        [40.2, -80.36],
        [40.67, -79.69],
      ],
      { paddingTopLeft: [240, 10], duration: 1.2 }
    );
  });
  await sleep(1600);
  await clickEl(page.locator(".map-panel").getByRole("button", { name: "Price change" }));
  await sleep(9000);
  await clickEl(page.locator(".filterbar").getByRole("button", { name: "All priced" }));
  await sleep(6500);
  await clickEl(page.getByRole("button", { name: "Since 2020" }));
  await sleep(3000);
  await moveToEl(page.locator(".tiles .tile").nth(1), 0.4, 0.55);
  await sleep(2000);
});

await scene("s07_charts", async () => {
  await moveTo(700, 500);
  await smoothScrollTo("main > section.card:nth-of-type(3)", 20);
  const surf = page.locator("main > section.card:nth-of-type(3) .recharts-surface");
  const b = await surf.boundingBox();
  for (const fx of [0.25, 0.6, 0.9]) { await moveTo(b.x + b.width * fx, b.y + b.height * 0.45, 40); await sleep(1600); }
  await smoothScrollTo("table.muni", 170);
  await moveToEl(page.locator("table.muni tbody tr").nth(2)); await sleep(2000);
  await moveToEl(page.locator("table.muni tbody tr").nth(6)); await sleep(1500);
});

await scene("s08_quality", async () => {
  await moveTo(700, 450);
  await smoothScrollTo("summary", 420);
  await clickEl(page.locator("summary", { hasText: "coverage by year" }));
  await sleep(800);
  await page.evaluate(() => window.scrollBy({ top: 330, behavior: "smooth" }));
  await sleep(2500);
});

await scene("s09_ask", async () => {
  await smoothScrollTo(".map-card", 78);
  await sleep(500);
  await clickEl(page.locator(".map-detail .btn"));
  await sleep(3000);
  await moveToEl(page.locator(".steps summary").first()).catch(() => {});
});

await scene("s10_answer", async () => {
  await waitForAnswer();
  await sleep(600);
  await clickEl(page.locator(".steps summary").first());
  await sleep(1500);
  await moveTo(1300, 500);
  await scrollChat("bottom", 8000);
});

await scene("s11_followup", async () => {
  await clickEl(page.locator(".chat-input input"));
  await page.keyboard.type("What about Haysville? Is its trend reliable?", { delay: 40 });
  await sleep(300);
  await page.keyboard.press("Enter");
  await sleep(1500);
  await waitForAnswer();
  await sleep(500);
  const bots = page.locator(".msg.bot");
  const last = bots.nth((await bots.count()) - 1);
  await page.evaluate((top) => (document.querySelector(".chat-log").scrollTop = top),
    await last.evaluate((el) => el.offsetTop - 20));
  await sleep(1200);
  await scrollChat("bottom", 5000);
});

await scene("s12_honest", async () => { await page.setContent(CARDS.s12_honest); });
await scene("s13_outro", async () => { await page.setContent(CARDS.s13_outro); await sleep(800); });

const videoPath = await page.video().path();
await context.close();
await browser.close();
fs.writeFileSync(path.join(HERE, "timeline.json"), JSON.stringify({ video: videoPath, scenes: timeline }, null, 2));
console.log("video:", videoPath);
