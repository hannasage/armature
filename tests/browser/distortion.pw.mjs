// Measures the two ways to stop the children of a scaled element from stretching, in a real browser, and prints numbers.
//   counter: the parent scales, and each child scales by the inverse, with the individual properties `scale`.
//   size: the parent's width and height animate, and nothing scales.
// It also measures a plain scale with no fix, for a base. The numbers go into docs/baseline.md, section "G6 build".
import { launch, report } from "./harness.mjs";

const COUNTS = [10, 100, 1000];
const FRAMES = 120;
const SIBLINGS = 300;

const page_html = (n) => `<!doctype html><meta charset=utf-8><style>
body{margin:0;font:14px sans-serif}
#card{position:relative;margin:20px;width:400px;height:300px;overflow:visible;background:#eee}
.s{width:400px;height:24px;margin:0 20px}
#card div.c{width:60px;height:20px;margin:2px;background:#789;display:inline-block;overflow:hidden;white-space:nowrap}
#size div.c{width:auto}
</style><div id=card>${Array.from({ length: n }, (_, i) => `<div class=c>c${i}</div>`).join("")}</div>${Array.from({ length: SIBLINGS }, (_, i) => `<div class=s>row ${i}</div>`).join("")}`;

async function metrics(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const pick = (name) => metrics.find((m) => m.name === name)?.value ?? 0;
  return { layoutCount: pick("LayoutCount"), layoutMs: pick("LayoutDuration") * 1000, recalcCount: pick("RecalcStyleCount"), recalcMs: pick("RecalcStyleDuration") * 1000, scriptMs: pick("ScriptDuration") * 1000, taskMs: pick("TaskDuration") * 1000 };
}

const browser = await launch();
const results = { frames: FRAMES, shape: `parent 400x300 in flow, ${SIBLINGS} rows below it, scale x 0.5 and y 1.5 at the start, children 60x20`, runs: [] };
const problems = [];
try {
  for (const n of COUNTS) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    await page.setContent(page_html(n));
    for (const mode of ["plain", "counter", "size"]) {
      await page.evaluate(() => { document.getElementById("card").removeAttribute("style"); document.querySelectorAll(".c").forEach((c) => c.removeAttribute("style")); });
      const before = await metrics(cdp);
      const out = await page.evaluate(async ({ mode, frames }) => {
        const card = document.getElementById("card");
        const kids = [...card.children];
        const natural = kids[0].getBoundingClientRect();
        const writeMs = [];
        let worst = 0;
        let child = { width: natural.width, height: natural.height };
        for (let f = 0; f < frames; f++) {
          await new Promise((r) => requestAnimationFrame(r));
          const t = 1 - f / (frames - 1);
          const sx = 1 - 0.5 * t, sy = 1 + 0.5 * t;
          const start = performance.now();
          if (mode === "size") { card.style.width = 400 * sx + "px"; card.style.height = 300 * sy + "px"; }
          else {
            card.style.scale = `${sx} ${sy}`;
            if (mode === "counter") for (const k of kids) k.style.scale = `${1 / sx} ${1 / sy}`;
          }
          writeMs.push(performance.now() - start);
          if (f === 0) {
            // The first frame is the inverted pose. Read the rendered child once, then go on.
            const r = kids[0].getBoundingClientRect();
            child = { width: r.width, height: r.height };
          }
          worst = Math.max(worst, f === 0 ? Math.max(Math.abs(child.width / natural.width - 1), Math.abs(child.height / natural.height - 1)) : 0);
        }
        writeMs.sort((a, b) => a - b);
        return { childWidthAtStart: child.width, childHeightAtStart: child.height, naturalWidth: natural.width, naturalHeight: natural.height, stretch: worst, writeMedianMs: writeMs[writeMs.length >> 1], writeMaxMs: writeMs[writeMs.length - 1] };
      }, { mode, frames: FRAMES });
      const after = await metrics(cdp);
      results.runs.push({
        children: n, mode, ...out,
        layoutsPerFrame: (after.layoutCount - before.layoutCount) / FRAMES,
        layoutMsPerFrame: (after.layoutMs - before.layoutMs) / FRAMES,
        recalcsPerFrame: (after.recalcCount - before.recalcCount) / FRAMES,
        recalcMsPerFrame: (after.recalcMs - before.recalcMs) / FRAMES,
        scriptMsPerFrame: (after.scriptMs - before.scriptMs) / FRAMES,
      });
    }
    await context.close();
  }
} finally {
  await browser.close();
}
const by = (n, mode) => results.runs.find((r) => r.children === n && r.mode === mode);
for (const n of COUNTS) {
  if (by(n, "counter").stretch > 0.001) problems.push(`counter-scale leaves the child stretched by ${by(n, "counter").stretch} with ${n} children`);
  if (by(n, "plain").stretch < 0.4) problems.push(`the plain scale shows no stretch with ${n} children, so the experiment measures nothing`);
}
report(results, problems);
