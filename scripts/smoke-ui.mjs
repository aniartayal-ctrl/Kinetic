#!/usr/bin/env node
/**
 * Whole-studio smoke test. Start the app first (`npm run build && npm start`), then:
 *   npm run test:ui            (KINETIC_URL overrides http://127.0.0.1:3460, SHOTS=dir saves screenshots)
 *
 * Exercises every tool, overlay, inspector tab, budget target, clip, timeline view, shortcut,
 * copilot command and coach fix, then runs a seeded random "monkey" pass and an autosave/restore
 * cycle on a fast-forwarded clock. Fails on any page error, console error or dead UI.
 */
import { chromium } from "playwright";

const URL = process.env.KINETIC_URL ?? "http://127.0.0.1:3460";
const SHOTS = process.env.SHOTS;
const report = { steps: 0, copilot: { ok: 0, failed: [] }, coachFixes: 0, monkeyClicks: 0, errors: [] };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (e) => report.errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && report.errors.push(`console: ${m.text()}`));

const step = async (name, fn) => {
  report.steps++;
  const t0 = Date.now();
  try {
    await fn();
  } catch (err) {
    report.errors.push(`${name}: ${err.message.split("\n")[0]}`);
  }
  console.error(`· ${name} ${((Date.now() - t0) / 1000).toFixed(1)}s, errors so far: ${report.errors.length}`);
};
const alive = async (where) => {
  if (!(await page.locator("header").first().isVisible())) report.errors.push(`studio not visible after ${where}`);
};
const click = (loc) => loc.click({ timeout: 4000 });

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.keyboard.press("Space"); // pause playback for stable interaction

await step("tools", async () => {
  for (const name of ["Import", "Auto Rig", "Bones & IK", "Mesh", "Weight Paint", "Pose", "Warp", "Export"]) {
    await page.getByRole("button", { name, exact: true }).click({ timeout: 4000, noWaitAfter: true });
    await page.waitForTimeout(name === "Export" ? 9000 : 250); // the server bakes atlas + sprite sheet
    await alive(`tool ${name}`);
  }
});

await step("overlays", async () => {
  const labels = ["Bones", "Mesh Wireframe", "Weight Heatmap", "Solo Selected Layer", "Onion Skin", "Motion Arcs", "Weapon Trail", "Slot Reels", "Hitboxes", "Normal-Map Lighting"];
  await click(page.getByRole("button", { name: "Viewport overlays" })); // the menu stays open while toggling
  for (const label of labels) {
    for (let i = 0; i < 2; i++) {
      await click(page.getByRole("menuitemcheckbox", { name: label }));
      await page.waitForTimeout(100);
    }
  }
  await page.keyboard.press("Escape");
  await alive("overlays");
});

await step("inspector", async () => {
  for (const tab of ["Bones", "History", "Budget", "Layers"]) {
    await click(page.getByRole("tab", { name: tab, exact: true }));
    if (tab === "Budget") for (const t of ["Symbol", "Desktop", "Mobile"]) await click(page.getByRole("button", { name: t, exact: true }));
  }
});

await step("clips and timeline", async () => {
  await page.keyboard.press("k");
  const options = await page.locator('select[aria-label="Animation clip"] option').allTextContents();
  for (const clip of [...new Set([options[0], options[Math.floor(options.length / 2)], options.at(-1), "strike"])].filter(Boolean)) {
    await page.selectOption('select[aria-label="Animation clip"]', clip);
    await click(page.getByRole("tab", { name: "Curves" }));
    const key = page.locator('circle[data-kind="key"]').first();
    if (await key.count()) await key.click({ force: true });
    await click(page.getByRole("tab", { name: "Keys" }));
    await page.waitForTimeout(80);
  }
  for (const s of ["0.25×", "0.5×", "1×"]) await click(page.getByRole("button", { name: s, exact: true }));
  await click(page.getByRole("button", { name: "Copy Pose" }));
  await click(page.getByRole("button", { name: "Paste Pose" }));
  await click(page.getByRole("button", { name: "Key", exact: true }));
  await alive("timeline");
});

await step("shortcuts", async () => {
  await page.locator("body").click({ position: { x: 800, y: 300 } });
  for (const key of ["o", "a", "p", "m", "b", "v", "w", "i", "i", "g", "k", "s", "Shift+S", "Period", "Comma", "ArrowRight", "ArrowLeft", "[", "]", "Space", "Space", "Tab", "Tab", "Control+z", "Control+Shift+z", "Control+c", "Control+v"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(60);
  }
  await alive("shortcuts");
});

await step("copilot", async () => {
  await click(page.getByRole("button", { name: /Toggle AI copilot/ }));
  const commands = [
    "review this clip",
    "mesh the body dense with heat weights",
    "add physics to the cape, then make it snappier",
    "set ik to 40% then flip the elbow",
    "add a bone called tassel under head",
    "lock chest then unlock chest",
    "go to frame 10 then key all bones then breakdown 30% on arm",
    "copy pose then go to frame 20 then paste pose",
    "ease in on the arm",
    "make it 1.5 seconds long then 30 fps then loop it",
    "add a camera shake event at frame 12",
    "show onion skin and motion arcs then hide the bones",
    "add anticipation and overshoot",
    "fix everything",
    "check the budget",
    "play the idle animation then pause",
    "undo then redo",
  ];
  const box = page.getByRole("textbox", { name: "Ask Copilot" });
  for (const c of commands) {
    await box.fill(c);
    await box.press("Enter");
    await page.waitForTimeout(300);
  }
  const marks = await page.locator('aside[aria-label="Copilot"] li span[aria-label]').evaluateAll((els) =>
    els.map((e) => ({ ok: e.getAttribute("aria-label") === "Done", text: e.parentElement?.innerText ?? "" })),
  );
  report.copilot.ok = marks.filter((m) => m.ok).length;
  report.copilot.failed = marks.filter((m) => !m.ok).map((m) => m.text.replace(/\s+/g, " ").trim());
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/copilot.png` });
});

await step("coach", async () => {
  for (let i = 0; i < 10; i++) {
    const fix = page.locator('section[aria-label="Suggestions"] article button').first();
    if (!(await fix.count())) break;
    await fix.click();
    report.coachFixes++;
    await page.waitForTimeout(150);
  }
});

await step("help", async () => {
  await page.keyboard.press("?");
  for (const tab of await page.locator('[role="dialog"] button, .fixed button').allTextContents()) void tab;
  await page.keyboard.press("Escape");
});

await step("projects", async () => {
  const titleButton = () => page.getByRole("button", { name: /^Project:/ });
  const status = () => page.getByRole("button", { name: /^Save\./ }).getAttribute("aria-label");
  await page.locator("body").click({ position: { x: 800, y: 300 } });

  // ⌘S lands in projects/, not in the shipped presets.
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(1200);
  const { projects } = await (await page.request.get(`${URL}/api/projects`)).json();
  if (!projects?.some((p) => p.id === "astral-forge")) throw new Error("save did not appear in /api/projects");
  if (!/Saved/.test(await status())) throw new Error(`status after save: ${await status()}`);

  // An edit marks the document as edited; opening a template asks first.
  await page.keyboard.press("Shift+S");
  await page.waitForTimeout(200);
  if (!/Edited/.test(await status())) throw new Error(`status after edit: ${await status()}`);
  await page.keyboard.press("Control+o");
  await click(page.getByRole("menuitem", { name: /Sands of Solara/ }));
  await click(page.getByRole("button", { name: /Don.t Save/ }));
  await page.waitForTimeout(800);
  if (!/Solara/i.test((await titleButton().getAttribute("aria-label")) ?? "")) throw new Error("template did not open");
  if (SHOTS) {
    await click(titleButton());
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/projects-menu.png` });
    await page.keyboard.press("Escape");
  }

  // Reopen the saved project from the menu; it opens clean.
  await click(titleButton());
  await click(page.getByRole("menuitem", { name: /Astral Forge \(Star-Smith\)/ }));
  await page.waitForTimeout(800);
  if (!/Astral/.test((await titleButton().getAttribute("aria-label")) ?? "")) throw new Error("saved project did not reopen");
  if (/Edited/.test(await status())) throw new Error("freshly opened project shows as edited");

  // Copilot path: an edit, then "open project sands" shows the prompt; Cancel keeps the work.
  await page.keyboard.press("Shift+S");
  const box = page.getByRole("textbox", { name: "Ask Copilot" });
  if (!(await box.count())) await click(page.getByRole("button", { name: /Toggle AI copilot/ }));
  await box.fill("open project sands");
  await box.press("Enter");
  await page.getByRole("alertdialog").waitFor({ timeout: 4000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/unsaved-dialog.png` });
  await click(page.getByRole("button", { name: "Cancel" }));
  if (!/Astral/.test((await titleButton().getAttribute("aria-label")) ?? "")) throw new Error("Cancel still switched projects");

  // Malformed requests are rejected cleanly.
  const bad = await page.request.get(`${URL}/api/projects/..%2F..%2Fpackage`);
  if (bad.status() !== 400 && bad.status() !== 404) throw new Error(`path traversal returned ${bad.status()}`);
  const missing = await page.request.get(`${URL}/api/projects/does-not-exist`);
  if (missing.status() !== 404) throw new Error(`missing project returned ${missing.status()}`);
  const notJson = await page.request.post(`${URL}/api/projects`, { data: "nope", headers: { "content-type": "text/plain" } });
  if (notJson.status() !== 400) throw new Error(`non-JSON save returned ${notJson.status()}`);
});

await step("autosave", async () => {
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const p2 = await ctx2.newPage();
  p2.on("pageerror", (e) => report.errors.push(`autosave pageerror: ${e.message}`));
  await p2.clock.install();
  await p2.goto(URL, { waitUntil: "domcontentloaded" });
  await p2.waitForTimeout(800);
  await p2.evaluate(() => localStorage.removeItem("kinetic-pro:autosave"));
  await p2.locator("body").click({ position: { x: 700, y: 300 } });
  await p2.keyboard.press("Shift+S"); // make a change
  await p2.clock.fastForward("05:05");
  const saved = await p2.evaluate(() => localStorage.getItem("kinetic-pro:autosave"));
  if (!saved) throw new Error("no autosave after 5 minutes");
  await p2.reload({ waitUntil: "domcontentloaded" });
  await p2.waitForTimeout(800);
  await p2.getByRole("button", { name: "Restore" }).click({ timeout: 4000 });
  await p2.waitForTimeout(300);
  const restored = await p2.locator("aside[aria-label='Inspector']").count();
  if (!restored) throw new Error("studio not visible after restore");
  await ctx2.close();
});

await step("monkey", async () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 150; i++) {
    const buttons = page.locator("button:visible");
    const n = await buttons.count();
    if (n === 0) break;
    const b = buttons.nth(Math.floor(rand() * n));
    const label = ((await b.getAttribute("aria-label", { timeout: 400 }).catch(() => "")) ?? (await b.innerText({ timeout: 400 }).catch(() => ""))).toLowerCase();
    if (/download|record|discard|restore/.test(label)) continue; // file dialogs and data loss are tested elsewhere
    // Forced clicks skip actionability waits; covered buttons still receive the event, which is what a crash hunt wants.
    await b.click({ timeout: 400, force: true }).catch(() => {});
    report.monkeyClicks++;
    if (i % 25 === 0) await page.keyboard.press(["k", "g", "Space", "Escape", "i"][Math.floor(rand() * 5)]);
  }
  await page.keyboard.press("Escape");
  await alive("monkey");
});

await browser.close();
console.log(JSON.stringify(report, null, 2));
process.exit(report.errors.length > 0 ? 1 : 0);
