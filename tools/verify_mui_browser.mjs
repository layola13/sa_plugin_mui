import { access, readFile, readdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const playwrightCacheDir = path.join(process.env.HOME ?? "", ".cache", "ms-playwright");

function chromiumExecutablePath() {
  return path.join(playwrightCacheDir, "chromium-1179", "chrome-linux", "chrome");
}

async function resolveChromiumExecutablePath() {
  const legacy = chromiumExecutablePath();
  try {
    await access(legacy);
    return legacy;
  } catch {}

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

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".wasm")) return "application/wasm";
  if (file.endsWith(".sa")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const fileName = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        const safePath = path.normalize(fileName).replace(/^(\.\.(\/|\\|$))+/, "");
        const filePath = path.join(rootDir, safePath);
        const body = await readFile(filePath);
        res.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
        res.end(body);
      } catch (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(err instanceof Error ? err.message : String(err));
      }
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to bind test server"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}/` });
    });
  });
}

async function count(page, selector) {
  return page.locator(selector).count();
}

async function expectMountedMui(page) {
  await page.waitForSelector(".mui-basic-demo", { timeout: 10000 });
  const bodyText = await page.locator("body").textContent();
  if (!bodyText?.includes("SA driven MUI")) throw new Error("missing projected Typography text 'SA driven MUI'");

  const requiredSelectors = [
    ".MuiButton-root",
    ".MuiAutocomplete-root",
    ".MuiTablePaginationActions-root",
    ".MuiDialog-root",
    ".MuiSlider-root",
    ".MuiRating-root",
    ".MuiCard-root",
    ".MuiList-root",
    ".MuiTable-root",
  ];

  for (const selector of requiredSelectors) {
    const matches = await count(page, selector);
    if (matches === 0) throw new Error(`expected ${selector} to render at least once`);
  }

  const allMuiNodes = await count(page, "[class*='Mui']");
  if (allMuiNodes < 80) throw new Error(`expected broad MUI DOM coverage, got ${allMuiNodes} Mui-class nodes`);

  const buttonTexts = await page.locator(".MuiButton-root").evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()).filter(Boolean));
  for (const label of ["Save", "Disabled button", "Interactive button", "Grouped", "Tooltip target", "Open"]) {
    if (!buttonTexts.some((text) => text.includes(label))) throw new Error(`missing rendered MUI button text '${label}'`);
  }

  const disabledButton = page.locator(".MuiButton-root.Mui-disabled", { hasText: "Disabled button" });
  if ((await disabledButton.count()) === 0) throw new Error("missing disabled Button ownerState utility class");
  if (!(await disabledButton.first().evaluate((node) => node instanceof HTMLButtonElement && node.disabled))) {
    throw new Error("disabled Button did not set the native disabled property");
  }

  const smallButton = page.locator(".MuiButton-root.MuiButton-sizeSmall", { hasText: "Small button" });
  if ((await smallButton.count()) === 0) throw new Error("missing small Button size utility class");

  const largeButton = page.locator(".MuiButton-root.MuiButton-sizeLarge", { hasText: "Large button" });
  if ((await largeButton.count()) === 0) throw new Error("missing large Button size utility class");

  const containedButton = page.locator(".MuiButton-root.MuiButton-contained", { hasText: "Contained button" });
  if ((await containedButton.count()) === 0) throw new Error("missing contained Button variant utility class");

  const inheritButton = page.locator(".MuiButton-root.MuiButton-colorInherit", { hasText: "Inherit button" });
  if ((await inheritButton.count()) === 0) throw new Error("missing inherit Button color utility class");

  const secondaryButton = page.locator(".MuiButton-root.MuiButton-colorSecondary", { hasText: "Secondary button" });
  if ((await secondaryButton.count()) === 0) throw new Error("missing secondary Button color utility class");

  const initialButtonClicks = await page.locator("body").textContent();
  if (!initialButtonClicks?.includes("Button clicks: 0")) throw new Error("missing initial SA-MUI Button click state");
  await page.locator(".MuiButton-root", { hasText: "Interactive button" }).first().click();
  await page.waitForFunction(() => document.body.textContent?.includes("Button clicks: 1"));

  const disabledBase = page.locator(".MuiButtonBase-root.Mui-disabled", { hasText: "Disabled base" });
  if ((await disabledBase.count()) === 0) throw new Error("missing disabled ButtonBase ownerState utility class");
  if (!(await disabledBase.first().evaluate((node) => node instanceof HTMLButtonElement && node.disabled))) {
    throw new Error("disabled ButtonBase did not set the native disabled property");
  }

  const stateClassCases = [
    [".MuiIconButton-root.MuiIconButton-sizeSmall", "Small icon", false],
    [".MuiIconButton-root.MuiIconButton-colorPrimary", "Primary icon", false],
    [".MuiIconButton-root.MuiIconButton-colorSecondary", "Secondary icon", false],
    [".MuiIconButton-root.MuiIconButton-colorInherit", "Inherit icon", false],
    [".MuiIconButton-root.Mui-disabled", "Disabled icon", true],
    [".MuiFab-root.MuiFab-sizeSmall", "Small fab", false],
    [".MuiFab-root.MuiFab-sizeMedium", "Medium fab", false],
    [".MuiFab-root.Mui-disabled", "Disabled fab", true],
    [".MuiMenuItem-root.Mui-selected", "Selected menu option", false],
    [".MuiMenuItem-root.Mui-disabled", "Disabled menu option", false],
    [".MuiStepButton-root.Mui-disabled", "Disabled step", true],
    [".MuiTab-root.Mui-selected", "Selected tab", false],
    [".MuiTab-root.Mui-disabled", "Disabled tab", true],
    [".MuiToggleButton-root.MuiToggleButton-sizeSmall", "Small toggle", false],
    [".MuiToggleButton-root.MuiToggleButton-sizeLarge", "Large toggle", false],
    [".MuiToggleButton-root.MuiToggleButton-primary", "Primary toggle", false],
    [".MuiToggleButton-root.MuiToggleButton-secondary", "Secondary toggle", false],
    [".MuiToggleButton-root.MuiToggleButton-fullWidth", "Full width toggle", false],
    [".MuiToggleButton-root.MuiToggleButtonGroup-grouped", "Bold", false],
    [".MuiToggleButton-root.MuiToggleButton-sizeSmall.MuiToggleButton-secondary.MuiToggleButtonGroup-grouped.Mui-disabled", "Inherited disabled toggle", true],
    [".MuiToggleButton-root.Mui-selected", "Selected toggle", false],
    [".MuiToggleButton-root.Mui-disabled", "Disabled toggle", true],
    [".MuiPaginationItem-root.Mui-selected", "3", false],
    [".MuiPaginationItem-root.MuiPaginationItem-colorSecondary", "3", false],
    [".MuiPaginationItem-root.Mui-disabled", "Disabled page", true],
    [".MuiCardActionArea-root.Mui-disabled", "Action media", true],
    [".MuiListItemButton-root.Mui-selected", "Open inbox", false],
    [".MuiListItemButton-root.Mui-disabled", "Disabled inbox", false],
  ];

  for (const [selector, label, expectNativeDisabled] of stateClassCases) {
    const locator = page.locator(selector, { hasText: label });
    if ((await locator.count()) === 0) throw new Error(`missing ownerState utility class ${selector} for '${label}'`);
    if (expectNativeDisabled && !(await locator.first().evaluate((node) => node instanceof HTMLButtonElement && node.disabled))) {
      throw new Error(`state class ${selector} for '${label}' did not set native disabled`);
    }
  }

  const defaultFab = page.locator(".MuiFab-root.MuiFab-circular.MuiFab-default", { hasText: "Add" });
  if ((await defaultFab.count()) === 0) throw new Error("missing default Fab ownerState utility classes");

  const primaryFab = page.locator(".MuiFab-root.MuiFab-circular.MuiFab-primary", { hasText: "Primary fab" });
  if ((await primaryFab.count()) === 0) throw new Error("missing primary Fab ownerState utility classes");

  const secondaryFab = page.locator(".MuiFab-root.MuiFab-circular.MuiFab-secondary", { hasText: "Secondary fab" });
  if ((await secondaryFab.count()) === 0) throw new Error("missing secondary Fab ownerState utility classes");

  const inheritFab = page.locator(".MuiFab-root.MuiFab-circular.MuiFab-colorInherit", { hasText: "Inherit fab" });
  if ((await inheritFab.count()) === 0) throw new Error("missing inherit Fab ownerState utility classes");

  const extendedFab = page.locator(".MuiFab-root.MuiFab-extended", { hasText: "Extended fab" });
  if ((await extendedFab.count()) === 0) throw new Error("missing extended Fab ownerState utility class");

  const stepStateCases = [
    [".MuiStepper-root.MuiStepper-alternativeLabel", null],
    [".MuiStepper-root.MuiStepper-horizontal", "First step"],
    [".MuiStepper-root.MuiStepper-vertical", "Vertical first step"],
    [".MuiStep-root.Mui-completed", "Completed step label"],
    [".MuiStepLabel-label.Mui-active.Mui-completed", "Completed step label"],
    [".MuiStepLabel-label.Mui-error", "Errored step label"],
    [".MuiStepLabel-label.Mui-disabled", "Disabled step label"],
    [".MuiStepButton-root .MuiStepLabel-label.Mui-active.Mui-completed", "Completed step button"],
    [".MuiStepButton-root.MuiStepButton-horizontal", "Second step"],
    [".MuiStepButton-root.MuiStepButton-vertical", "Vertical second step"],
    [".MuiStepConnector-root.Mui-active.Mui-completed", null],
    [".MuiStepConnector-root.Mui-disabled", null],
    [".MuiStepConnector-root.MuiStepConnector-vertical", null],
    [".MuiStepIcon-root.Mui-active", null],
    [".MuiStepIcon-root.Mui-completed", null],
    [".MuiStepIcon-root.Mui-error", null],
  ];

  for (const [selector, label] of stepStateCases) {
    const locator = label ? page.locator(selector, { hasText: label }) : page.locator(selector);
    if ((await locator.count()) === 0) throw new Error(`missing Step ownerState utility class ${selector}${label ? ` for '${label}'` : ""}`);
  }

  const accordionStateCases = [
    [".MuiAccordion-root.Mui-expanded", "Expanded accordion summary"],
    [".MuiAccordion-root.Mui-disabled", "Disabled accordion summary"],
    [".MuiAccordionSummary-root.Mui-expanded", "Expanded accordion summary", false],
    [".MuiAccordionSummary-content.Mui-expanded", "Expanded accordion summary", false],
    [".MuiAccordionSummary-root.Mui-disabled", "Disabled accordion summary", true],
  ];

  for (const [selector, label, expectNativeDisabled] of accordionStateCases) {
    const locator = page.locator(selector, { hasText: label });
    if ((await locator.count()) === 0) throw new Error(`missing Accordion ownerState utility class ${selector} for '${label}'`);
    if (expectNativeDisabled && !(await locator.first().evaluate((node) => node instanceof HTMLButtonElement && node.disabled))) {
      throw new Error(`Accordion state class ${selector} for '${label}' did not set native disabled`);
    }
  }

  const flushAccordion = page.locator(".MuiAccordion-root", { hasText: "Flush square accordion summary" }).first();
  if ((await flushAccordion.count()) === 0) throw new Error("missing flush square Accordion target");
  for (const className of ["MuiPaper-rounded", "MuiAccordion-rounded", "MuiAccordion-gutters"]) {
    if (await flushAccordion.evaluate((node, expectedClass) => node.classList.contains(expectedClass), className)) {
      throw new Error(`flush square Accordion still had ${className}`);
    }
  }

  const flushAccordionSummary = page.locator(".MuiAccordionSummary-root", { hasText: "Flush square accordion summary" }).first();
  if ((await flushAccordionSummary.count()) === 0) throw new Error("missing flush AccordionSummary target");
  if (await flushAccordionSummary.evaluate((node) => node.classList.contains("MuiAccordionSummary-gutters"))) {
    throw new Error("disableGutters AccordionSummary still had MuiAccordionSummary-gutters");
  }
  if ((await flushAccordion.locator(".MuiAccordionSummary-content.MuiAccordionSummary-contentGutters").count()) !== 0) {
    throw new Error("AccordionSummary content emitted removed MuiAccordionSummary-contentGutters utility class");
  }

  const tableStateCases = [
    [".MuiTable-root.MuiTable-stickyHeader", "Name"],
    [".MuiTableRow-root.MuiTableRow-hover.Mui-selected", "Name"],
    [".MuiTableCell-root.MuiTableCell-stickyHeader", "Name"],
    [".MuiTableCell-root.MuiTableCell-sizeSmall", "Value"],
    [".MuiTableSortLabel-root.Mui-active", "Name"],
    [".MuiTableSortLabel-root.MuiTableSortLabel-directionDesc", "Descending"],
    [".MuiTableSortLabel-icon.MuiTableSortLabel-directionDesc", null],
  ];

  for (const [selector, label] of tableStateCases) {
    const locator = label ? page.locator(selector, { hasText: label }) : page.locator(selector);
    if ((await locator.count()) === 0) throw new Error(`missing Table ownerState utility class ${selector}${label ? ` for '${label}'` : ""}`);
  }

  const disabledPagination = page.locator(".MuiTablePagination-root", { hasText: "Disabled pagination" }).first();
  if ((await disabledPagination.count()) === 0) throw new Error("missing disabled TablePagination target");
  if ((await disabledPagination.locator(".MuiTablePagination-toolbar").count()) === 0) throw new Error("missing TablePagination toolbar slot class");
  if ((await disabledPagination.locator(".MuiTablePagination-spacer").count()) === 0) throw new Error("missing TablePagination spacer slot class");
  if ((await disabledPagination.locator(".MuiTablePagination-selectLabel", { hasText: "Rows per page:" }).count()) === 0) throw new Error("missing TablePagination selectLabel slot class");
  if ((await disabledPagination.locator(".MuiTablePagination-input.MuiTablePagination-selectRoot").count()) === 0) throw new Error("missing TablePagination input/selectRoot slot classes");
  if ((await disabledPagination.locator(".MuiTablePagination-select").count()) === 0) throw new Error("missing TablePagination select slot class");
  if ((await disabledPagination.locator(".MuiTablePagination-selectIcon").count()) === 0) throw new Error("missing TablePagination selectIcon slot class");
  if ((await disabledPagination.locator(".MuiTablePagination-displayedRows", { hasText: "0-0 of 0" }).count()) === 0) throw new Error("missing TablePagination displayedRows slot class");
  const paginationActions = disabledPagination.locator(".MuiTablePagination-actions .MuiTablePaginationActions-root").first();
  if ((await paginationActions.count()) === 0) throw new Error("missing nested TablePagination actions slot class");
  const disabledPaginationButtons = paginationActions.locator(".MuiIconButton-root.Mui-disabled");
  if ((await disabledPaginationButtons.count()) < 2) throw new Error("missing disabled TablePaginationActions button classes");
  const disabledPaginationButtonsNative = await disabledPaginationButtons.evaluateAll((nodes) => nodes.every((node) => node instanceof HTMLButtonElement && node.disabled));
  if (!disabledPaginationButtonsNative) throw new Error("TablePaginationActions disabled buttons did not set native disabled");

  const standalonePaginationActions = page.locator(".MuiTablePaginationActions-root", { hasText: "Disabled pagination actions" }).first();
  if ((await standalonePaginationActions.count()) === 0) throw new Error("missing standalone TablePaginationActions target");
  const standaloneDisabledButtons = standalonePaginationActions.locator(".MuiIconButton-root.Mui-disabled");
  if ((await standaloneDisabledButtons.count()) < 2) throw new Error("missing standalone TablePaginationActions disabled button classes");

  const mobileStepperCases = [
    [".MuiMobileStepper-root.MuiMobileStepper-positionBottom", "Bottom back"],
    [".MuiMobileStepper-root.MuiMobileStepper-positionTop", "Top back"],
    [".MuiMobileStepper-root.MuiMobileStepper-positionStatic", "Static back"],
  ];

  for (const [selector, label] of mobileStepperCases) {
    const locator = page.locator(selector, { hasText: label }).first();
    if ((await locator.count()) === 0) throw new Error(`missing MobileStepper ownerState utility class ${selector} for '${label}'`);
    if ((await locator.locator(".MuiMobileStepper-dots").count()) === 0) throw new Error(`missing MobileStepper dots slot for '${label}'`);
    if ((await locator.locator(".MuiMobileStepper-dot").count()) < 2) throw new Error(`missing MobileStepper dot slot classes for '${label}'`);
    if ((await locator.locator(".MuiMobileStepper-dot.MuiMobileStepper-dotActive").count()) === 0) throw new Error(`missing MobileStepper active dot class for '${label}'`);
    if ((await locator.locator(".MuiMobileStepper-progress").count()) !== 0) throw new Error(`default MobileStepper '${label}' unexpectedly had progress slot class`);
  }

  const progressStepper = page.locator(".MuiMobileStepper-root", { hasText: "Progress back" }).first();
  if ((await progressStepper.count()) === 0) throw new Error("missing progress MobileStepper target");
  if ((await progressStepper.locator(".MuiMobileStepper-progress").count()) === 0) throw new Error("missing MobileStepper progress slot class");
  if ((await progressStepper.locator(".MuiMobileStepper-dots").count()) !== 0) throw new Error("progress MobileStepper unexpectedly had dots slot class");

  const defaultImageList = page.locator(".MuiImageList-root.MuiImageList-standard", { hasText: "Image title" }).first();
  if ((await defaultImageList.count()) === 0) throw new Error("missing default ImageList variant utility class");
  if ((await defaultImageList.locator(".MuiImageListItem-root.MuiImageListItem-standard", { hasText: "Image title" }).count()) === 0) {
    throw new Error("missing default ImageListItem variant utility class");
  }
  if ((await defaultImageList.locator(".MuiImageListItemBar-root.MuiImageListItemBar-positionBottom.MuiImageListItemBar-actionPositionRight", { hasText: "Image title" }).count()) === 0) {
    throw new Error("missing default ImageListItemBar ownerState utility classes");
  }

  const wovenImageItem = page.locator(".MuiImageListItem-root.MuiImageListItem-woven", { hasText: "Woven image title" }).first();
  if ((await wovenImageItem.count()) === 0) throw new Error("missing woven ImageListItem variant utility class");
  if ((await wovenImageItem.locator(".MuiImageListItemBar-root.MuiImageListItemBar-positionTop.MuiImageListItemBar-actionPositionLeft", { hasText: "Woven image title" }).count()) === 0) {
    throw new Error("missing top/left ImageListItemBar ownerState utility classes");
  }

  const listStateCases = [
    [".MuiList-root.MuiList-dense", "Compact recent"],
    [".MuiListItem-root.MuiListItem-dense.MuiListItem-divider", "Dense divided item"],
    [".MuiListItemButton-root.MuiListItemButton-dense.MuiListItemButton-divider.Mui-selected", "Dense selected action"],
    [".MuiListItemText-root.MuiListItemText-inset.MuiListItemText-dense", "Dense divided item"],
    [".MuiListItemText-root.MuiListItemText-multiline", "Multiline list text"],
    [".MuiListItemSecondaryAction-root.MuiListItemSecondaryAction-disableGutters", "Compact more"],
    [".MuiListSubheader-root.MuiListSubheader-inset", "Compact recent"],
    [".MuiListSubheader-root.MuiListSubheader-colorPrimary", "Primary recent"],
    [".MuiListSubheader-root.MuiListSubheader-colorInherit", "Inherited recent"],
    [".MuiChip-root.Mui-disabled.MuiChip-clickable", "Disabled clickable chip"],
    [".MuiChip-root.MuiChip-outlined", "Outlined chip"],
    [".MuiChip-root.MuiChip-colorPrimary", "Primary chip"],
    [".MuiChip-root.MuiChip-colorSecondary", "Secondary chip"],
    [".MuiChip-root.MuiChip-sizeSmall", "Small chip"],
    [".MuiChip-label.MuiChip-labelSmall", "Small chip"],
    [".MuiBadge-badge.MuiBadge-colorPrimary", "7"],
    [".MuiBadge-badge.MuiBadge-colorSecondary", "5"],
    [".MuiBadge-badge.MuiBadge-colorError", "4"],
    [".MuiBadge-badge.MuiBadge-invisible", "0"],
    [".MuiBadge-badge.MuiBadge-standard.MuiBadge-overlapRectangular", "3"],
    [".MuiBadge-badge.MuiBadge-anchorOriginTopLeft.MuiBadge-anchorOriginTopLeftRectangular", "9"],
    [".MuiBadge-badge.MuiBadge-anchorOriginBottomLeft.MuiBadge-anchorOriginBottomLeftCircular.MuiBadge-overlapCircular", "2"],
  ];

  for (const [selector, label] of listStateCases) {
    const locator = page.locator(selector, { hasText: label });
    if ((await locator.count()) === 0) throw new Error(`missing List/Chip/Badge ownerState utility class ${selector} for '${label}'`);
  }

  const absentListClasses = [
    [".MuiList-root", "Compact recent", "MuiList-padding"],
    [".MuiList-root", "Flush menu option", "MuiList-padding"],
    [".MuiListItem-root", "Dense divided item", "MuiListItem-gutters"],
    [".MuiListItem-root", "Dense divided item", "MuiListItem-padding"],
    [".MuiListItemButton-root", "Dense selected action", "MuiListItemButton-gutters"],
    [".MuiListSubheader-root", "Compact recent", "MuiListSubheader-gutters"],
    [".MuiListSubheader-root", "Compact recent", "MuiListSubheader-sticky"],
  ];

  for (const [selector, label, className] of absentListClasses) {
    const locator = page.locator(selector, { hasText: label }).first();
    if ((await locator.count()) === 0) throw new Error(`missing List state target ${selector} for '${label}'`);
    if (await locator.evaluate((node, expectedClass) => node.classList.contains(expectedClass), className)) {
      throw new Error(`expected ${selector} for '${label}' to omit ${className}`);
    }
  }

  const statusStateCases = [
    [".MuiBackdrop-root.MuiBackdrop-invisible", "Invisible backdrop"],
    [".MuiRating-root.MuiRating-sizeSmall", "Small rating"],
    [".MuiRating-root.MuiRating-sizeLarge", "Large rating"],
    [".MuiRating-root.Mui-disabled", "Disabled rating"],
    [".MuiRating-root.MuiRating-readOnly", "Read only rating"],
    [".MuiSlider-root.MuiSlider-colorSecondary", "Secondary slider"],
    [".MuiSlider-root.MuiSlider-sizeSmall", "Small slider"],
    [".MuiSlider-root.Mui-disabled", "Disabled slider"],
    [".MuiCircularProgress-circle.MuiCircularProgress-circleDisableShrink", null],
    [".MuiCircularProgress-root.MuiCircularProgress-colorSecondary", null],
    [".MuiCircularProgress-root.MuiCircularProgress-determinate.MuiCircularProgress-colorInherit", null],
    [".MuiCircularProgress-circle.MuiCircularProgress-circleDeterminate", null],
    [".MuiLinearProgress-root.MuiLinearProgress-colorSecondary", null],
    [".MuiLinearProgress-root.MuiLinearProgress-determinate", null],
    [".MuiLinearProgress-bar.MuiLinearProgress-bar1.MuiLinearProgress-bar1Determinate", null],
    [".MuiLinearProgress-root.MuiLinearProgress-buffer.MuiLinearProgress-colorSecondary", null],
    [".MuiLinearProgress-bar.MuiLinearProgress-bar1.MuiLinearProgress-bar1Buffer", null],
    [".MuiLinearProgress-bar.MuiLinearProgress-bar2.MuiLinearProgress-bar2Buffer.MuiLinearProgress-colorSecondary", null],
    [".MuiSkeleton-root.MuiSkeleton-rectangular", "Rectangular skeleton"],
    [".MuiSkeleton-root.MuiSkeleton-wave", "Wave skeleton"],
    [".MuiSnackbar-root.MuiSnackbar-anchorOriginBottomLeft", "Snackbar message"],
    [".MuiSnackbar-root.MuiSnackbar-anchorOriginTopRight", "Top right snackbar"],
    [".MuiSnackbar-root.MuiSnackbar-anchorOriginBottomCenter", "Bottom center snackbar"],
  ];

  for (const [selector, label] of statusStateCases) {
    const locator = label ? page.locator(selector, { hasText: label }) : page.locator(selector);
    if ((await locator.count()) === 0) throw new Error(`missing status ownerState utility class ${selector}${label ? ` for '${label}'` : ""}`);
  }

  if ((await page.locator(".MuiLinearProgress-barColorPrimary").count()) !== 0) {
    throw new Error("stale LinearProgress barColorPrimary utility class should not be emitted");
  }

  const disabledRating = page.locator(".MuiRating-root.Mui-disabled", { hasText: "Disabled rating" });
  if (!(await disabledRating.first().locator("input[type='radio']").first().evaluate((node) => node instanceof HTMLInputElement && node.disabled))) {
    throw new Error("disabled Rating did not set the native disabled property");
  }

  const disabledSlider = page.locator(".MuiSlider-root.Mui-disabled", { hasText: "Disabled slider" });
  if ((await disabledSlider.first().locator(".MuiSlider-thumb.Mui-disabled").count()) === 0) {
    throw new Error("disabled Slider did not set the thumb disabled utility class");
  }
  if (!(await disabledSlider.first().locator("input[type='range']").first().evaluate((node) => node instanceof HTMLInputElement && node.disabled))) {
    throw new Error("disabled Slider did not set the native disabled property");
  }

  const navigationStateCases = [
    [".MuiButtonGroup-root.MuiButtonGroup-fullWidth.MuiButtonGroup-disableElevation", "Full width grouped"],
    [".MuiButtonGroup-root.MuiButtonGroup-horizontal", "Grouped"],
    [".MuiButtonGroup-root.MuiButtonGroup-contained.MuiButtonGroup-colorInherit", "Contained inherit grouped"],
    [".MuiButtonGroup-root .MuiButton-root.MuiButton-contained.MuiButton-colorInherit", "Contained inherit grouped"],
    [".MuiButtonGroup-root.MuiButtonGroup-colorSecondary", "Secondary grouped"],
    [".MuiButtonGroup-root .MuiButton-root.MuiButton-colorSecondary", "Secondary grouped"],
    [".MuiButtonGroup-root.MuiButtonGroup-vertical", "Vertical grouped"],
    [".MuiTabs-list.MuiTabs-centered", "Wide wrapped tab"],
    [".MuiTab-root.MuiTab-fullWidth.MuiTab-wrapped", "Wide wrapped tab"],
    [".MuiTab-root.MuiTab-textColorPrimary", "Primary tab"],
    [".MuiTab-root.MuiTab-textColorSecondary", "Secondary tab"],
    [".MuiToggleButtonGroup-root.MuiToggleButtonGroup-fullWidth", "Full width toggle"],
    [".MuiToggleButtonGroup-root.MuiToggleButtonGroup-horizontal", "Bold"],
    [".MuiToggleButtonGroup-root.MuiToggleButtonGroup-vertical", "Vertical toggle"],
    [".MuiToggleButtonGroup-root.MuiToggleButtonGroup-horizontal", "Inherited disabled toggle"],
    [".MuiBottomNavigationAction-root.Mui-selected", "Settings"],
    [".MuiBottomNavigationAction-label.Mui-selected", "Settings"],
    [".MuiTabScrollButton-root.Mui-disabled", "Disabled tab scroll"],
    [".MuiTabScrollButton-root.MuiTabScrollButton-horizontal", "Disabled tab scroll"],
    [".MuiTabScrollButton-root.MuiTabScrollButton-vertical", "Vertical tab scroll"],
    [".MuiPagination-root.MuiPagination-text", "Disabled page"],
    [".MuiPagination-root.MuiPagination-outlined", "Outlined page"],
    [".MuiPaginationItem-root.MuiPaginationItem-text.MuiPaginationItem-circular", "Disabled page"],
    [".MuiPaginationItem-root.MuiPaginationItem-page", "Disabled page"],
    [".MuiPaginationItem-root.MuiPaginationItem-outlined.MuiPaginationItem-circular", "Outlined item page"],
    [".MuiPaginationItem-root.MuiPaginationItem-sizeSmall", "Small page"],
    [".MuiPaginationItem-root.MuiPaginationItem-sizeLarge", "Large page"],
    [".MuiPaginationItem-root.MuiPaginationItem-rounded", "Rounded page"],
    [".MuiPaginationItem-root.MuiPaginationItem-previousNext", "Previous item"],
    [".MuiPaginationItem-root.MuiPaginationItem-previousNext", "Next item"],
    [".MuiPaginationItem-root.MuiPaginationItem-ellipsis", "Start ellipsis"],
    [".MuiPaginationItem-root.MuiPaginationItem-firstLast", "Last item"],
    [".MuiSpeedDial-root.MuiSpeedDial-directionLeft", "Left speed action"],
    [".MuiSpeedDial-actions.MuiSpeedDial-actionsClosed", "Closed speed action"],
    [".MuiSpeedDialAction-fab.MuiSpeedDialAction-fabClosed", "Closed speed action"],
    [".MuiSpeedDialAction-staticTooltip.MuiSpeedDialAction-staticTooltipClosed", "Closed speed action"],
    [".MuiTooltip-popper.MuiTooltip-popperArrow", null],
    [".MuiTooltip-tooltip.MuiTooltip-tooltipArrow", null],
    [".MuiTooltip-tooltip.MuiTooltip-tooltipPlacementTop", null],
  ];

  for (const [selector, label] of navigationStateCases) {
    const locator = label ? page.locator(selector, { hasText: label }) : page.locator(selector);
    if ((await locator.count()) === 0) throw new Error(`missing navigation ownerState utility class ${selector}${label ? ` for '${label}'` : ""}`);
  }

  const openSpeedDialActions = page.locator(".MuiSpeedDial-actions", { hasText: "Edit" }).first();
  if ((await openSpeedDialActions.count()) === 0) throw new Error("missing open SpeedDial actions target");
  if (await openSpeedDialActions.evaluate((node) => node.classList.contains("MuiSpeedDial-actionsClosed"))) {
    throw new Error("open SpeedDial actions still had MuiSpeedDial-actionsClosed");
  }

  const openSpeedDialActionFab = page.locator(".MuiSpeedDialAction-fab", { hasText: "Edit" }).first();
  if ((await openSpeedDialActionFab.count()) === 0) throw new Error("missing open SpeedDialAction fab target");
  if (await openSpeedDialActionFab.evaluate((node) => node.classList.contains("MuiSpeedDialAction-fabClosed"))) {
    throw new Error("open SpeedDialAction fab still had MuiSpeedDialAction-fabClosed");
  }

  const visibleBottomNavigationLabel = page.locator(".MuiBottomNavigationAction-root", { hasText: "Visible label" }).first();
  if ((await visibleBottomNavigationLabel.count()) === 0) throw new Error("missing BottomNavigationAction showLabel target");
  if (await visibleBottomNavigationLabel.evaluate((node) => node.classList.contains("MuiBottomNavigationAction-iconOnly"))) {
    throw new Error("BottomNavigationAction showLabel still had iconOnly class on root");
  }

  if ((await page.locator(".MuiTooltip-popper:not(.MuiTooltip-popperInteractive)").count()) === 0) {
    throw new Error("disableInteractive Tooltip did not omit MuiTooltip-popperInteractive");
  }
  const topTooltip = page.locator(".MuiTooltip-tooltip.MuiTooltip-tooltipPlacementTop", { hasText: "Top tooltip" }).first();
  if ((await topTooltip.count()) === 0) {
    throw new Error("missing Tooltip top placement utility class");
  }
  if ((await topTooltip.locator(".MuiTooltip-arrow").count()) === 0) {
    throw new Error("Tooltip top placement lost arrow child while rendering title text");
  }

  const arrowTooltip = page.locator(".MuiTooltip-tooltip.MuiTooltip-tooltipArrow", { hasText: "Arrow tooltip" }).first();
  if ((await arrowTooltip.locator(".MuiTooltip-arrow").count()) === 0) {
    throw new Error("arrow Tooltip lost MuiTooltip-arrow child while rendering title text");
  }

  const autocomplete = page.locator(".MuiAutocomplete-root.MuiAutocomplete-fullWidth", { hasText: "Selected option" }).first();
  if ((await autocomplete.count()) === 0) throw new Error("missing Autocomplete fullWidth ownerState utility class");
  if ((await autocomplete.locator(".MuiAutocomplete-popupIndicator.MuiAutocomplete-popupIndicatorOpen").count()) === 0) {
    throw new Error("missing Autocomplete popupIndicatorOpen ownerState utility class");
  }
  if ((await autocomplete.locator(".MuiAutocomplete-popper.MuiAutocomplete-popperDisablePortal").count()) === 0) {
    throw new Error("missing Autocomplete popperDisablePortal ownerState utility class");
  }

  const surfaceStateCases = [
    [".MuiTypography-root.MuiTypography-gutterBottom.MuiTypography-noWrap", "Compact headline"],
    [".MuiTypography-root.MuiTypography-h6", "Section heading"],
    [".MuiTypography-root.MuiTypography-alignCenter", "Centered body copy"],
    [".MuiToolbar-root.MuiToolbar-dense", "Dense toolbar"],
    [".MuiAppBar-root.MuiAppBar-colorPrimary.MuiAppBar-positionFixed", "Toolbar title"],
    [".MuiAppBar-root.MuiAppBar-colorSecondary.MuiAppBar-positionStatic", "Static secondary app bar"],
    [".MuiLink-root.MuiLink-underlineHover", "Hover link"],
    [".MuiLink-root.MuiLink-underlineNone", "Plain link"],
    [".MuiSvgIcon-root.MuiSvgIcon-fontSizeSmall", null],
    [".MuiSvgIcon-root.MuiSvgIcon-colorSecondary", null],
    [".MuiSvgIcon-root.MuiSvgIcon-fontSizeLarge", null],
    [".MuiIcon-root.MuiIcon-fontSizeSmall", "menu"],
    [".MuiIcon-root.MuiIcon-colorSecondary", "menu"],
    [".MuiIcon-root.MuiIcon-fontSizeInherit", "search"],
  ];

  for (const [selector, label] of surfaceStateCases) {
    const locator = label ? page.locator(selector, { hasText: label }) : page.locator(selector);
    if ((await locator.count()) === 0) throw new Error(`missing surface ownerState utility class ${selector} for '${label}'`);
  }

  const absentSurfaceClasses = [
    [".MuiToolbar-root", "Flush toolbar", "MuiToolbar-gutters"],
    [".MuiPaper-root", "Square paper", "MuiPaper-rounded"],
    [".MuiAccordionActions-root", "Tight accordion action", "MuiAccordionActions-spacing"],
    [".MuiDialogActions-root", "Tight dialog action", "MuiDialogActions-spacing"],
    [".MuiCardActions-root", "Tight card action", "MuiCardActions-spacing"],
  ];

  for (const [selector, label, className] of absentSurfaceClasses) {
    const matches = await page.locator(selector).evaluateAll(
      (nodes, args) => nodes.filter((node) => node.textContent?.trim() === args.label).map((node) => node.classList.contains(args.className)),
      { label, className },
    );
    if (matches.length === 0) throw new Error(`missing surface state target ${selector} for '${label}'`);
    if (matches.some(Boolean)) {
      throw new Error(`expected ${selector} for '${label}' to omit ${className}`);
    }
  }

  const layoutStateCases = [
    [".MuiContainer-root.MuiContainer-fixed.MuiContainer-disableGutters", "Fixed flush container"],
    [".MuiContainer-root.MuiContainer-maxWidthLg", "Fixed flush container"],
    [".MuiContainer-root.MuiContainer-maxWidthMd", "Medium container"],
    [".MuiDialogContent-root.MuiDialogContent-dividers", "Divided dialog content"],
    [".MuiDialog-container.MuiDialog-scrollPaper", "Dialog title"],
    [".MuiDialog-paper.MuiDialog-paperWidthSm", "Dialog title"],
    [".MuiDialog-paper.MuiDialog-paperFullWidth.MuiDialog-paperFullScreen", "Full screen dialog body"],
    [".MuiDialog-container.MuiDialog-scrollBody", "Body scroll medium dialog body"],
    [".MuiDialog-paper.MuiDialog-paperWidthMd", "Body scroll medium dialog body"],
    [".MuiPaper-root.MuiPaper-outlined", "Outlined paper"],
    [".MuiPaper-root.MuiPaper-elevation.MuiPaper-elevation3", "Elevation three paper"],
    [".MuiCard-root.MuiPaper-elevation8", "Raised card content"],
    [".MuiDivider-root.MuiDivider-absolute.MuiDivider-flexItem", null],
    [".MuiDivider-root.MuiDivider-middle", null],
    [".MuiDivider-root.MuiDivider-inset", null],
    [".MuiDivider-root.MuiDivider-vertical.MuiDivider-flexItem", null],
    [".MuiDivider-root.MuiDivider-textAlignLeft", null],
  ];

  for (const [selector, label] of layoutStateCases) {
    const locator = label ? page.locator(selector, { hasText: label }) : page.locator(selector);
    if ((await locator.count()) === 0) throw new Error(`missing layout ownerState utility class ${selector}${label ? ` for '${label}'` : ""}`);
  }

  const switchBaseCases = [
    [".MuiCheckbox-root.MuiCheckbox-sizeSmall", "Small checkbox", "input[type='checkbox']", null],
    [".MuiCheckbox-root.MuiCheckbox-colorSecondary", "Secondary checkbox", "input[type='checkbox']", null],
    [".MuiCheckbox-root.Mui-checked", "Checked checkbox", "input[type='checkbox']", "checked"],
    [".MuiCheckbox-root.Mui-disabled", "Disabled checkbox", "input[type='checkbox']", "disabled"],
    [".MuiRadio-root.MuiRadio-sizeSmall", "Small radio", "input[type='radio']", null],
    [".MuiRadio-root.MuiRadio-colorSecondary", "Secondary radio", "input[type='radio']", null],
    [".MuiRadio-root.Mui-checked", "Checked radio", "input[type='radio']", "checked"],
    [".MuiRadio-root.Mui-disabled", "Disabled radio", "input[type='radio']", "disabled"],
  ];

  for (const [selector, label, inputSelector, property] of switchBaseCases) {
    const locator = page.locator(selector, { hasText: label });
    if ((await locator.count()) === 0) throw new Error(`missing SwitchBase state class ${selector} for '${label}'`);
    if (property) {
      const propSet = await locator.first().locator(inputSelector).evaluate((node, prop) => Boolean(node[prop]), property);
      if (!propSet) throw new Error(`SwitchBase state class ${selector} for '${label}' did not set input.${property}`);
    }
  }

  if ((await page.locator(".MuiCheckbox-root.MuiCheckbox-colorPrimary").count()) === 0) {
    throw new Error("missing default Checkbox primary color utility class");
  }
  if ((await page.locator(".MuiRadio-root.MuiRadio-colorPrimary").count()) === 0) {
    throw new Error("missing default Radio primary color utility class");
  }
  if ((await page.locator(".MuiSwitch-switchBase.MuiSwitch-colorPrimary").count()) === 0) {
    throw new Error("missing default Switch primary color utility class");
  }

  const smallSwitch = page.locator(".MuiSwitch-root.MuiSwitch-sizeSmall", { hasText: "Small switch" }).first();
  if ((await smallSwitch.count()) === 0) throw new Error("missing small Switch size utility class");

  const checkedSwitch = page.locator(".MuiSwitch-root", { hasText: "Checked switch" }).first();
  if ((await checkedSwitch.locator(".MuiSwitch-switchBase.Mui-checked").count()) === 0) throw new Error("missing checked Switch switchBase state class");
  if (!(await checkedSwitch.locator("input[type='checkbox']").evaluate((node) => node.checked))) {
    throw new Error("checked Switch did not set input.checked");
  }

  const secondarySwitch = page.locator(".MuiSwitch-root", { hasText: "Secondary switch" }).first();
  if ((await secondarySwitch.count()) === 0) throw new Error("missing secondary Switch target");
  if ((await secondarySwitch.locator(".MuiSwitch-switchBase.MuiSwitch-colorSecondary").count()) === 0) {
    throw new Error("missing secondary Switch color utility class");
  }

  const disabledSwitch = page.locator(".MuiSwitch-root", { hasText: "Disabled switch" }).first();
  if ((await disabledSwitch.locator(".MuiSwitch-switchBase.Mui-disabled").count()) === 0) throw new Error("missing disabled Switch switchBase state class");
  if (!(await disabledSwitch.locator("input[type='checkbox']").evaluate((node) => node.disabled))) {
    throw new Error("disabled Switch did not set input.disabled");
  }

  const formStateCases = [
    [".MuiFormControl-root.MuiFormControl-fullWidth", "Full width form"],
    [".MuiFormLabel-root.Mui-disabled.Mui-error.MuiFormLabel-filled.Mui-focused.Mui-required", "State form label"],
    [".MuiFormLabel-root.MuiFormLabel-colorSecondary", "Secondary form label"],
    [".MuiFormLabel-root.MuiFormLabel-colorSecondary.Mui-disabled.Mui-error.MuiFormLabel-filled.Mui-focused.Mui-required", "Context form label"],
    [".MuiInputLabel-root.Mui-disabled.Mui-error.Mui-focused.Mui-required.MuiInputLabel-shrink", "State input label"],
    [".MuiInputLabel-root.MuiInputLabel-sizeSmall.MuiInputLabel-outlined", "Outlined small input label"],
    [".MuiInputLabel-root.MuiInputLabel-filled", "Filled static input label"],
    [".MuiInputLabel-root.MuiInputLabel-sizeSmall.MuiInputLabel-filled.Mui-disabled.Mui-error.Mui-focused.Mui-required", "Context input label"],
    [".MuiFormHelperText-root.MuiFormHelperText-sizeSmall", "Small helper text"],
    [".MuiFormHelperText-root.MuiFormHelperText-contained", "Filled helper text"],
    [".MuiFormHelperText-root.MuiFormHelperText-contained", "Outlined helper text"],
    [".MuiFormHelperText-root.Mui-disabled.Mui-error.Mui-focused.MuiFormHelperText-filled.Mui-required", "State helper text"],
    [".MuiFormHelperText-root.MuiFormHelperText-sizeSmall.MuiFormHelperText-contained.Mui-disabled.Mui-error.Mui-focused.MuiFormHelperText-filled.Mui-required", "Context helper text"],
  ];

  for (const [selector, label] of formStateCases) {
    const locator = page.locator(selector, { hasText: label });
    if ((await locator.count()) === 0) throw new Error(`missing form ownerState utility class ${selector} for '${label}'`);
  }

  const staticInputLabel = page.locator(".MuiInputLabel-root", { hasText: "Filled static input label" }).first();
  if ((await staticInputLabel.count()) === 0) throw new Error("missing filled static InputLabel target");
  if (await staticInputLabel.evaluate((node) => node.classList.contains("MuiInputLabel-animated"))) {
    throw new Error("disableAnimation InputLabel still had MuiInputLabel-animated");
  }

  const formLayoutStateCases = [
    [".MuiFormGroup-root.MuiFormGroup-row.Mui-error", "State form control label"],
    [".MuiFormControlLabel-root.Mui-disabled.Mui-error.Mui-required", "State form control label"],
    [".MuiFormControlLabel-root.MuiFormControlLabel-labelPlacementStart", "Start label placement"],
    [".MuiFormControlLabel-root.MuiFormControlLabel-labelPlacementTop", "Top label placement"],
    [".MuiFormControlLabel-root.MuiFormControlLabel-labelPlacementBottom", "Bottom label placement"],
    [".MuiRadioGroup-root.MuiRadioGroup-row.Mui-error", "Row error radio"],
  ];

  for (const [selector, label] of formLayoutStateCases) {
    const locator = page.locator(selector, { hasText: label });
    if ((await locator.count()) === 0) throw new Error(`missing form layout ownerState utility class ${selector} for '${label}'`);
  }

  const disabledControlLabel = page.locator(".MuiFormControlLabel-root.Mui-disabled", { hasText: "State form control label" }).first();
  if ((await disabledControlLabel.locator(".MuiFormControlLabel-label.Mui-disabled").count()) === 0) {
    throw new Error("disabled FormControlLabel did not set the label disabled utility class");
  }

  const defaultControlLabel = page.locator(".MuiFormControlLabel-root", { hasText: "Checked checkbox" }).first();
  if ((await defaultControlLabel.count()) === 0) throw new Error("missing default FormControlLabel target");
  if (await defaultControlLabel.evaluate((node) => node.classList.contains("MuiFormControlLabel-labelPlacementEnd"))) {
    throw new Error("default FormControlLabel emitted stale labelPlacementEnd utility class");
  }

  const inputStateCases = [
    [".MuiInputBase-root.Mui-disabled.Mui-error.Mui-focused.MuiInputBase-fullWidth.MuiInputBase-hiddenLabel.MuiInputBase-multiline.Mui-readOnly", "State input base", true, true],
    [".MuiInput-root.Mui-disabled.Mui-error.Mui-focused.MuiInputBase-fullWidth.MuiInputBase-multiline.Mui-readOnly", "State input", true, true],
    [".MuiFilledInput-root.Mui-disabled.Mui-error.Mui-focused.MuiInputBase-fullWidth.MuiInputBase-hiddenLabel.MuiFilledInput-hiddenLabel.MuiInputBase-multiline.MuiFilledInput-multiline.Mui-readOnly", "State filled input", true, true],
    [".MuiOutlinedInput-root.Mui-disabled.Mui-error.Mui-focused.MuiInputBase-fullWidth.MuiInputBase-hiddenLabel.MuiInputBase-multiline.MuiOutlinedInput-multiline.Mui-readOnly", "State outlined input", true, true],
    [".MuiInputBase-root.MuiInputBase-colorSecondary.Mui-disabled.Mui-error.Mui-focused.MuiInputBase-hiddenLabel.MuiInputBase-sizeSmall", "Context base input", true, false, true],
  ];

  for (const [selector, label, expectDisabled, expectReadOnly, expectRequired] of inputStateCases) {
    const locator = page.locator(selector, { hasText: label });
    if ((await locator.count()) === 0) throw new Error(`missing input ownerState utility class ${selector} for '${label}'`);
    const input = locator.first().locator("input");
    if (expectDisabled && !(await input.evaluate((node) => node.disabled))) throw new Error(`${label} did not set input.disabled`);
    if (expectReadOnly && !(await input.evaluate((node) => node.readOnly))) throw new Error(`${label} did not set input.readOnly`);
    if (expectRequired && !(await input.evaluate((node) => node.required))) throw new Error(`${label} did not set input.required`);
  }

  const secondaryInputCases = [
    [".MuiInput-root.MuiInputBase-colorSecondary", "Secondary input"],
    [".MuiInputBase-root.MuiInputBase-colorSecondary", "Secondary base input"],
    [".MuiFilledInput-root.MuiInputBase-colorSecondary", "Secondary filled input"],
    [".MuiOutlinedInput-root.MuiInputBase-colorSecondary", "Secondary outlined input"],
  ];

  for (const [selector, label] of secondaryInputCases) {
    const locator = page.locator(selector, { hasText: label });
    if ((await locator.count()) === 0) throw new Error(`missing input color ownerState utility class ${selector} for '${label}'`);
  }

  const adornment = page.locator(
    ".MuiInputAdornment-root.MuiInputAdornment-sizeMedium.MuiInputAdornment-disablePointerEvents.MuiInputAdornment-hiddenLabel",
    { hasText: "Hidden adornment" },
  );
  if ((await adornment.count()) === 0) throw new Error("missing InputAdornment ownerState utility classes");

  const defaultAdornment = page.locator(
    ".MuiInputAdornment-root.MuiInputAdornment-positionStart.MuiInputAdornment-standard.MuiInputAdornment-sizeMedium",
    { hasText: "$" },
  );
  if ((await defaultAdornment.count()) === 0) throw new Error("missing default InputAdornment ownerState utility classes");

  const endAdornment = page.locator(
    ".MuiInputAdornment-root.MuiInputAdornment-positionEnd.MuiInputAdornment-standard.MuiInputAdornment-sizeMedium",
    { hasText: "kg" },
  );
  if ((await endAdornment.count()) === 0) throw new Error("missing end-position InputAdornment ownerState utility classes");

  const selectRoot = page.locator(".MuiSelect-root.Mui-disabled.Mui-error", { hasText: "State select" }).first();
  if ((await selectRoot.count()) === 0) throw new Error("missing Select root disabled/error ownerState utility classes");
  if ((await selectRoot.locator(".MuiSelect-select.Mui-disabled.MuiSelect-multiple.Mui-error", { hasText: "State select" }).count()) === 0) {
    throw new Error("missing Select select-slot ownerState utility classes");
  }
  if ((await selectRoot.locator(".MuiSelect-icon.MuiSelect-iconOpen.Mui-disabled").count()) === 0) {
    throw new Error("missing Select icon-slot open/disabled ownerState utility classes");
  }
  if (!(await selectRoot.locator("input.MuiSelect-nativeInput").evaluate((node) => node instanceof HTMLInputElement && node.disabled))) {
    throw new Error("disabled Select did not set native input.disabled");
  }

  const defaultSelect = page.locator(".MuiSelect-root", { hasText: "First option" }).first();
  if ((await defaultSelect.count()) === 0) throw new Error("missing default Select target");
  if ((await defaultSelect.locator(".MuiSelect-select.MuiSelect-outlined").count()) === 0) {
    throw new Error("missing default Select outlined utility class");
  }
  const standardSelect = page.locator(".MuiSelect-root", { hasText: "Standard select" }).first();
  if ((await standardSelect.count()) === 0) throw new Error("missing standard Select target");
  if ((await standardSelect.locator(".MuiSelect-select.MuiSelect-standard").count()) === 0) {
    throw new Error("missing standard Select utility class");
  }
  const secondarySelect = page.locator(".MuiSelect-root.MuiInputBase-colorSecondary", { hasText: "Secondary select" }).first();
  if ((await secondarySelect.count()) === 0) throw new Error("missing secondary Select input color utility class");

  const nativeSelectRoot = page.locator(".MuiNativeSelect-root.Mui-disabled.Mui-error", { hasText: "Disabled native option" }).first();
  if ((await nativeSelectRoot.count()) === 0) throw new Error("missing NativeSelect root disabled/error ownerState utility classes");
  const nativeSelect = nativeSelectRoot.locator("select.MuiNativeSelect-select.Mui-disabled.MuiNativeSelect-multiple.Mui-error");
  if ((await nativeSelect.count()) === 0) throw new Error("missing NativeSelect select-slot ownerState utility classes");
  if (!(await nativeSelect.evaluate((node) => node instanceof HTMLSelectElement && node.disabled && node.multiple))) {
    throw new Error("NativeSelect did not set select.disabled and select.multiple");
  }
  if ((await nativeSelectRoot.locator(".MuiNativeSelect-icon.Mui-disabled").count()) === 0) {
    throw new Error("missing NativeSelect icon-slot disabled ownerState utility class");
  }

  const defaultNativeSelect = page.locator(".MuiNativeSelect-root", { hasText: "Native option" }).first();
  if ((await defaultNativeSelect.count()) === 0) throw new Error("missing default NativeSelect target");
  if ((await defaultNativeSelect.locator("select.MuiNativeSelect-select.MuiNativeSelect-standard").count()) === 0) {
    throw new Error("missing default NativeSelect standard utility class");
  }
  const outlinedNativeSelect = page.locator(".MuiNativeSelect-root", { hasText: "Outlined native option" }).first();
  if ((await outlinedNativeSelect.count()) === 0) throw new Error("missing outlined NativeSelect target");
  if ((await outlinedNativeSelect.locator("select.MuiNativeSelect-select.MuiNativeSelect-outlined").count()) === 0) {
    throw new Error("missing outlined NativeSelect utility class");
  }
  const secondaryNativeSelect = page.locator(".MuiNativeSelect-root.MuiInputBase-colorSecondary", { hasText: "Secondary native option" }).first();
  if ((await secondaryNativeSelect.count()) === 0) throw new Error("missing secondary NativeSelect input color utility class");

  const textField = page.locator(".MuiTextField-root.MuiFormControl-fullWidth", { hasText: "State text field" }).first();
  if ((await textField.count()) === 0) throw new Error("missing TextField fullWidth ownerState utility class");
  if ((await textField.locator(".MuiInputLabel-root.Mui-disabled.Mui-error.Mui-required").count()) === 0) {
    throw new Error("missing TextField InputLabel forwarded state classes");
  }
  if ((await textField.locator(".MuiOutlinedInput-root.Mui-disabled.Mui-error.MuiInputBase-fullWidth.MuiInputBase-multiline.MuiOutlinedInput-multiline").count()) === 0) {
    throw new Error("missing TextField OutlinedInput ownerState classes");
  }
  if (!(await textField.locator("input").evaluate((node) => node.disabled))) {
    throw new Error("TextField did not set input.disabled");
  }
  const secondaryTextField = page.locator(".MuiTextField-root", { hasText: "Secondary text field" }).first();
  if ((await secondaryTextField.count()) === 0) throw new Error("missing secondary TextField target");
  if ((await secondaryTextField.locator(".MuiOutlinedInput-root.MuiInputBase-colorSecondary").count()) === 0) {
    throw new Error("missing secondary TextField input color utility class");
  }

  const defaultAvatar = page.locator(".MuiAvatar-root.MuiAvatar-circular.MuiAvatar-colorDefault", { hasText: "A" }).first();
  if ((await defaultAvatar.count()) === 0) throw new Error("missing default Avatar ownerState utility classes");
  const roundedAvatar = page.locator(".MuiAvatar-root.MuiAvatar-rounded.MuiAvatar-colorDefault", { hasText: "R" }).first();
  if ((await roundedAvatar.count()) === 0) throw new Error("missing rounded Avatar ownerState utility classes");

  const defaultAlert = page.locator(".MuiAlert-root.MuiAlert-colorSuccess.MuiAlert-standard", { hasText: "Check the SA driven MUI surface." }).first();
  if ((await defaultAlert.count()) === 0) throw new Error("missing default Alert ownerState utility classes");
  const filledWarningAlert = page.locator(".MuiAlert-root.MuiAlert-colorWarning.MuiAlert-filled", { hasText: "Filled warning alert" }).first();
  if ((await filledWarningAlert.count()) === 0) throw new Error("missing filled warning Alert ownerState utility classes");
}

async function run(outDir) {
  const { server, url } = await startStaticServer(outDir);
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

    await page.goto(url, { waitUntil: "networkidle" });
    await expectMountedMui(page);

    if (pageErrors.length !== 0) throw new Error(`browser console/page errors:\n${pageErrors.join("\n")}`);
    const fatalRequests = failedRequests.filter((line) => !line.includes("/favicon.ico"));
    if (fatalRequests.length !== 0) throw new Error(`browser request failures:\n${fatalRequests.join("\n")}`);
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

const [, , outDir] = process.argv;
if (!outDir) {
  console.error("usage: node tools/verify_mui_browser.mjs <react-build-output-dir>");
  process.exit(2);
}

await access(path.join(outDir, "index.html"));
await access(path.join(outDir, "airlock.js"));
await access(path.join(outDir, "app.wasm"));
await run(outDir);
console.log("[PASS] mui browser chromium");
