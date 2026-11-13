// Checks the built /layout entry in a real browser. Every number is read from the rendered page with getBoundingClientRect, and not from source.
//   npm run build
//   PLAYWRIGHT_CORE=<folder that holds playwright-core> PW_CHANNEL=chrome node tests/browser/layout.pw.mjs
// It prints one JSON object: the measured numbers, and the list of problems. It exits 1 when a check fails.
import { launch, report, serve } from "./harness.mjs";

const HTML = `<!doctype html><meta charset=utf-8><style>
body{margin:0}
#box{position:absolute;left:20px;top:20px;width:100px;height:50px;background:#789}
#box.moved{left:300px;top:150px;width:200px;height:100px}
#box.back{left:20px;top:20px;width:100px;height:50px}
#kid{width:100%;height:20px;background:#345}
#a{position:absolute;left:30px;top:40px;width:120px;height:60px;background:#a55}
#b{position:absolute;left:420px;top:260px;width:240px;height:120px;background:#5a5;display:none}
#stage{position:absolute;left:10px;top:500px;width:300px;height:200px}
#out{width:100px;height:50px;background:#58a}
</style><div id=box><div id=kid></div></div><div id=a></div><div id=b></div><div id=stage><div id=out></div></div>`;

const PAGE_HELPERS = `
  window.flavor = { name: "lofty", prefix: "lof", logLabel: "lofty",
    springs: { move: { stiffness: 170, damping: 26 }, exit: { stiffness: 300, damping: 30 } },
    layout: { springKeys: { move: "move", exit: "exit" }, rest: { restDelta: 0.05, restSpeed: 0.5 } } };
  window.rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; };
  window.frames = (n) => new Promise((resolve) => { const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step)); requestAnimationFrame(step); });
  window.rested = (layout) => new Promise((resolve) => { if (!layout.getState().moving) resolve(true); else { const off = layout.on("rest", () => { off(); resolve(true); }); setTimeout(() => resolve(false), 6000); } });
`;

const near = (a, b, tolerance = 0.5) => Math.abs(a - b) <= tolerance;
const nearBox = (a, b, tolerance = 0.5) => ["x", "y", "width", "height"].every((key) => near(a[key], b[key], tolerance));

const { origin, close } = await serve();
const browser = await launch();
const results = {};
const problems = [];
const check = (condition, text) => { if (!condition) problems.push(text); };
try {
  const open = async (reducedMotion) => {
    const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, reducedMotion: reducedMotion ? "reduce" : "no-preference" });
    const page = await context.newPage();
    page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
    await page.goto(origin);
    await page.setContent(HTML);
    await page.evaluate(PAGE_HELPERS);
    return { context, page };
  };

  // 1. The inversion, in a rendered page: no jump at play, the natural box at rest, no offset left, and only translate and scale written.
  {
    const { context, page } = await open(false);
    results.inversion = await page.evaluate(async () => {
      const { createLayout } = await import("/dist/layout/index.js");
      const el = document.getElementById("box");
      const styles = [];
      new MutationObserver(() => styles.push(el.getAttribute("style"))).observe(el, { attributes: true, attributeFilter: ["style"] });
      const layout = createLayout(el, { flavor });
      const first = rect(el);
      layout.snapshot();
      el.classList.add("moved");
      const natural = rect(el);
      layout.play();
      const afterPlay = rect(el);
      const moving = layout.getState().moving;
      await frames(8);
      const midway = rect(el);
      const done = await rested(layout);
      await frames(1);
      return { first, natural, afterPlay, midway, moving, done, end: rect(el), style: el.getAttribute("style"), styles };
    });
    const r = results.inversion;
    check(nearBox(r.afterPlay, r.first), "inversion: the element jumped at play");
    check(r.moving, "inversion: the layout does not move");
    check(r.midway.x > r.first.x + 1 && r.midway.x < r.natural.x - 1, "inversion: the element is not between the boxes midway");
    check(r.done, "inversion: the layout did not rest in 6 s");
    check(nearBox(r.end, r.natural), "inversion: the element did not end on its new box");
    check(r.style === null || r.style === "", "inversion: an offset is left in the style attribute");
    check(r.styles.some((text) => /translate/.test(text ?? "")) && r.styles.every((text) => !/transform/.test(text ?? "")), "inversion: the style attribute lacks translate, or names transform");
    await context.close();
  }

  // 2. A change in flight keeps its velocity: the element moves on in its direction, though the new place is behind it, and does not jump.
  {
    const { context, page } = await open(false);
    results.retarget = await page.evaluate(async () => {
      const { createLayout } = await import("/dist/layout/index.js");
      const el = document.getElementById("box");
      const layout = createLayout(el, { flavor });
      layout.snapshot();
      el.classList.add("moved");
      layout.play();
      await frames(6);
      const before = rect(el);
      const speedBefore = layout.getState().velocity[0];
      layout.snapshot();
      el.classList.remove("moved");
      el.classList.add("back");
      layout.play();
      const after = rect(el);
      const speedAfter = layout.getState().velocity[0];
      const path = [];
      for (let i = 0; i < 40; i++) { await frames(1); path.push(rect(el).x); }
      const done = await rested(layout);
      await frames(1);
      return { before, after, speedBefore, speedAfter, farthest: Math.max(...path), done, end: rect(el) };
    });
    const r = results.retarget;
    check(near(r.after.x, r.before.x) && near(r.after.y, r.before.y), "retarget: the element jumped at the change");
    check(r.speedBefore > 50, "retarget: the element had no speed to keep");
    check(r.speedAfter === r.speedBefore, "retarget: the speed changed at the change");
    check(r.farthest > r.after.x + 3, "retarget: the element did not go on in its direction, as a restart from rest would not either");
    check(r.done && near(r.end.x, 20) && near(r.end.y, 20), "retarget: the element did not end on the new box");
    await context.close();
  }

  // 3. A shared pair: the entering element starts on the box of the leaving one.
  {
    const { context, page } = await open(false);
    results.shared = await page.evaluate(async () => {
      const { createShared } = await import("/dist/layout/index.js");
      const a = document.getElementById("a");
      const b = document.getElementById("b");
      const shared = createShared({ flavor });
      const leaving = rect(a);
      shared.leave("hero", a);
      a.style.display = "none";
      b.style.display = "block";
      const natural = rect(b);
      const layout = shared.enter("hero", b);
      const start = rect(b);
      await frames(8);
      const midway = rect(b);
      const done = await rested(layout);
      await frames(1);
      return { leaving, natural, start, midway, done, end: rect(b) };
    });
    const r = results.shared;
    check(nearBox(r.start, r.leaving), "shared: the entering element did not start on the leaving box");
    check(r.midway.x > r.leaving.x && r.midway.x < r.natural.x && r.midway.width > r.leaving.width && r.midway.width < r.natural.width, "shared: the pair did not move as one between the boxes");
    check(r.done && nearBox(r.end, r.natural), "shared: the entering element did not end on its own box");
    await context.close();
  }

  // 4. Presence: the element stays in the page while it exits, and goes when it rests.
  {
    const { context, page } = await open(false);
    results.presence = await page.evaluate(async () => {
      const { createPresence } = await import("/dist/layout/index.js");
      const stage = document.getElementById("stage");
      const el = document.getElementById("out");
      const present = createPresence(stage, { flavor });
      const natural = rect(el);
      let gone = 0;
      present.on("exit", () => { gone += 1; });
      present.exit(el);
      await frames(6);
      const midway = rect(el);
      const mounted = stage.contains(el);
      const start = Date.now();
      while (stage.contains(el) && Date.now() - start < 6000) await frames(1);
      return { natural, midway, mounted, mountedAtEnd: stage.contains(el), gone, exiting: present.getState().exiting };
    });
    const r = results.presence;
    check(r.mounted && r.midway.width < r.natural.width && r.midway.width > 0, "presence: the element was not in the page and shrinking midway");
    check(!r.mountedAtEnd && r.gone === 1 && r.exiting === 0, "presence: the element did not unmount once at rest");
    await context.close();
  }

  // 5. Children: with the children option, a child keeps its size while the parent is scaled.
  {
    const { context, page } = await open(false);
    results.children = await page.evaluate(async () => {
      const { createLayout } = await import("/dist/layout/index.js");
      const el = document.getElementById("box");
      const kid = document.getElementById("kid");
      const layout = createLayout(el, { flavor, children: [kid] });
      layout.snapshot();
      el.classList.add("moved");
      const naturalKid = rect(kid);
      layout.play();
      const parent = rect(el);
      const stretched = rect(kid);
      await frames(5);
      const later = { parent: rect(el), kid: rect(kid), scale: layout.getState().scaleX };
      await rested(layout);
      await frames(1);
      return { naturalKid, parent, stretched, later, end: rect(kid), kidStyle: kid.getAttribute("style") };
    });
    const r = results.children;
    check(near(r.parent.width, 100), "children: the parent did not start at its first width");
    check(near(r.stretched.width, r.naturalKid.width) && near(r.stretched.height, r.naturalKid.height), "children: the child was stretched at the start");
    check(near(r.later.kid.width, r.naturalKid.width, 1) && near(r.later.kid.height, r.naturalKid.height, 1), "children: the child was stretched in flight");
    check(r.kidStyle === null || r.kidStyle === "", "children: a counter-scale is left on the child");
    await context.close();
  }

  // 6. Reduced motion: a change snaps, and an exit unmounts at once.
  {
    const { context, page } = await open(true);
    results.reduced = await page.evaluate(async () => {
      const { createLayout, createPresence } = await import("/dist/layout/index.js");
      const el = document.getElementById("box");
      const layout = createLayout(el, { flavor });
      layout.snapshot();
      el.classList.add("moved");
      const natural = rect(el);
      layout.play();
      const afterPlay = rect(el);
      const stage = document.getElementById("stage");
      const out = document.getElementById("out");
      const present = createPresence(stage, { flavor });
      present.exit(out);
      return { natural, afterPlay, moving: layout.getState().moving, style: el.getAttribute("style"), removed: !stage.contains(out), media: matchMedia("(prefers-reduced-motion: reduce)").matches };
    });
    const r = results.reduced;
    check(r.media, "reduced: the browser did not report reduced motion");
    check(nearBox(r.afterPlay, r.natural) && !r.moving && (r.style === null || r.style === ""), "reduced: the change did not snap");
    check(r.removed, "reduced: the exit did not unmount at once");
    await context.close();
  }
} finally {
  await browser.close();
  await close();
}
report(results, problems);
