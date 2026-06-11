import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const playwrightCacheDir = path.join(process.env.HOME ?? "", ".cache", "ms-playwright");

async function resolveChromiumExecutablePath() {
  const entries = await readdir(playwrightCacheDir, { withFileTypes: true }).catch(() => []);
  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const name of candidates) {
    if (!name.startsWith("chromium-")) continue;
    const candidate = path.join(playwrightCacheDir, name, "chrome-linux", "chrome");
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }

  for (const name of candidates) {
    if (!name.startsWith("chromium_headless_shell-")) continue;
    const candidate = path.join(playwrightCacheDir, name, "chrome-headless-shell-linux64", "chrome-headless-shell");
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }

  return null;
}

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  if (overflow > 1) throw new Error(`horizontal overflow: ${overflow}px`);
}

async function expectImagesLoaded(page) {
  const broken = await page.locator("img").evaluateAll((images) =>
    images
      .filter((img) => img instanceof HTMLImageElement && (!img.complete || img.naturalWidth === 0))
      .map((img) => img.getAttribute("src") ?? "<missing src>"),
  );
  if (broken.length !== 0) throw new Error(`broken images:\n${broken.join("\n")}`);
}

async function expectNoDefaultOutlinedFieldsets(page) {
  const visibleFieldsets = await page.locator(".MuiOutlinedInput-notchedOutline").evaluateAll((fieldsets) =>
    fieldsets
      .filter((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1;
      })
      .map((node) => node.closest(".MuiTextField-root, .MuiOutlinedInput-root, .MuiSelect-root")?.textContent?.trim() ?? "<outline>"),
  );
  if (visibleFieldsets.length !== 0) {
    throw new Error(`default outlined fieldsets are visible:\n${visibleFieldsets.join("\n")}`);
  }
}

async function expectTextFieldFocusFrame(page) {
  const textField = page.locator(".mk-signin-card .MuiTextField-root", { hasText: "Email address" }).first();
  await textField.scrollIntoViewIfNeeded();
  await textField.locator("input").first().focus();
  await page.waitForTimeout(100);

  const metrics = await textField.evaluate((root) => {
    const inputRoot = root.querySelector(".MuiOutlinedInput-root, .MuiInputBase-root");
    const rootStyle = getComputedStyle(root);
    const inputRootStyle = inputRoot ? getComputedStyle(inputRoot) : null;
    return {
      rootShadow: rootStyle.boxShadow,
      inputRootShadow: inputRootStyle?.boxShadow ?? "",
      rootHeight: root.getBoundingClientRect().height,
      inputRootHeight: inputRoot?.getBoundingClientRect().height ?? 0,
    };
  });

  if (metrics.rootShadow !== "none") throw new Error(`TextField outer root has focus shadow: ${metrics.rootShadow}`);
  if (metrics.inputRootShadow === "none") throw new Error("TextField input wrapper did not receive focus shadow");
  if (metrics.inputRootHeight >= metrics.rootHeight - 4) {
    throw new Error(`TextField focus wrapper height is not scoped to input: ${metrics.inputRootHeight}/${metrics.rootHeight}`);
  }
}

async function expectText(page, text) {
  await page.waitForFunction((needle) => document.body.textContent?.includes(needle), text, { timeout: 10000 });
}

async function expectTextMatch(page, patternText) {
  await page.waitForFunction((source) => new RegExp(source).test(document.body.textContent ?? ""), patternText, { timeout: 10000 });
}

async function runDesktopChecks(page, url) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".mk-app", { timeout: 15000 });

  const bodyText = await page.locator("body").textContent();
  for (const text of ["Hi, Welcome back", "Products", "Tasks", "SA-MUI workspace"]) {
    if (!bodyText?.includes(text)) throw new Error(`missing text '${text}'`);
  }

  await expectNoHorizontalOverflow(page);
  await expectImagesLoaded(page);
  await expectNoDefaultOutlinedFieldsets(page);
  await expectTextFieldFocusFrame(page);

  const cardCount = await page.locator(".MuiCard-root").count();
  if (cardCount < 16) throw new Error(`expected Material Kit card coverage, got ${cardCount}`);

  const exportButton = page.locator(".MuiButton-root", { hasText: "Export report" }).first();
  const beforeHover = await exportButton.evaluate((node) => getComputedStyle(node).backgroundColor);
  await exportButton.hover();
  await page.waitForTimeout(200);
  const afterHover = await exportButton.evaluate((node) => getComputedStyle(node).backgroundColor);
  if (beforeHover === afterHover) throw new Error("Export report button hover style did not change");

  await expectText(page, "Actions: 0");
  await exportButton.click();
  await expectText(page, "Actions: 1");

  await page.locator(".MuiMenuItem-root", { hasText: "Search traffic" }).click();
  await expectText(page, "Actions: 2");

  const select = page.locator(".mk-filter-row select.MuiNativeSelect-select").first();
  await select.selectOption("newest");
  await expectTextMatch(page, "Sort changes: [1-9]");
  await expectText(page, "Selected: newest");

  const slider = page.locator(".mk-slider-panel input[type='range']").first();
  await slider.evaluate((node) => {
    node.value = "70";
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expectText(page, "Conversion target: 70%");
  await expectTextMatch(page, "Slider changes: [1-9]");

  const firstTaskInput = page.locator(".mk-tasks .MuiFormControlLabel-root input[type='checkbox']").first();
  const wasChecked = await firstTaskInput.isChecked();
  await firstTaskInput.click({ force: true });
  await expectTextMatch(page, "Task updates: [1-9]");
  const isChecked = await firstTaskInput.isChecked();
  if (wasChecked === isChecked) throw new Error("task checkbox checked state did not change");
}

async function runMobileChecks(page, url) {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".mk-app", { timeout: 15000 });
  await expectNoHorizontalOverflow(page);

  const navColumns = await page.locator(".mk-nav").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
  if (navColumns < 5) throw new Error("mobile nav did not switch to compact grid");
}

async function run(url) {
  const launchOptions = { headless: true };
  const executablePath = await resolveChromiumExecutablePath();
  if (executablePath) launchOptions.executablePath = executablePath;

  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    const failedRequests = [];
    page.on("pageerror", (err) => pageErrors.push(err.stack || err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("Failed to load resource")) pageErrors.push(msg.text());
    });
    page.on("requestfailed", (req) => failedRequests.push(`${req.url()} :: ${req.failure()?.errorText ?? "request failed"}`));

    await runDesktopChecks(page, url);
    await runMobileChecks(page, url);

    if (pageErrors.length !== 0) throw new Error(`browser console/page errors:\n${pageErrors.join("\n")}`);
    const fatalRequests = failedRequests.filter((line) => !line.includes("/favicon.ico") && !line.includes("/__sax_live"));
    if (fatalRequests.length !== 0) throw new Error(`browser request failures:\n${fatalRequests.join("\n")}`);
  } finally {
    await browser.close();
  }
}

const [, , url] = process.argv;
if (!url) {
  console.error("usage: node tools/verify_mui_material_kit_browser.mjs <dev-server-url>");
  process.exit(2);
}

await run(url);
console.log("[PASS] mui material kit browser chromium");
