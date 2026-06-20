import { access, readFile, readdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const playwrightCacheDir = path.join(process.env.HOME ?? "", ".cache", "ms-playwright");
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function chromiumExecutablePath() {
  return path.join(playwrightCacheDir, "chromium-1179", "chrome-linux", "chrome");
}

async function resolveChromiumExecutablePath() {
  if (process.env.MUI_BROWSER_EXECUTABLE) return process.env.MUI_BROWSER_EXECUTABLE;

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
  if (file.endsWith(".webp")) return "image/webp";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  if (file.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function resolveStaticFile(rootDir, safePath) {
  return [
    path.join(rootDir, safePath),
    path.join(repoRoot, safePath),
  ];
}

function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const fileName = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        const safePath = path.normalize(fileName).replace(/^(\.\.(\/|\\|$))+/, "");
        let filePath = null;
        let body = null;
        for (const candidate of resolveStaticFile(rootDir, safePath)) {
          try {
            body = await readFile(candidate);
            filePath = candidate;
            break;
          } catch {}
        }
        if (!filePath || !body) throw new Error(`missing static asset: ${safePath}`);
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

async function expectImagesLoaded(page) {
  await page.waitForFunction(
    () => Array.from(document.images).every((img) => {
      if (img.classList.contains("MuiAvatar-imgHidden")) return true;
      const style = getComputedStyle(img);
      const rect = img.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || img.hidden || rect.width <= 1 || rect.height <= 1) return true;
      return img.complete && img.naturalWidth > 0;
    }),
    null,
    { timeout: 5000 },
  ).catch(() => {});

  const broken = await page.locator("img").evaluateAll((images) =>
    images
      .filter((img) => {
        if (!(img instanceof HTMLImageElement)) return false;
        if (img.classList.contains("MuiAvatar-imgHidden")) return false;
        const style = getComputedStyle(img);
        const rect = img.getBoundingClientRect();
        if (style.display === "none" || style.visibility === "hidden" || img.hidden || rect.width <= 1 || rect.height <= 1) return false;
        return !img.complete || img.naturalWidth === 0;
      })
      .map((img) => img.getAttribute("src") ?? "<missing src>"),
  );
  if (broken.length !== 0) throw new Error(`broken images:\n${broken.join("\n")}`);
}

async function expectMountedMui(page) {
  await page.waitForSelector(".mui-basic-demo", { timeout: 10000 });
  await expectImagesLoaded(page);
  const bodyText = await page.locator("body").textContent();
  if (!bodyText?.includes("SA driven MUI")) throw new Error("missing projected Typography text 'SA driven MUI'");

  const requiredSelectors = [
    ".MuiButton-root",
    ".MuiThemeProvider-root.MuiThemeProvider-modeDark",
    ".MuiCssVarsProvider-root.MuiCssVarsProvider-modeDark",
    ".MuiIconify-root.MuiIconify-hasIcon",
    ".MuiLoadingButton-root.MuiLoadingButton-loading",
    ".MuiTimeline-root",
    ".MuiMasonry-root",
    ".MuiTabContext-root",
    ".MuiTreeView-root",
    ".MuiTreeItem-root",
    ".MuiResponsiveBox-root",
    ".MuiHidden-root.MuiHidden-smDown",
    ".mui-material-icons-grid",
    ".MuiAutocomplete-root",
    ".MuiPopper-root",
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

  const loadingButton = page.locator(".MuiLoadingButton-root.MuiLoadingButton-loading", { hasText: "Saving theme" }).first();
  if ((await loadingButton.count()) === 0) throw new Error("missing loading Button lab component state");
  if (!(await loadingButton.evaluate((node) => node instanceof HTMLButtonElement && node.disabled))) {
    throw new Error("loading Button did not set native disabled state");
  }
  if (!(await loadingButton.evaluate((node) => node.classList.contains("MuiLoadingButton-loadingPositionStart")))) {
    throw new Error("start LoadingButton did not emit loadingPositionStart root class");
  }
  const loadingButtonIndicator = loadingButton.locator(".MuiLoadingButton-loadingIndicator.MuiLoadingButton-loadingIndicatorStart");
  if ((await loadingButtonIndicator.count()) === 0) {
    throw new Error("start LoadingButton did not emit loadingIndicatorStart class");
  }
  const loadingEndButton = page.locator(".MuiLoadingButton-root.MuiLoadingButton-loading.MuiLoadingButton-loadingPositionEnd", { hasText: "Loading end" }).first();
  if ((await loadingEndButton.count()) === 0) throw new Error("missing end LoadingButton loadingPosition class");
  if ((await loadingEndButton.locator(".MuiLoadingButton-loadingIndicator.MuiLoadingButton-loadingIndicatorEnd").count()) === 0) {
    throw new Error("end LoadingButton did not emit loadingIndicatorEnd class");
  }

  const labCases = [
    [".MuiTimelineItem-root.MuiTimelineItem-missingOppositeContent", "Order placed"],
    [".MuiTimelineDot-root.MuiTimelineDot-primary", null],
    [".MuiTimelineDot-root.MuiTimelineDot-success.MuiTimelineDot-outlined", null],
    [".MuiTimelineConnector-root", null],
    [".MuiMasonry-root.MuiMasonry-columns3", "Short masonry card"],
    [".MuiTabPanel-root", "Overview panel"],
    [".MuiTabContext-root[data-value='settings'] .MuiTabs-root.MuiTabs-vertical", "Vertical settings tab"],
    [".MuiTabContext-root[data-value='settings'] .MuiTabPanel-root.MuiTabPanel-keepMounted[data-value='settings']", "Context settings panel"],
    [".MuiTreeView-root.MuiSimpleTreeView-root.MuiTreeView-multiSelect.MuiTreeView-disableSelection", "Dashboard tree"],
    [".MuiTreeItem-root.Mui-expanded", "Dashboard tree"],
    [".MuiTreeItem-root.Mui-selected", "Finance tree item"],
    [".MuiTreeItem-root.Mui-disabled", "Disabled tree item"],
    [".MuiThemeProvider-root.MuiThemeProvider-colorPrimary", null],
    [".MuiThemeProvider-root.MuiThemeProvider-colorSecondary", "Secondary theme"],
    [".MuiThemeProvider-root.MuiThemeProvider-colorSuccess", "Success theme"],
    [".MuiThemeProvider-root.MuiThemeProvider-colorWarning", "Warning theme"],
    [".MuiThemeProvider-root.MuiThemeProvider-colorError", "Error theme"],
    [".MuiThemeProvider-root.MuiThemeProvider-colorInfo", "Info theme"],
    [".MuiCssVarsProvider-root.MuiCssVarsProvider-colorSecondary", "Dark secondary CSS vars provider"],
    [".mui-theme-palette-card", "Primary theme"],
    [".MuiGrid-root.MuiGrid-container.MuiGrid-spacing-xs-2.MuiGrid-direction-xs-row-reverse.MuiGrid-wrap-xs-wrap-reverse.mui-grid-owner-state", "Grid half item"],
    [".MuiGrid-root.MuiGrid-grid-xs-6.MuiGrid-direction-xs-row", "Grid half item"],
    [".MuiGrid-root.MuiGrid-grid-xs-12.MuiGrid-direction-xs-row", "Grid full item"],
    [".MuiStack-root.MuiStack-directionRow.MuiStack-spacing2.MuiStack-useFlexGap.mui-stack-owner-state", "Row stack item"],
    [".MuiStack-root.MuiStack-directionColumn.MuiStack-spacing0", "Save"],
    [".MuiIconify-root.MuiIconify-colorSecondary", "Search iconify"],
    [".MuiIconify-root.MuiIconify-colorWarning", "Bell iconify"],
    [".mui-material-icon-sample", "Search material icon"],
    [".mui-material-icon-sample", "Notifications material icon"],
    [".mui-material-icon-sample", "Account material icon"],
    [".mui-material-icon-sample", "Dashboard material icon"],
    [".mui-material-icon-sample", "Shopping bag material icon"],
    [".mui-material-icon-sample", "Add material icon"],
    [".mui-material-icon-sample", "Cart material icon"],
    [".mui-material-icon-sample", "Done all material icon"],
    [".mui-material-icon-sample", "Share material icon"],
    [".mui-material-icon-sample", "Restart material icon"],
    [".mui-material-icon-sample", "Arrow material icon"],
    [".mui-material-icon-sample", "Time material icon"],
  ];

  for (const [selector, label] of labCases) {
    const locator = label ? page.locator(selector, { hasText: label }) : page.locator(selector);
    if ((await locator.count()) === 0) throw new Error(`missing new theme/lab/icon/responsive class ${selector}${label ? ` for '${label}'` : ""}`);
  }

  const tree = page.locator(".MuiTreeView-root.MuiSimpleTreeView-root", { hasText: "Dashboard tree" }).first();
  if ((await tree.count()) === 0) throw new Error("missing SimpleTreeView dashboard target");
  if ((await tree.getAttribute("role")) !== "tree") throw new Error("SimpleTreeView did not emit role=tree");
  if ((await tree.getAttribute("aria-label")) !== "Dashboard navigation") throw new Error("SimpleTreeView did not emit aria-label");
  if ((await tree.getAttribute("aria-multiselectable")) !== "true") throw new Error("SimpleTreeView did not emit aria-multiselectable true");
  if ((await tree.getAttribute("data-expanded-items")) !== "root,finance") throw new Error("SimpleTreeView did not preserve expandedItems data attribute");
  if ((await tree.getAttribute("data-selected-items")) !== "finance") throw new Error("SimpleTreeView did not preserve selectedItems data attribute");
  if ((await tree.locator(".MuiTreeItem-root.Mui-expanded[data-node-id='root'][aria-expanded='true'][aria-level='1']").count()) === 0) {
    throw new Error("missing expanded TreeItem role attributes");
  }
  if ((await tree.locator(".MuiTreeItem-root.Mui-selected[data-node-id='finance'][aria-selected='true'][aria-level='2'] .MuiTreeItem-content.Mui-selected").count()) === 0) {
    throw new Error("missing selected TreeItem utility classes and aria state");
  }
  if ((await tree.locator(".MuiTreeItem-root.Mui-disabled[data-node-id='disabled'][aria-disabled='true'][aria-level='2'] .MuiTreeItem-content.Mui-disabled").count()) === 0) {
    throw new Error("missing disabled TreeItem utility classes and aria state");
  }

  const materialIconLabels = [
    "Search material icon",
    "Notifications material icon",
    "Account material icon",
    "Dashboard material icon",
    "Shopping bag material icon",
  ];

  for (const label of materialIconLabels) {
    const sample = page.locator(".mui-material-icon-sample", { hasText: label }).first();
    if ((await sample.count()) === 0) throw new Error(`missing material icon sample '${label}'`);
    if ((await sample.locator(".MuiSvgIcon-root path").count()) === 0) {
      throw new Error(`material icon sample '${label}' did not render through SvgIcon`);
    }
  }

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

  const defaultButtonGroup = page.locator(".MuiButtonGroup-root.MuiButtonGroup-horizontal[data-color='primary'][data-disabled='0'][data-disable-elevation='0'][data-full-width='0'][data-orientation='horizontal'][data-size='medium'][data-variant='outlined']", { hasText: "Grouped" }).first();
  if ((await defaultButtonGroup.count()) === 0) throw new Error("missing default ButtonGroup DOM data contract");
  const containedInheritButtonGroup = page.locator(".MuiButtonGroup-root.MuiButtonGroup-contained.MuiButtonGroup-colorInherit[data-disabled='0'][data-disable-elevation='0'][data-full-width='0'][data-orientation='horizontal'][data-size='medium'][data-variant='contained']", { hasText: "Contained inherit grouped" }).first();
  if ((await containedInheritButtonGroup.count()) === 0) throw new Error("missing contained inherit ButtonGroup DOM data contract");
  if (!((await containedInheritButtonGroup.getAttribute("data-color")) || "").startsWith("inherit")) {
    throw new Error("contained inherit ButtonGroup did not preserve inherit data-color");
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
    [".MuiBottomNavigationAction-root.Mui-disabled", "Library disabled label", true],
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

  const selectedMenuItem = page.locator(".MuiMenuItem-root.Mui-selected[data-dense='0'][data-disabled='0'][data-disable-gutters='0'][data-divider='0'][data-selected='1'][data-value='']", { hasText: "Selected menu option" }).first();
  if ((await selectedMenuItem.count()) === 0) throw new Error("missing selected MenuItem DOM data contract");
  const disabledMenuItem = page.locator(".MuiMenuItem-root.Mui-disabled[data-dense='0'][data-disabled='1'][data-disable-gutters='0'][data-divider='0'][data-selected='0'][data-value='']", { hasText: "Disabled menu option" }).first();
  if ((await disabledMenuItem.count()) === 0) throw new Error("missing disabled MenuItem DOM data contract");

  const disabledCardActionArea = page.locator(".MuiCardActionArea-root.Mui-disabled[data-disabled='1']", { hasText: "Action media" }).first();
  if ((await disabledCardActionArea.count()) === 0) throw new Error("missing disabled CardActionArea DOM data contract");
  if (!(await disabledCardActionArea.evaluate((node) => node instanceof HTMLButtonElement && node.disabled))) {
    throw new Error("disabled CardActionArea did not set native disabled");
  }

  const selectedListItemButton = page.locator(".MuiListItemButton-root.Mui-selected[data-align-items='center'][data-dense='0'][data-disabled='0'][data-disable-gutters='0'][data-divider='0'][data-selected='1']", { hasText: "Open inbox" }).first();
  if ((await selectedListItemButton.count()) === 0) throw new Error("missing selected ListItemButton DOM data contract");
  const disabledListItemButton = page.locator(".MuiListItemButton-root.Mui-disabled[data-align-items='center'][data-dense='0'][data-disabled='1'][data-disable-gutters='0'][data-divider='0'][data-selected='0']", { hasText: "Disabled inbox" }).first();
  if ((await disabledListItemButton.count()) === 0) throw new Error("missing disabled ListItemButton DOM data contract");
  const denseSelectedListItemButton = page.locator(".MuiListItemButton-root.MuiListItemButton-dense.MuiListItemButton-divider.Mui-selected[data-align-items='center'][data-dense='1'][data-disabled='0'][data-disable-gutters='1'][data-divider='1'][data-selected='1']", { hasText: "Dense selected action" }).first();
  if ((await denseSelectedListItemButton.count()) === 0) throw new Error("missing dense selected ListItemButton DOM data contract");

  const horizontalStepper = page.locator(".MuiStepper-root.MuiStepper-horizontal.MuiStepper-alternativeLabel[data-active-step='1'][data-alternative-label='1'][data-non-linear='1'][data-orientation='horizontal']", { hasText: "First step" }).first();
  if ((await horizontalStepper.count()) === 0) throw new Error("missing horizontal Stepper DOM data contract");
  const verticalStepper = page.locator(".MuiStepper-root.MuiStepper-vertical[data-active-step='0'][data-alternative-label='0'][data-non-linear='0'][data-orientation='vertical']", { hasText: "Vertical first step" }).first();
  if ((await verticalStepper.count()) === 0) throw new Error("missing vertical Stepper DOM data contract");

  const firstStep = page.locator(".MuiStep-root.MuiStep-horizontal[data-active='0'][data-alternative-label='0'][data-completed='0'][data-disabled='0'][data-expanded='0'][data-index='0'][data-last='0'][data-orientation='horizontal']", { hasText: "First step" }).first();
  if ((await firstStep.count()) === 0) throw new Error("missing default Step DOM data contract");
  const defaultStepContent = page.locator(".MuiStepContent-root[data-active='0'][data-last='0'][data-transition-duration='auto']", { hasText: "Step content" }).first();
  if ((await defaultStepContent.count()) === 0) throw new Error("missing default StepContent DOM data contract");
  const configuredStepContent = page.locator(".MuiStepContent-root[data-active='1'][data-last='1'][data-transition-duration='225']", { hasText: "Configured step content" }).first();
  if ((await configuredStepContent.count()) === 0) throw new Error("missing configured StepContent DOM data contract");
  const completedStep = page.locator(".MuiStep-root.MuiStep-horizontal.Mui-completed[data-active='0'][data-alternative-label='0'][data-completed='1'][data-disabled='0'][data-expanded='1'][data-index='1'][data-last='0'][data-orientation='horizontal']", { hasText: "Completed step label" }).first();
  if ((await completedStep.count()) === 0) throw new Error("missing completed Step DOM data contract");
  const disabledLastStep = page.locator(".MuiStep-root.MuiStep-horizontal[data-active='0'][data-alternative-label='0'][data-completed='0'][data-disabled='1'][data-expanded='0'][data-index='2'][data-last='1'][data-orientation='horizontal']", { hasText: "Second step" }).first();
  if ((await disabledLastStep.count()) === 0) throw new Error("missing disabled last Step DOM data contract");
  const verticalLastStep = page.locator(".MuiStep-root.MuiStep-vertical[data-active='0'][data-alternative-label='0'][data-completed='0'][data-disabled='0'][data-expanded='0'][data-index='1'][data-last='1'][data-orientation='vertical']", { hasText: "Vertical second step" }).first();
  if ((await verticalLastStep.count()) === 0) throw new Error("missing vertical Step DOM data contract");

  const completedStepConnector = page.locator(".MuiStepConnector-root.MuiStepConnector-horizontal.MuiStepConnector-alternativeLabel.Mui-active.Mui-completed[data-active='1'][data-alternative-label='1'][data-completed='1'][data-disabled='0'][data-orientation='horizontal']").first();
  if ((await completedStepConnector.count()) === 0) throw new Error("missing completed StepConnector DOM data contract");
  const disabledStepConnector = page.locator(".MuiStepConnector-root.MuiStepConnector-horizontal.Mui-disabled[data-active='0'][data-alternative-label='0'][data-completed='0'][data-disabled='1'][data-orientation='horizontal']").first();
  if ((await disabledStepConnector.count()) === 0) throw new Error("missing disabled StepConnector DOM data contract");
  const verticalStepConnector = page.locator(".MuiStepConnector-root.MuiStepConnector-vertical[data-active='0'][data-alternative-label='0'][data-completed='0'][data-disabled='0'][data-orientation='vertical']").first();
  if ((await verticalStepConnector.count()) === 0) throw new Error("missing vertical StepConnector DOM data contract");

  const defaultStepIcon = page.locator(".MuiStepIcon-root[data-active='0'][data-completed='0'][data-error='0'][data-icon='']").first();
  if ((await defaultStepIcon.count()) === 0) throw new Error("missing default StepIcon DOM data contract");
  const activeStepIcon = page.locator(".MuiStepIcon-root.Mui-active[data-active='1'][data-completed='0'][data-error='0'][data-icon='']").first();
  if ((await activeStepIcon.count()) === 0) throw new Error("missing active StepIcon DOM data contract");
  const completedStepIcon = page.locator(".MuiStepIcon-root.Mui-completed[data-active='0'][data-completed='1'][data-error='0'][data-icon='']").first();
  if ((await completedStepIcon.count()) === 0) throw new Error("missing completed StepIcon DOM data contract");
  const errorStepIcon = page.locator(".MuiStepIcon-root.Mui-error[data-active='0'][data-completed='0'][data-error='1'][data-icon='']").first();
  if ((await errorStepIcon.count()) === 0) throw new Error("missing error StepIcon DOM data contract");

  const completedStepButton = page.locator(".MuiStepButton-root.MuiStepButton-horizontal[data-active='1'][data-completed='1'][data-disabled='0'][data-icon=''][data-optional='0'][data-orientation='horizontal']", { hasText: "Completed step button" }).first();
  if ((await completedStepButton.count()) === 0) throw new Error("missing completed StepButton DOM data contract");
  const disabledStepButton = page.locator(".MuiStepButton-root.Mui-disabled.MuiStepButton-horizontal[data-active='0'][data-completed='0'][data-disabled='1'][data-icon=''][data-optional='0'][data-orientation='horizontal']", { hasText: "Disabled step" }).first();
  if ((await disabledStepButton.count()) === 0) throw new Error("missing disabled StepButton DOM data contract");
  const verticalStepButton = page.locator(".MuiStepButton-root.MuiStepButton-vertical[data-active='0'][data-completed='0'][data-disabled='0'][data-icon=''][data-optional='0'][data-orientation='vertical']", { hasText: "Vertical second step" }).first();
  if ((await verticalStepButton.count()) === 0) throw new Error("missing vertical StepButton DOM data contract");

  const completedStepLabel = page.locator(".MuiStepLabel-root[data-active='1'][data-alternative-label='0'][data-completed='1'][data-disabled='0'][data-error='0'][data-icon=''][data-optional='0'][data-orientation='horizontal']", { hasText: "Completed step label" }).first();
  if ((await completedStepLabel.count()) === 0) throw new Error("missing completed StepLabel DOM data contract");
  const erroredStepLabel = page.locator(".MuiStepLabel-root.Mui-error[data-active='0'][data-alternative-label='0'][data-completed='0'][data-disabled='0'][data-error='1'][data-icon=''][data-optional='0'][data-orientation='horizontal']", { hasText: "Errored step label" }).first();
  if ((await erroredStepLabel.count()) === 0) throw new Error("missing errored StepLabel DOM data contract");
  const disabledStepLabel = page.locator(".MuiStepLabel-root.Mui-disabled[data-active='0'][data-alternative-label='0'][data-completed='0'][data-disabled='1'][data-error='0'][data-icon=''][data-optional='0'][data-orientation='horizontal']", { hasText: "Disabled step label" }).first();
  if ((await disabledStepLabel.count()) === 0) throw new Error("missing disabled StepLabel DOM data contract");
  const verticalStepLabel = page.locator(".MuiStepLabel-root.MuiStepLabel-vertical[data-active='0'][data-alternative-label='0'][data-completed='0'][data-disabled='0'][data-error='0'][data-icon=''][data-optional='0'][data-orientation='vertical']", { hasText: "Vertical first step" }).first();
  if ((await verticalStepLabel.count()) === 0) throw new Error("missing vertical StepLabel DOM data contract");

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
    [".MuiAccordion-root.Mui-expanded[data-default-expanded='0'][data-disabled='0'][data-disable-gutters='0'][data-expanded='1'][data-square='0']", "Expanded accordion summary"],
    [".MuiAccordion-root.Mui-disabled[data-default-expanded='0'][data-disabled='1'][data-disable-gutters='0'][data-expanded='0'][data-square='0']", "Disabled accordion summary"],
    [".MuiAccordion-root[data-default-expanded='1'][data-disabled='0'][data-disable-gutters='0'][data-expanded='0'][data-square='0']", "Default expanded accordion summary"],
    [".MuiAccordionSummary-root.Mui-expanded[data-disabled='0'][data-disable-gutters='0'][data-expanded='1']", "Expanded accordion summary", false],
    [".MuiAccordionSummary-content.Mui-expanded[data-summary-expanded='1']", "Expanded accordion summary", false],
    [".MuiAccordionSummary-root.Mui-disabled[data-disabled='1'][data-disable-gutters='0'][data-expanded='0']", "Disabled accordion summary", true],
  ];

  for (const [selector, label, expectNativeDisabled] of accordionStateCases) {
    const locator = page.locator(selector, { hasText: label });
    if ((await locator.count()) === 0) throw new Error(`missing Accordion ownerState utility class ${selector} for '${label}'`);
    if (expectNativeDisabled && !(await locator.first().evaluate((node) => node instanceof HTMLButtonElement && node.disabled))) {
      throw new Error(`Accordion state class ${selector} for '${label}' did not set native disabled`);
    }
  }

  const flushAccordion = page.locator(".MuiAccordion-root[data-default-expanded='0'][data-disabled='0'][data-disable-gutters='1'][data-expanded='0'][data-square='1']", { hasText: "Flush square accordion summary" }).first();
  if ((await flushAccordion.count()) === 0) throw new Error("missing flush square Accordion target");
  for (const className of ["MuiPaper-rounded", "MuiAccordion-rounded", "MuiAccordion-gutters"]) {
    if (await flushAccordion.evaluate((node, expectedClass) => node.classList.contains(expectedClass), className)) {
      throw new Error(`flush square Accordion still had ${className}`);
    }
  }

  const flushAccordionSummary = page.locator(".MuiAccordionSummary-root[data-disabled='0'][data-disable-gutters='1'][data-expanded='0']", { hasText: "Flush square accordion summary" }).first();
  if ((await flushAccordionSummary.count()) === 0) throw new Error("missing flush AccordionSummary target");
  if (await flushAccordionSummary.evaluate((node) => node.classList.contains("MuiAccordionSummary-gutters"))) {
    throw new Error("disableGutters AccordionSummary still had MuiAccordionSummary-gutters");
  }
  if ((await flushAccordion.locator(".MuiAccordionSummary-content.MuiAccordionSummary-contentGutters").count()) !== 0) {
    throw new Error("AccordionSummary content emitted removed MuiAccordionSummary-contentGutters utility class");
  }

  const defaultAccordionActions = page.locator(".MuiAccordionActions-root.MuiAccordionActions-spacing[data-disable-spacing='0']", { hasText: "Close" }).first();
  if ((await defaultAccordionActions.count()) === 0) throw new Error("missing default AccordionActions DOM data contract");
  const tightAccordionActions = page.locator(".MuiAccordionActions-root[data-disable-spacing='1']", { hasText: "Tight accordion action" }).first();
  if ((await tightAccordionActions.count()) === 0) throw new Error("missing disableSpacing AccordionActions DOM data contract");

  const tableStateCases = [
    [".MuiTable-root.MuiTable-stickyHeader[data-sticky-header='1']", "Name"],
    [".MuiTableRow-root.MuiTableRow-hover.Mui-selected[data-hover='1'][data-selected='1']", "Name"],
    [".MuiTableRow-root[data-hover='0'][data-selected='0']", "Value"],
    [".MuiTableCell-root.MuiTableCell-stickyHeader[data-size='medium'][data-sticky-header='1']", "Name"],
    [".MuiTableCell-root.MuiTableCell-sizeSmall[data-size='small'][data-sticky-header='0']", "Value"],
    [".MuiTableSortLabel-root.Mui-active[data-active='1'][data-direction='asc'][data-hide-sort-icon='0']", "Name"],
    [".MuiTableSortLabel-root.MuiTableSortLabel-directionDesc[data-active='0'][data-direction='desc'][data-hide-sort-icon='0']", "Descending"],
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

  const classedPagination = page.locator(".MuiTablePagination-root.library-pagination-controls.library-pagination-root.library-pagination-root-slot", { hasText: "Classed pagination" }).first();
  if ((await classedPagination.count()) === 0) throw new Error("missing classed TablePagination root target");
  if ((await classedPagination.locator(".MuiTablePagination-toolbar.library-pagination-toolbar.library-pagination-toolbar-slot").count()) === 0) throw new Error("TablePagination did not merge toolbar slot classes");
  if ((await classedPagination.locator(".MuiTablePagination-spacer.library-pagination-spacer.library-pagination-spacer-slot").count()) === 0) throw new Error("TablePagination did not merge spacer slot classes");
  if ((await classedPagination.locator(".MuiTablePagination-selectLabel.library-pagination-select-label.library-pagination-select-label-slot", { hasText: "Rows per page:" }).count()) === 0) throw new Error("TablePagination did not merge selectLabel slot classes");
  if ((await classedPagination.locator(".MuiTablePagination-input.MuiTablePagination-selectRoot.library-pagination-input.library-pagination-select-root.library-pagination-input-slot.library-pagination-select-root-slot").count()) === 0) throw new Error("TablePagination did not merge input/selectRoot slot classes");
  if ((await classedPagination.locator(".MuiTablePagination-select.library-pagination-select.library-pagination-select-slot").count()) === 0) throw new Error("TablePagination did not merge select slot classes");
  if ((await classedPagination.locator(".MuiTablePagination-selectIcon.library-pagination-select-icon.library-pagination-select-icon-slot").count()) === 0) throw new Error("TablePagination did not merge selectIcon slot classes");
  if ((await classedPagination.locator(".MuiTablePagination-displayedRows.library-pagination-displayed-rows.library-pagination-displayed-rows-slot", { hasText: "0-0 of 0" }).count()) === 0) throw new Error("TablePagination did not merge displayedRows slot classes");
  if ((await classedPagination.locator(".MuiTablePagination-actions.library-pagination-actions.library-pagination-actions-slot").count()) === 0) throw new Error("TablePagination did not merge actions slot classes");

  const classedPaginationActions = page.locator(".MuiTablePaginationActions-root.library-pagination-actions-root.library-pagination-actions-root-class.library-pagination-actions-root-slot", { hasText: "Classed pagination actions" }).first();
  if ((await classedPaginationActions.count()) === 0) throw new Error("missing classed TablePaginationActions root target");
  if ((await classedPaginationActions.locator(".MuiIconButton-root.library-pagination-first-button.library-pagination-first-button-slot").count()) === 0) throw new Error("TablePaginationActions did not merge first button classes");
  if ((await classedPaginationActions.locator(".MuiSvgIcon-root.library-pagination-first-button-icon.library-pagination-first-button-icon-slot").count()) === 0) throw new Error("TablePaginationActions did not merge first button icon classes");
  if ((await classedPaginationActions.locator(".MuiIconButton-root.library-pagination-previous-button.library-pagination-previous-button-slot").count()) === 0) throw new Error("TablePaginationActions did not merge previous button classes");
  if ((await classedPaginationActions.locator(".MuiSvgIcon-root.library-pagination-previous-button-icon.library-pagination-previous-button-icon-slot").count()) === 0) throw new Error("TablePaginationActions did not merge previous button icon classes");
  if ((await classedPaginationActions.locator(".MuiIconButton-root.library-pagination-next-button.library-pagination-next-button-slot").count()) === 0) throw new Error("TablePaginationActions did not merge next button classes");
  if ((await classedPaginationActions.locator(".MuiSvgIcon-root.library-pagination-next-button-icon.library-pagination-next-button-icon-slot").count()) === 0) throw new Error("TablePaginationActions did not merge next button icon classes");
  if ((await classedPaginationActions.locator(".MuiIconButton-root.library-pagination-last-button.library-pagination-last-button-slot").count()) === 0) throw new Error("TablePaginationActions did not merge last button classes");
  if ((await classedPaginationActions.locator(".MuiSvgIcon-root.library-pagination-last-button-icon.library-pagination-last-button-icon-slot").count()) === 0) throw new Error("TablePaginationActions did not merge last button icon classes");
  const visibleClassedPaginationActionButtons = await classedPaginationActions
    .locator(".MuiIconButton-root")
    .evaluateAll((nodes) => nodes.filter((node) => !node.hidden).map((node) => node.getAttribute("aria-label")));
  if (!visibleClassedPaginationActionButtons.includes("Go to first page")) throw new Error("TablePaginationActions did not show the first page button when showFirstButton is set");
  if (!visibleClassedPaginationActionButtons.includes("Go to last page")) throw new Error("TablePaginationActions did not show the last page button when showLastButton is set");

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

  const defaultImageList = page.locator(".MuiImageList-root.MuiImageList-standard[data-cols='3'][data-gap='8'][data-row-height='240']", { hasText: "Image title" }).first();
  if ((await defaultImageList.count()) === 0) throw new Error("missing default ImageList variant utility class");
  if ((await defaultImageList.locator(".MuiImageListItem-root.MuiImageListItem-standard[data-cols='2'][data-rows='3']", { hasText: "Image title" }).count()) === 0) {
    throw new Error("missing default ImageListItem variant utility class");
  }
  if ((await defaultImageList.locator(".MuiImageListItemBar-root.MuiImageListItemBar-positionBottom.MuiImageListItemBar-actionPositionRight", { hasText: "Image title" }).count()) === 0) {
    throw new Error("missing default ImageListItemBar ownerState utility classes");
  }
  if ((await defaultImageList.locator(".MuiImageListItemBar-subtitle", { hasText: "Image subtitle" }).count()) === 0) {
    throw new Error("ImageListItemBar did not render subtitle text");
  }
  if ((await defaultImageList.locator(".MuiImageListItemBar-actionIcon", { hasText: "More" }).count()) === 0) {
    throw new Error("ImageListItemBar did not render actionIcon text");
  }

  const wovenImageItem = page.locator(".MuiImageListItem-root.MuiImageListItem-woven[data-cols='1'][data-rows='2']", { hasText: "Woven image title" }).first();
  if ((await wovenImageItem.count()) === 0) throw new Error("missing woven ImageListItem variant utility class");
  if ((await wovenImageItem.locator(".MuiImageListItemBar-root.MuiImageListItemBar-positionTop.MuiImageListItemBar-actionPositionLeft", { hasText: "Woven image title" }).count()) === 0) {
    throw new Error("missing top/left ImageListItemBar ownerState utility classes");
  }
  const defaultImageItemBar = defaultImageList.locator(".MuiImageListItemBar-root.MuiImageListItemBar-positionBottom.MuiImageListItemBar-actionPositionRight", { hasText: "Image title" }).first();
  if ((await defaultImageItemBar.getAttribute("data-position")) !== "bottom") throw new Error("default ImageListItemBar did not preserve data-position=bottom");
  if ((await defaultImageItemBar.getAttribute("data-action-position")) !== "right") throw new Error("default ImageListItemBar did not preserve data-action-position=right");
  if ((await defaultImageItemBar.getAttribute("data-title")) !== "Image title") throw new Error("default ImageListItemBar did not preserve data-title");
  if ((await defaultImageItemBar.getAttribute("data-subtitle")) !== "Image subtitle") throw new Error("default ImageListItemBar did not preserve data-subtitle");
  if ((await defaultImageItemBar.getAttribute("data-action-icon")) !== "More") throw new Error("default ImageListItemBar did not preserve data-action-icon");
  if ((await wovenImageItem.locator(".MuiImageListItemBar-subtitle", { hasText: "Woven image subtitle" }).count()) === 0) {
    throw new Error("woven ImageListItemBar did not render subtitle text");
  }
  if ((await wovenImageItem.locator(".MuiImageListItemBar-actionIcon", { hasText: "Share" }).count()) === 0) {
    throw new Error("woven ImageListItemBar did not render actionIcon text");
  }
  const wovenImageItemBar = wovenImageItem.locator(".MuiImageListItemBar-root.MuiImageListItemBar-positionTop.MuiImageListItemBar-actionPositionLeft", { hasText: "Woven image title" }).first();
  if ((await wovenImageItemBar.getAttribute("data-position")) !== "top") throw new Error("woven ImageListItemBar did not preserve data-position=top");
  if ((await wovenImageItemBar.getAttribute("data-action-position")) !== "left") throw new Error("woven ImageListItemBar did not preserve data-action-position=left");
  if ((await wovenImageItemBar.getAttribute("data-title")) !== "Woven image title") throw new Error("woven ImageListItemBar did not preserve data-title");
  if ((await wovenImageItemBar.getAttribute("data-subtitle")) !== "Woven image subtitle") throw new Error("woven ImageListItemBar did not preserve data-subtitle");
  if ((await wovenImageItemBar.getAttribute("data-action-icon")) !== "Share") throw new Error("woven ImageListItemBar did not preserve data-action-icon");

  const cardHeader = page.locator(".MuiCardHeader-root", { hasText: "Card header title" }).first();
  if ((await cardHeader.getAttribute("data-disable-typography")) !== "0") throw new Error("CardHeader did not preserve default data-disable-typography=0");
  if ((await cardHeader.getAttribute("data-title")) !== "Card header title") throw new Error("CardHeader did not preserve data-title");
  if ((await cardHeader.getAttribute("data-subheader")) !== "Card header subheader") throw new Error("CardHeader did not preserve data-subheader");
  if ((await cardHeader.locator(".MuiCardHeader-title.MuiTypography-root.MuiTypography-h5", { hasText: "Card header title" }).count()) === 0) {
    throw new Error("CardHeader title did not render through Typography title slot");
  }
  if ((await cardHeader.locator(".MuiCardHeader-title", { hasText: "Card header slot" }).count()) === 0) {
    throw new Error("CardHeader did not preserve projected child content in title slot");
  }
  if ((await cardHeader.locator(".MuiCardHeader-subheader.MuiTypography-root.MuiTypography-body1", { hasText: "Card header subheader" }).count()) === 0) {
    throw new Error("CardHeader subheader did not render through Typography subheader slot");
  }
  const plainCardHeader = page.locator(".MuiCardHeader-root", { hasText: "Plain card title" }).first();
  if ((await plainCardHeader.count()) === 0) throw new Error("missing disableTypography CardHeader target");
  if ((await plainCardHeader.getAttribute("data-disable-typography")) !== "1") throw new Error("disableTypography CardHeader did not preserve data-disable-typography=1");
  if ((await plainCardHeader.getAttribute("data-title")) !== "Plain card title") throw new Error("disableTypography CardHeader did not preserve data-title");
  if ((await plainCardHeader.getAttribute("data-subheader")) !== "Plain card subheader") throw new Error("disableTypography CardHeader did not preserve data-subheader");
  if ((await plainCardHeader.locator(".MuiCardHeader-title.MuiTypography-root").count()) !== 0) {
    throw new Error("disableTypography CardHeader title still emitted Typography class");
  }
  if ((await plainCardHeader.locator(".MuiCardHeader-subheader.MuiTypography-root").count()) !== 0) {
    throw new Error("disableTypography CardHeader subheader still emitted Typography class");
  }

  const imageMedia = page.locator(".MuiCardMedia-root.MuiCardMedia-img", { hasText: "Image media" }).first();
  if ((await imageMedia.count()) === 0) throw new Error("missing CardMedia image ownerState class");
  if ((await imageMedia.getAttribute("data-has-image")) !== "1") throw new Error("CardMedia image target did not preserve data-has-image=1");
  if ((await imageMedia.getAttribute("data-has-src")) !== "0") throw new Error("CardMedia image target did not preserve data-has-src=0");
  if ((await imageMedia.getAttribute("data-image")) !== "assets/mui_demo_cover.webp") {
    throw new Error("CardMedia did not preserve image prop as data-image");
  }
  if ((await imageMedia.getAttribute("data-component")) !== "div") {
    throw new Error("CardMedia default component data attribute was not div");
  }
  const imgMedia = page.locator(".MuiCardMedia-root.MuiCardMedia-media.MuiCardMedia-img", { hasText: "Img media" }).first();
  if ((await imgMedia.count()) === 0) throw new Error("missing CardMedia component=img media/img classes");
  if ((await imgMedia.getAttribute("data-component")) !== "img") throw new Error("CardMedia did not preserve component=img");
  if ((await imgMedia.getAttribute("data-has-image")) !== "0") throw new Error("CardMedia img target did not preserve data-has-image=0");
  if ((await imgMedia.getAttribute("data-has-src")) !== "1") throw new Error("CardMedia img target did not preserve data-has-src=1");
  if ((await imgMedia.getAttribute("data-src")) !== "assets/mui_demo_inline.webp") throw new Error("CardMedia did not preserve src prop as data-src");

  const spacedCardActions = page.locator(".MuiCardActions-root.MuiCardActions-spacing[data-disable-spacing='0']", { hasText: "Open" }).first();
  if ((await spacedCardActions.count()) === 0) throw new Error("missing spaced CardActions DOM data contract");
  const tightCardActions = page.locator(".MuiCardActions-root[data-disable-spacing='1']", { hasText: "Tight card action" }).first();
  if ((await tightCardActions.count()) === 0) throw new Error("missing tight CardActions DOM data contract");

  const listStateCases = [
    [".MuiList-root.MuiList-dense", "Compact recent"],
    [".MuiListItem-root.MuiListItem-dense.MuiListItem-divider", "Dense divided item"],
    [".MuiListItemButton-root.MuiListItemButton-dense.MuiListItemButton-divider.Mui-selected", "Dense selected action"],
    [".MuiListItemText-root.MuiListItemText-inset.MuiListItemText-dense", "Dense divided item"],
    [".MuiListItemText-root.MuiListItemText-multiline", "Multiline list text"],
    [".MuiListItemSecondaryAction-root.MuiListItemSecondaryAction-disableGutters", "Compact more"],
    [".MuiListSubheader-root.MuiListSubheader-inset[data-color='default'][data-disable-gutters='1'][data-disable-sticky='1'][data-inset='1']", "Compact recent"],
    [".MuiListSubheader-root.MuiListSubheader-colorPrimary[data-color='primary'][data-disable-gutters='0'][data-disable-sticky='0'][data-inset='0']", "Primary recent"],
    [".MuiListSubheader-root.MuiListSubheader-colorInherit[data-color='inherit'][data-disable-gutters='0'][data-disable-sticky='0'][data-inset='0']", "Inherited recent"],
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

  const multilineListText = page.locator(".MuiListItemText-root.MuiListItemText-multiline", { hasText: "Multiline list text" }).first();
  if ((await multilineListText.locator(".MuiListItemText-primary.MuiTypography-root.MuiTypography-body1", { hasText: "Main inbox" }).count()) === 0) {
    throw new Error("ListItemText primary did not render through Typography primary slot");
  }
  if ((await multilineListText.locator(".MuiListItemText-secondary.MuiTypography-root.MuiTypography-body2", { hasText: "Two unread messages" }).count()) === 0) {
    throw new Error("ListItemText secondary did not render through Typography secondary slot");
  }
  const plainListText = page.locator(".MuiListItemText-root", { hasText: "Plain primary" }).first();
  if ((await plainListText.count()) === 0) throw new Error("missing disableTypography ListItemText target");
  if ((await plainListText.locator(".MuiListItemText-primary.MuiTypography-root").count()) !== 0) {
    throw new Error("disableTypography ListItemText primary still emitted Typography class");
  }
  if ((await plainListText.locator(".MuiListItemText-secondary.MuiTypography-root").count()) !== 0) {
    throw new Error("disableTypography ListItemText secondary still emitted Typography class");
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

  const defaultSlide = page.locator(".MuiSlide-root[data-appear='1'][data-direction='down'][data-disable-prefers-reduced-motion='0'][data-in='1']", { hasText: "Slide content" }).first();
  if ((await defaultSlide.count()) === 0) throw new Error("missing default Slide DOM data contract");
  const closedLeftSlide = page.locator(".MuiSlide-root[data-appear='0'][data-direction='left'][data-disable-prefers-reduced-motion='1'][data-in='0']", { hasText: "Closed left slide content" }).first();
  if ((await closedLeftSlide.count()) === 0) throw new Error("missing configured Slide DOM data contract");
  const defaultFade = page.locator(".MuiFade-root[data-appear='1'][data-disable-prefers-reduced-motion='0'][data-in='1']", { hasText: "Fade content" }).first();
  if ((await defaultFade.count()) === 0) throw new Error("missing default Fade DOM data contract");
  const closedFade = page.locator(".MuiFade-root[data-appear='0'][data-disable-prefers-reduced-motion='0'][data-in='0']", { hasText: "Closed fade content" }).first();
  if ((await closedFade.count()) === 0) throw new Error("missing configured Fade DOM data contract");
  const defaultGrow = page.locator(".MuiGrow-root[data-appear='1'][data-disable-prefers-reduced-motion='0'][data-in='1'][data-timeout='auto']", { hasText: "Grow content" }).first();
  if ((await defaultGrow.count()) === 0) throw new Error("missing default Grow DOM data contract");
  const timedGrow = page.locator(".MuiGrow-root[data-appear='1'][data-disable-prefers-reduced-motion='0'][data-in='1'][data-timeout='250']", { hasText: "Timed grow content" }).first();
  if ((await timedGrow.count()) === 0) throw new Error("missing timed Grow DOM data contract");
  const defaultZoom = page.locator(".MuiZoom-root[data-appear='1'][data-disable-prefers-reduced-motion='0'][data-in='1']", { hasText: "Zoom content" }).first();
  if ((await defaultZoom.count()) === 0) throw new Error("missing default Zoom DOM data contract");
  const closedZoom = page.locator(".MuiZoom-root[data-appear='1'][data-disable-prefers-reduced-motion='1'][data-in='0']", { hasText: "Closed zoom content" }).first();
  if ((await closedZoom.count()) === 0) throw new Error("missing configured Zoom DOM data contract");

  const statusStateCases = [
    [".MuiBackdrop-root.MuiBackdrop-invisible", "Invisible backdrop"],
    [".MuiRating-root.MuiRating-sizeSmall", "Small rating"],
    [".MuiRating-root.MuiRating-sizeLarge", "Large rating"],
    [".MuiRating-root.Mui-disabled", "Disabled rating"],
    [".MuiRating-root.MuiRating-readOnly", "Read only rating"],
    [".MuiSlider-root.MuiSlider-colorSecondary", "Secondary slider"],
    [".MuiSlider-root.MuiSlider-sizeSmall", "Small slider"],
    [".MuiSlider-root.Mui-disabled", "Disabled slider"],
    [".MuiCollapse-root.MuiCollapse-vertical.MuiCollapse-entered", "Collapsed content"],
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
    [".MuiSkeleton-root.MuiSkeleton-rectangular[data-variant='rectangular'][data-animation='pulse'][data-width='160'][data-height='48']", "Rectangular skeleton"],
    [".MuiSkeleton-root.MuiSkeleton-wave[data-variant='text'][data-animation='wave'][data-width='140'][data-height='24']", "Wave skeleton"],
    [".MuiSnackbar-root.MuiSnackbar-anchorOriginBottomLeft[data-open='1'][data-anchor-origin-vertical='bottom'][data-anchor-origin-horizontal='left']", "Snackbar message"],
    [".MuiSnackbar-root.MuiSnackbar-anchorOriginTopRight[data-open='1'][data-anchor-origin-vertical='top'][data-anchor-origin-horizontal='right']", "Top right snackbar"],
    [".MuiSnackbar-root.MuiSnackbar-anchorOriginBottomCenter[data-open='1'][data-anchor-origin-vertical='bottom'][data-anchor-origin-horizontal='center']", "Bottom center snackbar"],
  ];

  for (const [selector, label] of statusStateCases) {
    const locator = label ? page.locator(selector, { hasText: label }) : page.locator(selector);
    if ((await locator.count()) === 0) throw new Error(`missing status ownerState utility class ${selector}${label ? ` for '${label}'` : ""}`);
  }

  const snackbar = page.locator(".MuiSnackbar-root.MuiSnackbar-anchorOriginBottomLeft", { hasText: "Snackbar message" }).first();
  if ((await snackbar.locator(".MuiSnackbarContent-message", { hasText: "Snackbar prop message" }).count()) === 0) {
    throw new Error("Snackbar did not forward message prop to SnackbarContent");
  }
  if ((await snackbar.locator(".MuiSnackbarContent-action", { hasText: "Undo" }).count()) === 0) {
    throw new Error("Snackbar did not forward action prop to SnackbarContent");
  }
  const snackbarContent = page.locator(".MuiSnackbarContent-root[role='status']", { hasText: "Snackbar content" }).first();
  if ((await snackbarContent.count()) === 0) throw new Error("missing role-forwarding SnackbarContent target");
  if ((await snackbarContent.getAttribute("data-message")) !== "Snackbar content message") {
    throw new Error("SnackbarContent did not preserve data-message");
  }
  if ((await snackbarContent.getAttribute("data-action")) !== "Dismiss") {
    throw new Error("SnackbarContent did not preserve data-action");
  }
  if ((await snackbarContent.locator(".MuiSnackbarContent-message", { hasText: "Snackbar content message" }).count()) === 0) {
    throw new Error("SnackbarContent did not render message prop");
  }
  if ((await snackbarContent.locator(".MuiSnackbarContent-action", { hasText: "Dismiss" }).count()) === 0) {
    throw new Error("SnackbarContent did not render action prop");
  }

  if ((await page.locator(".MuiLinearProgress-barColorPrimary").count()) !== 0) {
    throw new Error("stale LinearProgress barColorPrimary utility class should not be emitted");
  }

  const determinateCircularProgress = page.locator(".MuiCircularProgress-root.MuiCircularProgress-determinate.MuiCircularProgress-colorInherit[role='progressbar'][data-variant='determinate'][data-value='0'][data-size='40'][data-thickness='4']").first();
  if ((await determinateCircularProgress.count()) === 0) throw new Error("missing determinate CircularProgress DOM data contract");
  if ((await determinateCircularProgress.getAttribute("aria-valuemin")) !== "0") throw new Error("determinate CircularProgress did not set aria-valuemin=0");
  if ((await determinateCircularProgress.getAttribute("aria-valuemax")) !== "100") throw new Error("determinate CircularProgress did not set aria-valuemax=100");
  if ((await determinateCircularProgress.getAttribute("aria-valuenow")) !== "0") throw new Error("determinate CircularProgress did not preserve aria-valuenow from value state");

  const determinateLinearProgress = page.locator(".MuiLinearProgress-root.MuiLinearProgress-determinate[role='progressbar'][data-variant='determinate'][data-value='0']").first();
  if ((await determinateLinearProgress.count()) === 0) throw new Error("missing determinate LinearProgress DOM data contract");
  if ((await determinateLinearProgress.getAttribute("aria-valuemin")) !== "0") throw new Error("determinate LinearProgress did not set aria-valuemin=0");
  if ((await determinateLinearProgress.getAttribute("aria-valuemax")) !== "100") throw new Error("determinate LinearProgress did not set aria-valuemax=100");
  if ((await determinateLinearProgress.getAttribute("aria-valuenow")) !== "0") throw new Error("determinate LinearProgress did not preserve aria-valuenow from value state");

  const bufferLinearProgress = page.locator(".MuiLinearProgress-root.MuiLinearProgress-buffer[role='progressbar'][data-variant='buffer'][data-value='0'][data-value-buffer='0']").first();
  if ((await bufferLinearProgress.count()) === 0) throw new Error("missing buffer LinearProgress DOM data contract");

  const disabledRating = page.locator(".MuiRating-root.Mui-disabled", { hasText: "Disabled rating" });
  if (!(await disabledRating.first().locator("input[type='radio']").first().evaluate((node) => node instanceof HTMLInputElement && node.disabled))) {
    throw new Error("disabled Rating did not set the native disabled property");
  }

  const defaultSlider = page.locator(".MuiSlider-root.MuiSlider-colorPrimary.MuiSlider-sizeMedium[data-color='primary'][data-disable-swap='0'][data-disabled='0'][data-max='100'][data-min='0'][data-name=''][data-orientation='horizontal'][data-shift-step='10'][data-size='medium'][data-step='1'][data-track='normal'][data-value='40'][data-value-label-display='off']", { hasText: "40" }).first();
  if ((await defaultSlider.count()) === 0) throw new Error("missing default Slider DOM data contract");
  const secondarySlider = page.locator(".MuiSlider-root.MuiSlider-colorSecondary[data-color='secondary'][data-disabled='0'][data-size='medium'][data-value='0']", { hasText: "Secondary slider" }).first();
  if ((await secondarySlider.count()) === 0) throw new Error("missing secondary Slider DOM data contract");
  const smallSlider = page.locator(".MuiSlider-root.MuiSlider-sizeSmall[data-color='primary'][data-disabled='0'][data-size='small'][data-value='0']", { hasText: "Small slider" }).first();
  if ((await smallSlider.count()) === 0) throw new Error("missing small Slider DOM data contract");
  const configuredSlider = page.locator(".MuiSlider-root[data-color='primary'][data-disable-swap='1'][data-disabled='0'][data-max='90'][data-min='10'][data-name='volume'][data-orientation='horizontal'][data-shift-step='10'][data-size='medium'][data-step='5'][data-track='inverted'][data-value='55'][data-value-label-display='on']", { hasText: "Configured slider" }).first();
  if ((await configuredSlider.count()) === 0) throw new Error("missing configured Slider DOM data contract");
  const configuredSliderInput = configuredSlider.locator("input.MuiSlider-input").first();
  if (!(await configuredSliderInput.evaluate((node) => node instanceof HTMLInputElement && node.min === "10" && node.max === "90" && node.step === "5" && node.value === "55" && node.name === "volume"))) {
    throw new Error("configured Slider did not forward native input min/max/step/value/name");
  }
  const disabledSlider = page.locator(".MuiSlider-root.Mui-disabled", { hasText: "Disabled slider" });
  if ((await disabledSlider.first().getAttribute("data-disabled")) !== "1") throw new Error("disabled Slider did not preserve data-disabled=1");
  if ((await disabledSlider.first().getAttribute("data-value")) !== "0") throw new Error("disabled Slider did not preserve default data-value=0");
  if ((await disabledSlider.first().locator(".MuiSlider-thumb.Mui-disabled").count()) === 0) {
    throw new Error("disabled Slider did not set the thumb disabled utility class");
  }
  if (!(await disabledSlider.first().locator("input[type='range']").first().evaluate((node) => node instanceof HTMLInputElement && node.disabled && node.min === "0" && node.max === "100" && node.step === "1" && node.value === "0"))) {
    throw new Error("disabled Slider did not set the native disabled property");
  }

  const outlinedChip = page.locator(".MuiChip-root.MuiChip-outlined[data-clickable='0'][data-color='default'][data-disabled='0'][data-size='medium'][data-variant='outlined']", { hasText: "Outlined chip" }).first();
  if ((await outlinedChip.count()) === 0) throw new Error("missing outlined Chip DOM data contract");
  const secondaryChip = page.locator(".MuiChip-root.MuiChip-colorSecondary[data-clickable='0'][data-color='secondary'][data-disabled='0'][data-size='medium'][data-variant='filled']", { hasText: "Secondary chip" }).first();
  if ((await secondaryChip.count()) === 0) throw new Error("missing secondary Chip DOM data contract");
  const disabledClickableChip = page.locator(".MuiChip-root.Mui-disabled.MuiChip-clickable[data-clickable='1'][data-color='default'][data-disabled='1'][data-size='medium'][data-variant='filled']", { hasText: "Disabled clickable chip" }).first();
  if ((await disabledClickableChip.count()) === 0) throw new Error("missing disabled clickable Chip DOM data contract");
  const smallChip = page.locator(".MuiChip-root.MuiChip-sizeSmall[data-clickable='0'][data-color='default'][data-disabled='0'][data-size='small'][data-variant='filled']", { hasText: "Small chip" }).first();
  if ((await smallChip.count()) === 0) throw new Error("missing small Chip DOM data contract");

  const openCollapse = page.locator(".MuiCollapse-root.MuiCollapse-vertical.MuiCollapse-entered", { hasText: "Collapsed content" }).first();
  if ((await openCollapse.getAttribute("aria-hidden")) !== "false") throw new Error("open Collapse did not set aria-hidden=false in all-components demo");
  if ((await openCollapse.getAttribute("data-state")) !== "entered") throw new Error("open Collapse did not set entered data state in all-components demo");

  const navigationStateCases = [
    [".MuiButtonGroup-root.MuiButtonGroup-fullWidth.MuiButtonGroup-disableElevation[data-color='primary'][data-disabled='0'][data-disable-elevation='1'][data-full-width='1'][data-orientation='horizontal'][data-size='medium'][data-variant='outlined']", "Full width grouped"],
    [".MuiButtonGroup-root.MuiButtonGroup-horizontal[data-color='primary'][data-disabled='0'][data-disable-elevation='0'][data-full-width='0'][data-orientation='horizontal'][data-size='medium'][data-variant='outlined']", "Grouped"],
    [".MuiButtonGroup-root.MuiButtonGroup-contained.MuiButtonGroup-colorInherit[data-disabled='0'][data-disable-elevation='0'][data-full-width='0'][data-orientation='horizontal'][data-size='medium'][data-variant='contained']", "Contained inherit grouped"],
    [".MuiButtonGroup-root .MuiButton-root.MuiButton-contained.MuiButton-colorInherit", "Contained inherit grouped"],
    [".MuiButtonGroup-root.MuiButtonGroup-colorSecondary[data-color='secondary'][data-disabled='0'][data-disable-elevation='0'][data-full-width='0'][data-orientation='horizontal'][data-size='medium'][data-variant='outlined']", "Secondary grouped"],
    [".MuiButtonGroup-root .MuiButton-root.MuiButton-colorSecondary", "Secondary grouped"],
    [".MuiButtonGroup-root.MuiButtonGroup-vertical[data-color='primary'][data-disabled='0'][data-disable-elevation='0'][data-full-width='0'][data-orientation='vertical'][data-size='medium'][data-variant='outlined']", "Vertical grouped"],
    [".MuiTabs-list.MuiTabs-centered", "Wide wrapped tab"],
    [".MuiTab-root.MuiTab-fullWidth.MuiTab-wrapped[data-disabled='0'][data-full-width='1'][data-selected='0'][data-text-color='inherit'][data-value='0'][data-wrapped='1']", "Wide wrapped tab"],
    [".MuiTab-root.MuiTab-textColorPrimary[data-disabled='0'][data-full-width='0'][data-selected='0'][data-text-color='primary'][data-value='0'][data-wrapped='0']", "Primary tab"],
    [".MuiTab-root.MuiTab-textColorSecondary[data-disabled='0'][data-full-width='0'][data-selected='0'][data-text-color='secondary'][data-value='0'][data-wrapped='0']", "Secondary tab"],
    [".MuiToggleButtonGroup-root.MuiToggleButtonGroup-fullWidth[data-color='standard'][data-disabled='0'][data-exclusive='0'][data-full-width='1'][data-orientation='horizontal'][data-size='medium'][data-value='']", "Full width toggle"],
    [".MuiToggleButtonGroup-root.MuiToggleButtonGroup-horizontal[data-color='standard'][data-disabled='0'][data-exclusive='0'][data-full-width='0'][data-orientation='horizontal'][data-size='medium'][data-value='']", "Bold"],
    [".MuiToggleButtonGroup-root.MuiToggleButtonGroup-vertical[data-color='standard'][data-disabled='0'][data-exclusive='0'][data-full-width='0'][data-orientation='vertical'][data-size='medium'][data-value='']", "Vertical toggle"],
    [".MuiToggleButtonGroup-root.MuiToggleButtonGroup-horizontal[data-color='secondary'][data-disabled='1'][data-exclusive='0'][data-full-width='0'][data-orientation='horizontal'][data-size='small'][data-value='']", "Inherited disabled toggle"],
    [".MuiBottomNavigationAction-root.Mui-selected[data-disabled='0'][data-label=''][data-selected='1'][data-show-label='0'][data-show-labels='0'][data-value='0']", "Settings"],
    [".MuiBottomNavigationAction-label.Mui-selected", "Settings"],
    [".MuiBottomNavigation-root.library-bottom-navigation.library-bottom-navigation-root.library-bottom-navigation-root-slot[data-show-labels='1'][data-value='0']", "Library parent label"],
    [".MuiBottomNavigationAction-label.library-bottom-navigation-label.library-bottom-navigation-label-slot", "Library parent label"],
    [".MuiBottomNavigationAction-root.Mui-selected[data-disabled='0'][data-label='Library selected label'][data-selected='1'][data-show-label='0'][data-show-labels='1'][data-value='0']", "Library selected label"],
    [".MuiTabScrollButton-root.Mui-disabled[data-disabled='1'][data-orientation='horizontal']", "Disabled tab scroll"],
    [".MuiTabScrollButton-root.MuiTabScrollButton-horizontal[data-disabled='1'][data-orientation='horizontal']", "Disabled tab scroll"],
    [".MuiTabScrollButton-root.MuiTabScrollButton-vertical[data-disabled='0'][data-orientation='vertical']", "Vertical tab scroll"],
    [".MuiPagination-root.MuiPagination-text[data-disabled='0'][data-shape='circular'][data-size='medium'][data-variant='text']", "Disabled page"],
    [".MuiPagination-root.library-pagination.library-pagination-root-slot[aria-label='Library inherited pages'][data-color='secondary'][data-disabled='0'][data-shape='rounded'][data-size='small'][data-variant='outlined']", "Inherited library page"],
    [".MuiPagination-ul.library-pagination-ul.library-pagination-ul-slot", "Inherited library page"],
    [".MuiPaginationItem-root.MuiPaginationItem-outlined.MuiPaginationItem-rounded.MuiPaginationItem-sizeSmall.MuiPaginationItem-colorSecondary[data-color='secondary'][data-disabled='0'][data-hidden='0'][data-selected='0'][data-shape='rounded'][data-size='small'][data-type='page'][data-variant='outlined']", "Inherited library page"],
    [".MuiPaginationItem-root.library-pagination-item", "Classed library page"],
    [".MuiPaginationItem-icon.library-pagination-icon.library-pagination-icon-slot", null],
    [".MuiPagination-root.MuiPagination-outlined[data-disabled='0'][data-shape='circular'][data-size='medium'][data-variant='outlined']", "Outlined page"],
    [".MuiPaginationItem-root.MuiPaginationItem-text.MuiPaginationItem-circular[data-disabled='1'][data-hidden='0'][data-selected='0'][data-shape='circular'][data-size='medium'][data-type='page'][data-variant='text']", "Disabled page"],
    [".MuiPaginationItem-root.MuiPaginationItem-page[data-type='page']", "Disabled page"],
    [".MuiPaginationItem-root.MuiPaginationItem-outlined.MuiPaginationItem-circular[data-disabled='0'][data-hidden='0'][data-selected='0'][data-shape='circular'][data-size='medium'][data-type='page'][data-variant='outlined']", "Outlined item page"],
    [".MuiPaginationItem-root.MuiPaginationItem-sizeSmall[data-size='small']", "Small page"],
    [".MuiPaginationItem-root.MuiPaginationItem-sizeLarge[data-size='large']", "Large page"],
    [".MuiPaginationItem-root.MuiPaginationItem-rounded[data-shape='rounded']", "Rounded page"],
    [".MuiPaginationItem-root.MuiPaginationItem-previousNext[data-type='previous']", "Previous item"],
    [".MuiPaginationItem-root.MuiPaginationItem-previousNext[data-type='next']", "Next item"],
    [".MuiPaginationItem-root.MuiPaginationItem-ellipsis[data-type='start-ellipsis']", "Start ellipsis"],
    [".MuiPaginationItem-root.MuiPaginationItem-firstLast[data-type='last']", "Last item"],
    [".MuiSpeedDial-root.MuiSpeedDial-directionLeft[data-aria-label='speed dial'][data-direction='left'][data-hidden='0'][data-open='0'][data-transition-duration='225']", "Left speed action"],
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

  const defaultSpeedDial = page.locator(".MuiSpeedDial-root.MuiSpeedDial-directionUp[data-aria-label='speed dial'][data-direction='up'][data-hidden='0'][data-open='1'][data-transition-duration='225']", { hasText: "Edit" }).first();
  if ((await defaultSpeedDial.count()) === 0) throw new Error("missing open SpeedDial DOM data contract");

  const openSpeedDialAction = page.locator(".MuiSpeedDialAction-staticTooltip[data-delay='0'][data-id=''][data-open='1'][data-tooltip-placement='left'][data-tooltip-title='']", { hasText: "Edit" }).first();
  if ((await openSpeedDialAction.count()) === 0) throw new Error("missing open SpeedDialAction DOM data contract");

  const closedSpeedDial = page.locator(".MuiSpeedDial-root.MuiSpeedDial-directionUp[data-aria-label='speed dial'][data-direction='up'][data-hidden='0'][data-open='0'][data-transition-duration='225']", { hasText: "Closed speed action" }).first();
  if ((await closedSpeedDial.count()) === 0) throw new Error("missing closed SpeedDial DOM data contract");

  const closedSpeedDialAction = page.locator(".MuiSpeedDialAction-staticTooltip.MuiSpeedDialAction-staticTooltipClosed[data-delay='0'][data-id=''][data-open='0'][data-tooltip-placement='left'][data-tooltip-title='']", { hasText: "Closed speed action" }).first();
  if ((await closedSpeedDialAction.count()) === 0) throw new Error("missing closed SpeedDialAction DOM data contract");

  const openSpeedDialActionFab = page.locator(".MuiSpeedDialAction-fab", { hasText: "Edit" }).first();
  if ((await openSpeedDialActionFab.count()) === 0) throw new Error("missing open SpeedDialAction fab target");
  if (await openSpeedDialActionFab.evaluate((node) => node.classList.contains("MuiSpeedDialAction-fabClosed"))) {
    throw new Error("open SpeedDialAction fab still had MuiSpeedDialAction-fabClosed");
  }

  const defaultBottomNavigation = page.locator(".MuiBottomNavigation-root[data-show-labels='0'][data-value='0']", { hasText: "Visible label" }).first();
  if ((await defaultBottomNavigation.count()) === 0) throw new Error("missing default BottomNavigation DOM data contract");

  const visibleBottomNavigationLabel = page.locator(".MuiBottomNavigationAction-root[data-disabled='0'][data-label=''][data-selected='0'][data-show-label='1'][data-show-labels='0'][data-value='0']", { hasText: "Visible label" }).first();
  if ((await visibleBottomNavigationLabel.count()) === 0) throw new Error("missing BottomNavigationAction showLabel target");
  if (await visibleBottomNavigationLabel.evaluate((node) => node.classList.contains("MuiBottomNavigationAction-iconOnly"))) {
    throw new Error("BottomNavigationAction showLabel still had iconOnly class on root");
  }
  const selectedBottomNavigationLabel = page.locator(".MuiBottomNavigationAction-root.Mui-selected[data-disabled='0'][data-label=''][data-selected='1'][data-show-label='0'][data-show-labels='0'][data-value='0']", { hasText: "Settings" }).first();
  if ((await selectedBottomNavigationLabel.count()) === 0) throw new Error("missing selected BottomNavigationAction target");
  if (await selectedBottomNavigationLabel.evaluate((node) => node.classList.contains("MuiBottomNavigationAction-iconOnly"))) {
    throw new Error("selected BottomNavigationAction still had iconOnly class on root");
  }
  const inheritedBottomNavigationLabel = page.locator(".MuiBottomNavigationAction-root[data-disabled='0'][data-label='Library parent label'][data-selected='0'][data-show-label='0'][data-show-labels='1'][data-value='0']", { hasText: "Library parent label" }).first();
  if ((await inheritedBottomNavigationLabel.count()) === 0) throw new Error("missing BottomNavigation showLabels inherited target");
  if (await inheritedBottomNavigationLabel.evaluate((node) => node.classList.contains("MuiBottomNavigationAction-iconOnly"))) {
    throw new Error("BottomNavigationAction inherited showLabels still had iconOnly class on root");
  }
  if (await inheritedBottomNavigationLabel.locator(".MuiBottomNavigationAction-label").first().evaluate((node) => node.classList.contains("MuiBottomNavigationAction-iconOnly"))) {
    throw new Error("BottomNavigationAction inherited showLabels still had iconOnly class on label");
  }
  const disabledBottomNavigationLabel = page.locator(".MuiBottomNavigationAction-root.Mui-disabled[data-disabled='1'][data-label='Library disabled label'][data-selected='0'][data-show-label='0'][data-show-labels='1'][data-value='0']", { hasText: "Library disabled label" }).first();
  if ((await disabledBottomNavigationLabel.count()) === 0) throw new Error("missing disabled BottomNavigationAction DOM data contract");

  const centeredTabs = page.locator(".MuiTabs-root[data-centered='1'][data-orientation='horizontal'][data-value='0']", { hasText: "Wide wrapped tab" }).first();
  if ((await centeredTabs.count()) === 0) throw new Error("missing centered Tabs DOM data contract");
  const verticalTabScroll = page.locator(".MuiTabScrollButton-root.MuiTabScrollButton-vertical[data-disabled='0'][data-orientation='vertical']", { hasText: "Vertical tab scroll" }).first();
  if ((await verticalTabScroll.count()) === 0) throw new Error("missing vertical TabScrollButton DOM data contract");
  const selectedTab = page.locator(".MuiTab-root.Mui-selected[data-disabled='0'][data-full-width='0'][data-selected='1'][data-value='0'][data-wrapped='0']", { hasText: "Selected tab" }).first();
  if ((await selectedTab.count()) === 0) throw new Error("missing selected Tab DOM data contract");
  if (!((await selectedTab.getAttribute("data-text-color")) || "").startsWith("inherit")) {
    throw new Error("selected Tab did not preserve inherit data-text-color");
  }
  const disabledTab = page.locator(".MuiTab-root.Mui-disabled[data-disabled='1'][data-full-width='0'][data-selected='0'][data-value='0'][data-wrapped='0']", { hasText: "Disabled tab" }).first();
  if ((await disabledTab.count()) === 0) throw new Error("missing disabled Tab DOM data contract");
  if (!((await disabledTab.getAttribute("data-text-color")) || "").startsWith("inherit")) {
    throw new Error("disabled Tab did not preserve inherit data-text-color");
  }
  const defaultToggleGroup = page.locator(".MuiToggleButtonGroup-root.MuiToggleButtonGroup-horizontal[data-color='standard'][data-disabled='0'][data-exclusive='0'][data-full-width='0'][data-orientation='horizontal'][data-size='medium'][data-value='']", { hasText: "Bold" }).first();
  if ((await defaultToggleGroup.count()) === 0) throw new Error("missing default ToggleButtonGroup DOM data contract");
  const inheritedDisabledToggle = page.locator(".MuiToggleButton-root.MuiToggleButton-sizeSmall.MuiToggleButton-secondary.MuiToggleButtonGroup-grouped.Mui-disabled[data-color='secondary'][data-disabled='1'][data-full-width='0'][data-grouped='1'][data-selected='0'][data-size='small'][data-value='']", { hasText: "Inherited disabled toggle" }).first();
  if ((await inheritedDisabledToggle.count()) === 0) throw new Error("missing inherited disabled ToggleButton DOM data contract");
  const fullWidthToggle = page.locator(".MuiToggleButton-root.MuiToggleButton-fullWidth[data-color='standard'][data-disabled='0'][data-full-width='1'][data-grouped='1'][data-selected='0'][data-size='medium'][data-value='']", { hasText: "Full width toggle" }).first();
  if ((await fullWidthToggle.count()) === 0) throw new Error("missing fullWidth ToggleButton DOM data contract");

  const defaultPagination = page.locator(".MuiPagination-root.MuiPagination-text[data-disabled='0'][data-shape='circular'][data-size='medium'][data-variant='text']", { hasText: "Disabled page" }).first();
  if ((await defaultPagination.count()) === 0) throw new Error("missing default Pagination DOM data contract");
  if (!((await defaultPagination.getAttribute("data-color")) || "").startsWith("inherit")) {
    throw new Error("default Pagination did not preserve inherit data-color");
  }

  const outlinedPagination = page.locator(".MuiPagination-root.MuiPagination-outlined[data-disabled='0'][data-shape='circular'][data-size='medium'][data-variant='outlined']", { hasText: "Outlined page" }).first();
  if ((await outlinedPagination.count()) === 0) throw new Error("missing outlined Pagination DOM data contract");
  if (!((await outlinedPagination.getAttribute("data-color")) || "").startsWith("inherit")) {
    throw new Error("outlined Pagination did not preserve inherit data-color");
  }

  const disabledPaginationItem = page.locator(".MuiPaginationItem-root.MuiPaginationItem-text.MuiPaginationItem-circular[data-disabled='1'][data-hidden='0'][data-selected='0'][data-shape='circular'][data-size='medium'][data-type='page'][data-variant='text']", { hasText: "Disabled page" }).first();
  if ((await disabledPaginationItem.count()) === 0) throw new Error("missing disabled PaginationItem DOM data contract");
  if (!((await disabledPaginationItem.getAttribute("data-color")) || "").startsWith("inherit")) {
    throw new Error("disabled PaginationItem did not preserve inherit data-color");
  }

  const outlinedPaginationItem = page.locator(".MuiPaginationItem-root.MuiPaginationItem-outlined.MuiPaginationItem-circular[data-disabled='0'][data-hidden='0'][data-selected='0'][data-shape='circular'][data-size='medium'][data-type='page'][data-variant='outlined']", { hasText: "Outlined item page" }).first();
  if ((await outlinedPaginationItem.count()) === 0) throw new Error("missing outlined PaginationItem DOM data contract");
  if (!((await outlinedPaginationItem.getAttribute("data-color")) || "").startsWith("inherit")) {
    throw new Error("outlined PaginationItem did not preserve inherit data-color");
  }

  const breadcrumbs = page.locator(".MuiBreadcrumbs-root.library-breadcrumbs[aria-label='Library breadcrumb']", { hasText: "Library" }).first();
  if ((await breadcrumbs.count()) === 0) throw new Error("missing classed Breadcrumbs root/aria-label target");
  if ((await breadcrumbs.locator(".MuiBreadcrumbs-ol.library-breadcrumbs-ol", { hasText: "Home" }).count()) === 0) {
    throw new Error("Breadcrumbs did not merge ol slot class");
  }

  if ((await page.locator(".MuiTooltip-popper:not(.MuiTooltip-popperInteractive)").count()) === 0) {
    throw new Error("disableInteractive Tooltip did not omit MuiTooltip-popperInteractive");
  }
  const defaultTooltip = page.locator(".MuiTooltip-popper.Mui-open.MuiTooltip-popperInteractive[data-open='1'][data-placement='bottom'][data-arrow='0'][data-disable-interactive='0']", { hasText: "Tooltip label" }).first();
  if ((await defaultTooltip.count()) === 0) {
    throw new Error("missing default Tooltip DOM data contract");
  }
  const arrowTooltipPopper = page.locator(".MuiTooltip-popper.Mui-open.MuiTooltip-popperInteractive.MuiTooltip-popperArrow[data-open='1'][data-placement='bottom'][data-arrow='1'][data-disable-interactive='0']", { hasText: "Arrow tooltip" }).first();
  if ((await arrowTooltipPopper.count()) === 0) {
    throw new Error("missing arrow Tooltip DOM data contract");
  }
  const staticTooltipPopper = page.locator(".MuiTooltip-popper.Mui-open[data-open='1'][data-placement='bottom'][data-arrow='0'][data-disable-interactive='1']", { hasText: "Static tooltip" }).first();
  if ((await staticTooltipPopper.count()) === 0) {
    throw new Error("missing disableInteractive Tooltip DOM data contract");
  }
  const topTooltipPopper = page.locator(".MuiTooltip-popper.Mui-open.MuiTooltip-popperInteractive[data-open='1'][data-placement='top'][data-arrow='0'][data-disable-interactive='0']", { hasText: "Top tooltip" }).first();
  if ((await topTooltipPopper.count()) === 0) {
    throw new Error("missing top Tooltip DOM data contract");
  }
  const defaultPopover = page.locator(".MuiPopover-root.Mui-open[data-open='1'][data-anchor-origin-vertical='top'][data-anchor-origin-horizontal='left'][data-transform-origin-vertical='top'][data-transform-origin-horizontal='left']", { hasText: "Popover content" }).first();
  if ((await defaultPopover.count()) === 0) {
    throw new Error("missing default Popover DOM data contract");
  }
  const defaultMenu = page.locator(".MuiMenu-root.Mui-open.MuiPopover-anchorBottomLeft.MuiPopover-transformTopLeft[data-open='1'][data-anchor-origin-vertical='bottom'][data-anchor-origin-horizontal='left'][data-transform-origin-vertical='top'][data-transform-origin-horizontal='left']", { hasText: "Menu child" }).first();
  if ((await defaultMenu.count()) === 0) {
    throw new Error("missing default Menu DOM data contract");
  }
  const bottomRightMenu = page.locator(".MuiMenu-root.Mui-open.MuiPopover-anchorBottomRight.MuiPopover-transformTopRight[data-open='1'][data-anchor-origin-vertical='bottom'][data-anchor-origin-horizontal='right'][data-transform-origin-vertical='top'][data-transform-origin-horizontal='right']", { hasText: "Bottom right menu child" }).first();
  if ((await bottomRightMenu.count()) === 0) {
    throw new Error("missing bottom-right Menu DOM data contract");
  }
  const bottomRightPopover = page.locator(".MuiPopover-root.Mui-open.MuiPopover-anchorBottomRight.MuiPopover-transformTopRight[data-open='1'][data-anchor-origin-vertical='bottom'][data-anchor-origin-horizontal='right'][data-transform-origin-vertical='top'][data-transform-origin-horizontal='right']", { hasText: "Bottom right popover content" }).first();
  if ((await bottomRightPopover.count()) === 0) {
    throw new Error("missing bottom-right Popover DOM data contract");
  }
  const defaultPopper = page.locator(".MuiPopper-root.Mui-open.MuiPopper-placementBottom[data-open='1'][data-placement='bottom']", { hasText: "Popper content" }).first();
  if ((await defaultPopper.count()) === 0) {
    throw new Error("missing default Popper DOM data contract");
  }
  const topStartPopper = page.locator(".MuiPopper-root.Mui-open.MuiPopper-placementTopStart[data-open='1'][data-placement='top-start']", { hasText: "Top start popper content" }).first();
  if ((await topStartPopper.count()) === 0) {
    throw new Error("missing top-start Popper DOM data contract");
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
  if ((await autocomplete.getAttribute("data-open")) !== "1") throw new Error("Autocomplete root did not preserve data-open=1");
  if ((await autocomplete.getAttribute("data-full-width")) !== "1") throw new Error("Autocomplete root did not preserve data-full-width=1");
  if ((await autocomplete.getAttribute("data-disable-portal")) !== "1") throw new Error("Autocomplete root did not preserve data-disable-portal=1");
  if ((await autocomplete.getAttribute("data-disabled")) !== "0") throw new Error("Autocomplete root did not preserve data-disabled=0");
  if ((await autocomplete.getAttribute("data-read-only")) !== "0") throw new Error("Autocomplete root did not preserve data-read-only=0");
  if ((await autocomplete.getAttribute("data-input-value")) !== "") throw new Error("Autocomplete root did not preserve empty data-input-value");
  if ((await autocomplete.getAttribute("data-placeholder")) !== "") throw new Error("Autocomplete root did not preserve empty data-placeholder");
  if ((await autocomplete.locator(".MuiAutocomplete-popupIndicator.MuiAutocomplete-popupIndicatorOpen").count()) === 0) {
    throw new Error("missing Autocomplete popupIndicatorOpen ownerState utility class");
  }
  const autocompletePopper = autocomplete.locator(".MuiAutocomplete-popper.MuiAutocomplete-popperDisablePortal[data-autocomplete-open='1'][data-autocomplete-disable-portal='1']").first();
  if ((await autocompletePopper.count()) === 0) {
    throw new Error("missing Autocomplete popperDisablePortal ownerState utility class");
  }
  const autocompleteInput = autocomplete.locator(".MuiAutocomplete-input").first();
  if ((await autocompleteInput.inputValue()) !== "") throw new Error("Autocomplete input did not preserve empty inputValue");

  const surfaceStateCases = [
    [".MuiTypography-root.MuiTypography-gutterBottom.MuiTypography-noWrap", "Compact headline"],
    [".MuiTypography-root.MuiTypography-h6", "Section heading"],
    [".MuiTypography-root.MuiTypography-alignCenter", "Centered body copy"],
    [".MuiToolbar-root.MuiToolbar-dense[data-variant='dense'][data-disable-gutters='0']", "Dense toolbar"],
    [".MuiAppBar-root.MuiAppBar-colorPrimary.MuiAppBar-positionFixed[data-color='primary'][data-position='fixed'][data-enable-color-on-dark='0']", "Toolbar title"],
    [".MuiAppBar-root.MuiAppBar-colorSecondary.MuiAppBar-positionStatic[data-color='secondary'][data-position='static'][data-enable-color-on-dark='0']", "Static secondary app bar"],
    [".MuiAppBar-root.MuiAppBar-colorTransparent.MuiAppBar-positionSticky[data-color='transparent'][data-position='sticky'][data-enable-color-on-dark='1']", "Sticky transparent app bar"],
    [".MuiDialog-root.Mui-open[data-open='1'][data-scroll='paper'][data-max-width='sm'][data-full-width='0'][data-full-screen='0']", "Dialog title"],
    [".MuiDialogContent-root[data-dividers='0']", "Dialog body"],
    [".MuiDialogContent-root.MuiDialogContent-dividers[data-dividers='1']", "Divided dialog content"],
    [".MuiLink-root.MuiLink-underlineHover", "Hover link"],
    [".MuiLink-root.MuiLink-underlineNone", "Plain link"],
    [".MuiSvgIcon-root.MuiSvgIcon-fontSizeSmall", null],
    [".MuiSvgIcon-root.MuiSvgIcon-colorSecondary", null],
    [".MuiSvgIcon-root.MuiSvgIcon-colorSuccess", null],
    [".MuiSvgIcon-root.MuiSvgIcon-colorWarning", null],
    [".MuiSvgIcon-root.MuiSvgIcon-colorInfo", null],
    [".MuiSvgIcon-root.MuiSvgIcon-colorError", null],
    [".MuiSvgIcon-root.MuiSvgIcon-colorAction", null],
    [".MuiSvgIcon-root.MuiSvgIcon-colorDisabled", null],
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
    [".MuiToolbar-root[data-variant='regular'][data-disable-gutters='1']", "Flush toolbar", "MuiToolbar-gutters"],
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
    [".MuiContainer-root.MuiContainer-fixed.MuiContainer-disableGutters[data-max-width='lg'][data-fixed='1'][data-disable-gutters='1']", "Fixed flush container"],
    [".MuiContainer-root.MuiContainer-maxWidthLg[data-max-width='lg'][data-fixed='1'][data-disable-gutters='1']", "Fixed flush container"],
    [".MuiContainer-root.MuiContainer-maxWidthMd[data-max-width='md'][data-fixed='0'][data-disable-gutters='0']", "Medium container"],
    [".MuiDialogContent-root.MuiDialogContent-dividers", "Divided dialog content"],
    [".MuiDialog-container.MuiDialog-scrollPaper[data-dialog-scroll='paper']", "Dialog title"],
    [".MuiDialog-paper.MuiDialog-paperWidthSm[data-dialog-max-width='sm'][data-dialog-full-width='0'][data-dialog-full-screen='0']", "Dialog title"],
    [".MuiDialog-root.Mui-open[data-open='1'][data-scroll='paper'][data-max-width='sm'][data-full-width='1'][data-full-screen='1']", "Full screen dialog body"],
    [".MuiDialog-paper.MuiDialog-paperFullWidth.MuiDialog-paperFullScreen[data-dialog-max-width='sm'][data-dialog-full-width='1'][data-dialog-full-screen='1']", "Full screen dialog body"],
    [".MuiDialog-root.Mui-open[data-open='1'][data-scroll='body'][data-max-width='md'][data-full-width='0'][data-full-screen='0']", "Body scroll medium dialog body"],
    [".MuiDialog-container.MuiDialog-scrollBody[data-dialog-scroll='body']", "Body scroll medium dialog body"],
    [".MuiDialog-paper.MuiDialog-paperWidthMd[data-dialog-max-width='md'][data-dialog-full-width='0'][data-dialog-full-screen='0']", "Body scroll medium dialog body"],
    [".MuiModal-root.Mui-open[data-open='1'][data-hide-backdrop='0'][data-keep-mounted='0'][data-disable-portal='0'][data-disable-scroll-lock='0'][data-close-after-transition='0'][data-disable-auto-focus='0'][data-disable-enforce-focus='0'][data-disable-restore-focus='0']", "Modal content"],
    [".MuiModal-root.Mui-open[data-open='1'][data-hide-backdrop='1'][data-keep-mounted='1'][data-disable-portal='1'][data-disable-scroll-lock='1'][data-close-after-transition='1'][data-disable-auto-focus='1'][data-disable-enforce-focus='1'][data-disable-restore-focus='1']", "Configured modal content"],
    [".MuiDrawer-root.MuiDrawer-anchorLeft.Mui-open[data-open='1'][data-anchor='left'][data-variant='temporary'][data-hide-backdrop='0']", "Drawer content"],
    [".MuiDrawer-root.MuiDrawer-anchorRight.Mui-open[data-open='1'][data-anchor='right'][data-variant='temporary'][data-hide-backdrop='1']", "Right drawer content"],
    [".MuiDrawer-root.MuiDrawer-anchorLeft.Mui-open[data-open='1'][data-anchor='left'][data-variant='temporary']", "Swipeable drawer content"],
    [".MuiDrawer-root.MuiDrawer-anchorRight.Mui-open[data-open='1'][data-anchor='right'][data-variant='temporary']", "Right swipeable drawer content"],
    [".MuiPaper-root.MuiPaper-outlined[data-variant='outlined'][data-square='0']", "Outlined paper"],
    [".MuiPaper-root.MuiPaper-elevation.MuiPaper-elevation3[data-variant='elevation'][data-elevation='3'][data-square='0']", "Elevation three paper"],
    [".MuiCard-root.MuiPaper-elevation8[data-raised='1']", "Raised card content"],
    [".MuiDivider-root.MuiDivider-absolute.MuiDivider-flexItem[data-variant='fullWidth'][data-orientation='horizontal'][data-absolute='1'][data-flex-item='1'][data-text-align='center']", null],
    [".MuiDivider-root.MuiDivider-middle[data-variant='middle'][data-orientation='horizontal'][data-absolute='0'][data-flex-item='0'][data-text-align='center']", null],
    [".MuiDivider-root.MuiDivider-inset[data-variant='inset'][data-orientation='horizontal'][data-absolute='0'][data-flex-item='0'][data-text-align='center']", null],
    [".MuiDivider-root.MuiDivider-vertical.MuiDivider-flexItem[data-variant='fullWidth'][data-orientation='vertical'][data-absolute='0'][data-flex-item='1'][data-text-align='center']", null],
    [".MuiDivider-root.MuiDivider-textAlignLeft[data-variant='fullWidth'][data-orientation='horizontal'][data-absolute='0'][data-flex-item='0'][data-text-align='left']", null],
  ];

  for (const [selector, label] of layoutStateCases) {
    const locator = label ? page.locator(selector, { hasText: label }) : page.locator(selector);
    if ((await locator.count()) === 0) throw new Error(`missing layout ownerState utility class ${selector}${label ? ` for '${label}'` : ""}`);
  }

  const defaultDrawer = page.locator(".MuiDrawer-root.MuiDrawer-anchorLeft.Mui-open[data-open='1'][data-anchor='left'][data-variant='temporary'][data-hide-backdrop='0']", { hasText: "Drawer content" }).first();
  if ((await defaultDrawer.locator(".MuiDrawer-paper[aria-modal='true']", { hasText: "Drawer content" }).count()) === 0) {
    throw new Error("missing default Drawer paper aria-modal contract");
  }
  const configuredModal = page.locator(".MuiModal-root.Mui-open[data-open='1'][data-hide-backdrop='1'][data-keep-mounted='1'][data-disable-portal='1'][data-disable-scroll-lock='1'][data-close-after-transition='1'][data-disable-auto-focus='1'][data-disable-enforce-focus='1'][data-disable-restore-focus='1']", { hasText: "Configured modal content" }).first();
  if ((await configuredModal.locator(".MuiBackdrop-root").evaluate((node) => node.hidden)) !== true) {
    throw new Error("configured Modal hideBackdrop did not set hidden backdrop");
  }

  const squarePaper = page.locator(".MuiPaper-root[data-variant='elevation'][data-elevation='1'][data-square='1']", { hasText: "Square paper" }).first();
  if ((await squarePaper.count()) === 0) throw new Error("missing square Paper DOM data contract");
  if (await squarePaper.evaluate((node) => node.classList.contains("MuiPaper-rounded"))) {
    throw new Error("square Paper still emitted MuiPaper-rounded");
  }
  const rightDrawer = page.locator(".MuiDrawer-root.MuiDrawer-anchorRight.Mui-open[data-open='1'][data-anchor='right'][data-variant='temporary'][data-hide-backdrop='1']", { hasText: "Right drawer content" }).first();
  if ((await rightDrawer.locator(".MuiDrawer-paper[aria-modal='true']", { hasText: "Right drawer content" }).count()) === 0) {
    throw new Error("missing right Drawer paper aria-modal contract");
  }
  if ((await rightDrawer.locator(".MuiBackdrop-root").evaluate((node) => node.hidden)) !== true) {
    throw new Error("right Drawer hideBackdrop did not set hidden backdrop");
  }
  const rightSwipeableDrawer = page.locator(".MuiDrawer-root.MuiDrawer-anchorRight.Mui-open[data-open='1'][data-anchor='right'][data-variant='temporary']", { hasText: "Right swipeable drawer content" }).first();
  if ((await rightSwipeableDrawer.locator(".MuiDrawer-paper[aria-modal='true']", { hasText: "Right swipeable drawer content" }).count()) === 0) {
    throw new Error("missing right SwipeableDrawer paper aria-modal contract");
  }

  const switchBaseCases = [
    [".MuiCheckbox-root.MuiCheckbox-sizeSmall", "Small checkbox", "input[type='checkbox']", null],
    [".MuiCheckbox-root.MuiCheckbox-colorSecondary", "Secondary checkbox", "input[type='checkbox']", null],
    [".MuiCheckbox-root.MuiCheckbox-indeterminate", "Indeterminate checkbox", "input[type='checkbox']", "required"],
    [".MuiCheckbox-root.Mui-checked", "Checked checkbox", "input[type='checkbox']", "checked"],
    [".MuiCheckbox-root.Mui-disabled", "Disabled checkbox", "input[type='checkbox']", "disabled"],
    [".MuiRadio-root.MuiRadio-sizeSmall", "Small radio", "input[type='radio']", null],
    [".MuiRadio-root.MuiRadio-colorSecondary", "Secondary radio", "input[type='radio']", null],
    [".MuiRadio-root", "Named required radio", "input[type='radio']", "required"],
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

  const indeterminateCheckbox = page.locator(".MuiCheckbox-root.MuiCheckbox-indeterminate", { hasText: "Indeterminate checkbox" }).first();
  if ((await indeterminateCheckbox.count()) === 0) throw new Error("missing indeterminate Checkbox target");
  if ((await indeterminateCheckbox.getAttribute("data-color")) !== "primary") throw new Error("indeterminate Checkbox did not preserve default data-color=primary");
  if ((await indeterminateCheckbox.getAttribute("data-size")) !== "medium") throw new Error("indeterminate Checkbox did not preserve default data-size=medium");
  if ((await indeterminateCheckbox.getAttribute("data-checked")) !== "0") throw new Error("indeterminate Checkbox did not preserve data-checked=0");
  if ((await indeterminateCheckbox.getAttribute("data-disabled")) !== "0") throw new Error("indeterminate Checkbox did not preserve data-disabled=0");
  if ((await indeterminateCheckbox.getAttribute("data-required")) !== "1") throw new Error("indeterminate Checkbox did not preserve data-required=1");
  if ((await indeterminateCheckbox.getAttribute("data-indeterminate")) !== "1") throw new Error("indeterminate Checkbox did not preserve data-indeterminate=1");
  const indeterminateInput = indeterminateCheckbox.locator("input[type='checkbox']").first();
  if ((await indeterminateInput.getAttribute("data-indeterminate")) !== "true") {
    throw new Error("indeterminate Checkbox did not emit data-indeterminate=true");
  }
  if ((await indeterminateInput.getAttribute("name")) !== "consent") throw new Error("Checkbox did not preserve name prop");
  if ((await indeterminateInput.getAttribute("value")) !== "partial") throw new Error("Checkbox did not preserve value prop");

  const checkedCheckbox = page.locator(".MuiCheckbox-root.Mui-checked", { hasText: "Checked checkbox" }).first();
  if ((await checkedCheckbox.getAttribute("data-checked")) !== "1") throw new Error("checked Checkbox did not preserve data-checked=1");

  const disabledCheckbox = page.locator(".MuiCheckbox-root.Mui-disabled", { hasText: "Disabled checkbox" }).first();
  if ((await disabledCheckbox.getAttribute("data-disabled")) !== "1") throw new Error("disabled Checkbox did not preserve data-disabled=1");

  const secondaryCheckbox = page.locator(".MuiCheckbox-root.MuiCheckbox-colorSecondary", { hasText: "Secondary checkbox" }).first();
  if ((await secondaryCheckbox.getAttribute("data-color")) !== "secondary") throw new Error("secondary Checkbox did not preserve data-color=secondary");

  const smallCheckbox = page.locator(".MuiCheckbox-root.MuiCheckbox-sizeSmall", { hasText: "Small checkbox" }).first();
  if ((await smallCheckbox.getAttribute("data-size")) !== "small") throw new Error("small Checkbox did not preserve data-size=small");

  const namedRadio = page.locator(".MuiRadio-root", { hasText: "Named required radio" }).first();
  if ((await namedRadio.getAttribute("data-color")) !== "primary") throw new Error("named Radio did not preserve default data-color=primary");
  if ((await namedRadio.getAttribute("data-size")) !== "medium") throw new Error("named Radio did not preserve default data-size=medium");
  if ((await namedRadio.getAttribute("data-checked")) !== "0") throw new Error("named Radio did not preserve data-checked=0");
  if ((await namedRadio.getAttribute("data-disabled")) !== "0") throw new Error("named Radio did not preserve data-disabled=0");
  if ((await namedRadio.getAttribute("data-required")) !== "1") throw new Error("named Radio did not preserve data-required=1");
  const namedRadioInput = namedRadio.locator("input[type='radio']").first();
  if ((await namedRadioInput.getAttribute("name")) !== "choice") throw new Error("Radio did not preserve name prop");
  if ((await namedRadioInput.getAttribute("value")) !== "named") throw new Error("Radio did not preserve value prop");

  const checkedRadio = page.locator(".MuiRadio-root.Mui-checked", { hasText: "Checked radio" }).first();
  if ((await checkedRadio.getAttribute("data-checked")) !== "1") throw new Error("checked Radio did not preserve data-checked=1");

  const disabledRadio = page.locator(".MuiRadio-root.Mui-disabled", { hasText: "Disabled radio" }).first();
  if ((await disabledRadio.getAttribute("data-disabled")) !== "1") throw new Error("disabled Radio did not preserve data-disabled=1");

  const secondaryRadio = page.locator(".MuiRadio-root.MuiRadio-colorSecondary", { hasText: "Secondary radio" }).first();
  if ((await secondaryRadio.getAttribute("data-color")) !== "secondary") throw new Error("secondary Radio did not preserve data-color=secondary");

  const smallRadio = page.locator(".MuiRadio-root.MuiRadio-sizeSmall", { hasText: "Small radio" }).first();
  if ((await smallRadio.getAttribute("data-size")) !== "small") throw new Error("small Radio did not preserve data-size=small");

  const smallSwitch = page.locator(".MuiSwitch-root.MuiSwitch-sizeSmall", { hasText: "Small switch" }).first();
  if ((await smallSwitch.count()) === 0) throw new Error("missing small Switch size utility class");
  if ((await smallSwitch.getAttribute("data-size")) !== "small") throw new Error("small Switch did not preserve data-size=small");
  if ((await smallSwitch.getAttribute("data-edge")) !== "") throw new Error("small Switch did not preserve empty data-edge");

  const checkedSwitch = page.locator(".MuiSwitch-root", { hasText: "Checked switch" }).first();
  if ((await checkedSwitch.locator(".MuiSwitch-switchBase.Mui-checked").count()) === 0) throw new Error("missing checked Switch switchBase state class");
  const checkedSwitchBase = checkedSwitch.locator(".MuiSwitch-switchBase").first();
  if ((await checkedSwitchBase.getAttribute("data-color")) !== "primary") throw new Error("checked Switch did not preserve default data-color=primary");
  if ((await checkedSwitchBase.getAttribute("data-checked")) !== "1") throw new Error("checked Switch did not preserve data-checked=1");
  if ((await checkedSwitchBase.getAttribute("data-disabled")) !== "0") throw new Error("checked Switch did not preserve data-disabled=0");
  if ((await checkedSwitchBase.getAttribute("data-required")) !== "0") throw new Error("checked Switch did not preserve data-required=0");
  if (!(await checkedSwitch.locator("input[type='checkbox']").evaluate((node) => node.checked))) {
    throw new Error("checked Switch did not set input.checked");
  }

  const secondarySwitch = page.locator(".MuiSwitch-root", { hasText: "Secondary switch" }).first();
  if ((await secondarySwitch.count()) === 0) throw new Error("missing secondary Switch target");
  if ((await secondarySwitch.locator(".MuiSwitch-switchBase.MuiSwitch-colorSecondary").count()) === 0) {
    throw new Error("missing secondary Switch color utility class");
  }
  if ((await secondarySwitch.locator(".MuiSwitch-switchBase").first().getAttribute("data-color")) !== "secondary") {
    throw new Error("secondary Switch did not preserve data-color=secondary");
  }

  const edgeStartSwitch = page.locator(".MuiSwitch-root.MuiSwitch-edgeStart", { hasText: "Edge start switch" }).first();
  if ((await edgeStartSwitch.count()) === 0) throw new Error("missing Switch edgeStart utility class");
  if ((await edgeStartSwitch.getAttribute("data-edge")) !== "start") throw new Error("edge start Switch did not preserve data-edge=start");
  const edgeStartSwitchInput = edgeStartSwitch.locator("input[type='checkbox']").first();
  const edgeStartSwitchBase = edgeStartSwitch.locator(".MuiSwitch-switchBase").first();
  if ((await edgeStartSwitchBase.getAttribute("data-required")) !== "1") throw new Error("edge start Switch did not preserve data-required=1");
  if (!(await edgeStartSwitchInput.evaluate((node) => node.required))) throw new Error("edge start Switch did not set input.required");
  if ((await edgeStartSwitchInput.getAttribute("name")) !== "notifications") throw new Error("Switch did not preserve name prop");
  if ((await edgeStartSwitchInput.getAttribute("value")) !== "enabled") throw new Error("Switch did not preserve value prop");

  const edgeEndSwitch = page.locator(".MuiSwitch-root.MuiSwitch-edgeEnd", { hasText: "Edge end switch" }).first();
  if ((await edgeEndSwitch.count()) === 0) throw new Error("missing Switch edgeEnd utility class");
  if ((await edgeEndSwitch.getAttribute("data-edge")) !== "end") throw new Error("edge end Switch did not preserve data-edge=end");

  const disabledSwitch = page.locator(".MuiSwitch-root", { hasText: "Disabled switch" }).first();
  if ((await disabledSwitch.locator(".MuiSwitch-switchBase.Mui-disabled").count()) === 0) throw new Error("missing disabled Switch switchBase state class");
  if ((await disabledSwitch.locator(".MuiSwitch-switchBase").first().getAttribute("data-disabled")) !== "1") {
    throw new Error("disabled Switch did not preserve data-disabled=1");
  }
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
    [".MuiFormControlLabel-root.Mui-disabled.Mui-error.Mui-required[data-disabled='1'][data-error='1'][data-required='1'][data-label-placement='end']", "State form control label"],
    [".MuiFormControlLabel-root.MuiFormControlLabel-labelPlacementStart[data-disabled='0'][data-error='0'][data-required='0'][data-label-placement='start']", "Start label placement"],
    [".MuiFormControlLabel-root.MuiFormControlLabel-labelPlacementTop[data-disabled='0'][data-error='0'][data-required='0'][data-label-placement='top']", "Top label placement"],
    [".MuiFormControlLabel-root.MuiFormControlLabel-labelPlacementBottom[data-disabled='0'][data-error='0'][data-required='0'][data-label-placement='bottom']", "Bottom label placement"],
    [".MuiRadioGroup-root.MuiRadioGroup-row.Mui-error[data-row='1'][data-error='1'][data-name=''][data-value=''][data-default-value='']", "Row error radio"],
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
  if ((await adornment.first().getAttribute("data-position")) !== "start") throw new Error("InputAdornment did not preserve default data-position=start");
  if ((await adornment.first().getAttribute("data-size")) !== "medium") throw new Error("InputAdornment did not preserve default data-size=medium");
  if ((await adornment.first().getAttribute("data-disable-pointer-events")) !== "1") throw new Error("InputAdornment did not preserve data-disable-pointer-events=1");
  if ((await adornment.first().getAttribute("data-hidden-label")) !== "1") throw new Error("InputAdornment did not preserve data-hidden-label=1");

  const defaultAdornment = page.locator(
    ".MuiInputAdornment-root.MuiInputAdornment-positionStart.MuiInputAdornment-standard.MuiInputAdornment-sizeMedium",
    { hasText: "$" },
  );
  if ((await defaultAdornment.count()) === 0) throw new Error("missing default InputAdornment ownerState utility classes");
  if ((await defaultAdornment.first().getAttribute("data-position")) !== "start") throw new Error("default InputAdornment did not preserve data-position=start");
  if ((await defaultAdornment.first().getAttribute("data-variant")) !== "standard") throw new Error("default InputAdornment did not preserve data-variant=standard");
  if ((await defaultAdornment.first().getAttribute("data-size")) !== "medium") throw new Error("default InputAdornment did not preserve data-size=medium");

  const endAdornment = page.locator(
    ".MuiInputAdornment-root.MuiInputAdornment-positionEnd.MuiInputAdornment-standard.MuiInputAdornment-sizeMedium",
    { hasText: "kg" },
  );
  if ((await endAdornment.count()) === 0) throw new Error("missing end-position InputAdornment ownerState utility classes");
  if ((await endAdornment.first().getAttribute("data-position")) !== "end") throw new Error("end InputAdornment did not preserve data-position=end");
  if ((await endAdornment.first().getAttribute("data-variant")) !== "standard") throw new Error("end InputAdornment did not preserve data-variant=standard");

  const selectRoot = page.locator(".MuiSelect-root.Mui-disabled.Mui-error", { hasText: "State select" }).first();
  if ((await selectRoot.count()) === 0) throw new Error("missing Select root disabled/error ownerState utility classes");
  if ((await selectRoot.getAttribute("data-color")) !== "primary") throw new Error("Select root did not preserve default data-color=primary");
  if ((await selectRoot.getAttribute("data-variant")) !== "outlined") throw new Error("Select root did not preserve default data-variant=outlined");
  if ((await selectRoot.getAttribute("data-open")) !== "1") throw new Error("Select root did not preserve data-open=1");
  if ((await selectRoot.getAttribute("data-disabled")) !== "1") throw new Error("Select root did not preserve data-disabled=1");
  if ((await selectRoot.getAttribute("data-error")) !== "1") throw new Error("Select root did not preserve data-error=1");
  if ((await selectRoot.getAttribute("data-multiple")) !== "1") throw new Error("Select root did not preserve data-multiple=1");
  if ((await selectRoot.getAttribute("data-native")) !== "0") throw new Error("Select root did not preserve default data-native=0");
  if ((await selectRoot.getAttribute("data-default-open")) !== "0") throw new Error("Select root did not preserve default data-default-open=0");
  if ((await selectRoot.getAttribute("data-auto-width")) !== "0") throw new Error("Select root did not preserve default data-auto-width=0");
  if ((await selectRoot.getAttribute("data-display-empty")) !== "0") throw new Error("Select root did not preserve default data-display-empty=0");
  if ((await selectRoot.getAttribute("data-value")) !== "") throw new Error("Select root did not preserve empty data-value");
  if ((await selectRoot.locator(".MuiSelect-select.Mui-disabled.MuiSelect-multiple.Mui-error", { hasText: "State select" }).count()) === 0) {
    throw new Error("missing Select select-slot ownerState utility classes");
  }
  if ((await selectRoot.locator(".MuiSelect-icon.MuiSelect-iconOpen.Mui-disabled").count()) === 0) {
    throw new Error("missing Select icon-slot open/disabled ownerState utility classes");
  }
  if (!(await selectRoot.locator("input.MuiSelect-nativeInput").evaluate((node) => node instanceof HTMLInputElement && node.disabled && node.value === ""))) {
    throw new Error("disabled Select did not set native input.disabled");
  }

  const defaultSelect = page.locator(".MuiSelect-root", { hasText: "First option" }).first();
  if ((await defaultSelect.count()) === 0) throw new Error("missing default Select target");
  if ((await defaultSelect.getAttribute("data-variant")) !== "outlined") throw new Error("default Select did not preserve data-variant=outlined");
  if ((await defaultSelect.locator(".MuiSelect-select.MuiSelect-outlined").count()) === 0) {
    throw new Error("missing default Select outlined utility class");
  }
  const standardSelect = page.locator(".MuiSelect-root", { hasText: "Standard select" }).first();
  if ((await standardSelect.count()) === 0) throw new Error("missing standard Select target");
  if ((await standardSelect.getAttribute("data-variant")) !== "standard") throw new Error("standard Select did not preserve data-variant=standard");
  if ((await standardSelect.locator(".MuiSelect-select.MuiSelect-standard").count()) === 0) {
    throw new Error("missing standard Select utility class");
  }
  const secondarySelect = page.locator(".MuiSelect-root.MuiInputBase-colorSecondary", { hasText: "Secondary select" }).first();
  if ((await secondarySelect.count()) === 0) throw new Error("missing secondary Select input color utility class");
  if ((await secondarySelect.getAttribute("data-color")) !== "secondary") throw new Error("secondary Select did not preserve data-color=secondary");

  const nativeSelectRoot = page.locator(".MuiNativeSelect-root.Mui-disabled.Mui-error", { hasText: "Disabled native option" }).first();
  if ((await nativeSelectRoot.count()) === 0) throw new Error("missing NativeSelect root disabled/error ownerState utility classes");
  if ((await nativeSelectRoot.getAttribute("data-color")) !== "primary") throw new Error("NativeSelect root did not preserve default data-color=primary");
  if ((await nativeSelectRoot.getAttribute("data-variant")) !== "standard") throw new Error("NativeSelect root did not preserve default data-variant=standard");
  if ((await nativeSelectRoot.getAttribute("data-disabled")) !== "1") throw new Error("NativeSelect root did not preserve data-disabled=1");
  if ((await nativeSelectRoot.getAttribute("data-error")) !== "1") throw new Error("NativeSelect root did not preserve data-error=1");
  if ((await nativeSelectRoot.getAttribute("data-multiple")) !== "1") throw new Error("NativeSelect root did not preserve data-multiple=1");
  if ((await nativeSelectRoot.getAttribute("data-value")) !== "") throw new Error("NativeSelect root did not preserve empty data-value");
  const nativeSelect = nativeSelectRoot.locator("select.MuiNativeSelect-select.Mui-disabled.MuiNativeSelect-multiple.Mui-error");
  if ((await nativeSelect.count()) === 0) throw new Error("missing NativeSelect select-slot ownerState utility classes");
  if (!(await nativeSelect.evaluate((node) => node instanceof HTMLSelectElement && node.disabled && node.multiple && node.value === ""))) {
    throw new Error("NativeSelect did not set select.disabled and select.multiple");
  }
  if ((await nativeSelectRoot.locator(".MuiNativeSelect-icon.Mui-disabled").count()) === 0) {
    throw new Error("missing NativeSelect icon-slot disabled ownerState utility class");
  }

  const defaultNativeSelect = page.locator(".MuiNativeSelect-root", { hasText: "Native option" }).first();
  if ((await defaultNativeSelect.count()) === 0) throw new Error("missing default NativeSelect target");
  if ((await defaultNativeSelect.getAttribute("data-variant")) !== "standard") throw new Error("default NativeSelect did not preserve data-variant=standard");
  if ((await defaultNativeSelect.locator("select.MuiNativeSelect-select.MuiNativeSelect-standard").count()) === 0) {
    throw new Error("missing default NativeSelect standard utility class");
  }
  const outlinedNativeSelect = page.locator(".MuiNativeSelect-root", { hasText: "Outlined native option" }).first();
  if ((await outlinedNativeSelect.count()) === 0) throw new Error("missing outlined NativeSelect target");
  if ((await outlinedNativeSelect.getAttribute("data-variant")) !== "outlined") throw new Error("outlined NativeSelect did not preserve data-variant=outlined");
  if ((await outlinedNativeSelect.locator("select.MuiNativeSelect-select.MuiNativeSelect-outlined").count()) === 0) {
    throw new Error("missing outlined NativeSelect utility class");
  }
  const secondaryNativeSelect = page.locator(".MuiNativeSelect-root.MuiInputBase-colorSecondary", { hasText: "Secondary native option" }).first();
  if ((await secondaryNativeSelect.count()) === 0) throw new Error("missing secondary NativeSelect input color utility class");
  if ((await secondaryNativeSelect.getAttribute("data-color")) !== "secondary") throw new Error("secondary NativeSelect did not preserve data-color=secondary");

  const defaultTextarea = page.locator(".MuiTextareaAutosize-root", { hasText: "Textarea" }).first();
  if ((await defaultTextarea.count()) === 0) throw new Error("missing default TextareaAutosize target");
  if ((await defaultTextarea.getAttribute("data-min-rows")) !== "1") throw new Error("default TextareaAutosize did not preserve data-min-rows=1");
  if ((await defaultTextarea.getAttribute("data-max-rows")) !== "0") throw new Error("default TextareaAutosize did not preserve data-max-rows=0");
  if ((await defaultTextarea.getAttribute("data-value")) !== "") throw new Error("default TextareaAutosize did not preserve empty data-value");
  const sizedTextarea = page.locator(".MuiTextareaAutosize-root[data-min-rows='3'][data-max-rows='6'][data-value='Autosized value']", { hasText: "Sized textarea" }).first();
  if ((await sizedTextarea.count()) === 0) throw new Error("missing sized TextareaAutosize DOM data contract");
  if ((await sizedTextarea.inputValue()) !== "Autosized value") throw new Error("sized TextareaAutosize did not preserve value");

  const textField = page.locator(".MuiTextField-root.MuiFormControl-fullWidth", { hasText: "State text field" }).first();
  if ((await textField.count()) === 0) throw new Error("missing TextField fullWidth ownerState utility class");
  if ((await textField.getAttribute("data-color")) !== "primary") throw new Error("TextField root did not preserve default data-color=primary");
  if ((await textField.getAttribute("data-disabled")) !== "1") throw new Error("TextField root did not preserve data-disabled=1");
  if ((await textField.getAttribute("data-error")) !== "1") throw new Error("TextField root did not preserve data-error=1");
  if ((await textField.getAttribute("data-full-width")) !== "1") throw new Error("TextField root did not preserve data-full-width=1");
  if ((await textField.getAttribute("data-multiline")) !== "1") throw new Error("TextField root did not preserve data-multiline=1");
  if ((await textField.getAttribute("data-required")) !== "1") throw new Error("TextField root did not preserve data-required=1");
  if ((await textField.getAttribute("data-select")) !== "0") throw new Error("TextField root did not preserve data-select=0");
  if ((await textField.getAttribute("data-type")) !== "text") throw new Error("TextField root did not preserve data-type=text");
  if ((await textField.getAttribute("data-value")) !== "") throw new Error("TextField root did not preserve empty data-value");
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
  if ((await secondaryTextField.getAttribute("data-color")) !== "secondary") throw new Error("secondary TextField did not preserve data-color=secondary");
  if ((await secondaryTextField.locator(".MuiOutlinedInput-root.MuiInputBase-colorSecondary").count()) === 0) {
    throw new Error("missing secondary TextField input color utility class");
  }

  const defaultAvatar = page.locator(".MuiAvatar-root.MuiAvatar-circular.MuiAvatar-colorDefault", { hasText: "A" }).first();
  if ((await defaultAvatar.count()) === 0) throw new Error("missing default Avatar ownerState utility classes");
  if ((await defaultAvatar.getAttribute("data-variant")) !== "circular") throw new Error("default Avatar did not preserve data-variant=circular");
  if ((await defaultAvatar.getAttribute("data-has-image")) !== "0") throw new Error("default Avatar did not preserve data-has-image=0");
  if ((await defaultAvatar.getAttribute("data-alt")) !== "") throw new Error("default Avatar did not preserve empty data-alt");
  if ((await defaultAvatar.getAttribute("data-src")) !== "") throw new Error("default Avatar did not preserve empty data-src");
  if ((await defaultAvatar.getAttribute("data-src-set")) !== "") throw new Error("default Avatar did not preserve empty data-src-set");
  const roundedAvatar = page.locator(".MuiAvatar-root.MuiAvatar-rounded.MuiAvatar-colorDefault", { hasText: "R" }).first();
  if ((await roundedAvatar.count()) === 0) throw new Error("missing rounded Avatar ownerState utility classes");
  if ((await roundedAvatar.getAttribute("data-variant")) !== "rounded") throw new Error("rounded Avatar did not preserve data-variant=rounded");
  const imageAvatar = page.locator(".MuiAvatar-root.MuiAvatar-circular", { hasText: "Image avatar" }).first();
  if ((await imageAvatar.count()) === 0) throw new Error("missing image Avatar target");
  if (await imageAvatar.evaluate((node) => node.classList.contains("MuiAvatar-colorDefault"))) {
    throw new Error("image Avatar still emitted colorDefault ownerState class");
  }
  if ((await imageAvatar.getAttribute("data-variant")) !== "circular") throw new Error("image Avatar did not preserve data-variant=circular");
  if ((await imageAvatar.getAttribute("data-has-image")) !== "1") throw new Error("image Avatar did not preserve data-has-image=1");
  if ((await imageAvatar.getAttribute("data-alt")) !== "Avatar image") throw new Error("image Avatar did not preserve data-alt");
  if ((await imageAvatar.getAttribute("data-src")) !== "assets/mui_demo_avatar.webp") throw new Error("image Avatar did not preserve data-src");
  if ((await imageAvatar.getAttribute("data-src-set")) !== "assets/mui_demo_avatar@2x.webp 2x") throw new Error("image Avatar did not preserve data-src-set");
  const avatarImg = imageAvatar.locator("img.MuiAvatar-img:not(.MuiAvatar-imgHidden)").first();
  if ((await avatarImg.count()) === 0) throw new Error("image Avatar did not render visible MuiAvatar-img slot");
  if ((await avatarImg.getAttribute("alt")) !== "Avatar image") throw new Error("Avatar did not preserve alt prop");
  if ((await avatarImg.getAttribute("src")) !== "assets/mui_demo_avatar.webp") throw new Error("Avatar did not preserve src prop");
  if ((await avatarImg.getAttribute("srcset")) !== "assets/mui_demo_avatar@2x.webp 2x") throw new Error("Avatar did not preserve srcSet prop");

  const inheritedAvatarGroup = page.locator(".MuiAvatarGroup-root.library-avatar-group", { hasText: "Inherited group avatar" }).first();
  if ((await inheritedAvatarGroup.count()) === 0) throw new Error("missing classed AvatarGroup target");
  if ((await inheritedAvatarGroup.getAttribute("data-variant")) !== "rounded") throw new Error("AvatarGroup did not preserve data-variant=rounded");
  if ((await inheritedAvatarGroup.getAttribute("data-max")) !== "5") throw new Error("AvatarGroup did not preserve default data-max=5");
  if ((await inheritedAvatarGroup.getAttribute("data-spacing")) !== "medium") throw new Error("AvatarGroup did not preserve default data-spacing=medium");
  if ((await inheritedAvatarGroup.getAttribute("data-total")) !== "0") throw new Error("AvatarGroup did not preserve default data-total=0");
  if ((await inheritedAvatarGroup.locator(".MuiAvatar-root.MuiAvatar-rounded", { hasText: "Inherited group avatar" }).count()) === 0) {
    throw new Error("AvatarGroup did not project variant context to child Avatar in all-components demo");
  }
  if ((await inheritedAvatarGroup.locator(".MuiAvatar-root.MuiAvatar-square", { hasText: "Explicit group avatar" }).count()) === 0) {
    throw new Error("explicit Avatar variant did not override AvatarGroup context in all-components demo");
  }

  const defaultAlert = page.locator(".MuiAlert-root.MuiAlert-colorSuccess.MuiAlert-standard.MuiAlert-standardSuccess", { hasText: "Check the SA driven MUI surface." }).first();
  if ((await defaultAlert.count()) === 0) throw new Error("missing default Alert ownerState utility classes");
  if ((await defaultAlert.getAttribute("role")) !== "alert") throw new Error("default Alert did not preserve default role");
  if ((await defaultAlert.locator(".MuiAlert-icon:not(.MuiAlert-iconHidden)").count()) === 0) throw new Error("default Alert did not render visible icon slot");
  if ((await defaultAlert.locator(".MuiAlert-message .MuiAlertTitle-root", { hasText: "Heads up" }).count()) === 0) {
    throw new Error("default Alert did not render AlertTitle inside message slot");
  }
  const filledWarningAlert = page.locator(".MuiAlert-root.MuiAlert-colorWarning.MuiAlert-filled.MuiAlert-filledWarning", { hasText: "Filled warning alert" }).first();
  if ((await filledWarningAlert.count()) === 0) throw new Error("missing filled warning Alert ownerState utility classes");
  const actionInfoAlert = page.locator(".MuiAlert-root.MuiAlert-colorInfo.MuiAlert-outlined.MuiAlert-outlinedInfo[role='status']", { hasText: "Action info alert" }).first();
  if ((await actionInfoAlert.count()) === 0) throw new Error("missing color-overridden outlined Alert ownerState utility classes");
  if ((await actionInfoAlert.locator(".MuiAlert-icon.MuiAlert-iconHidden").count()) === 0) throw new Error("icon=false Alert did not hide icon slot");
  if ((await actionInfoAlert.locator(".MuiAlert-action", { hasText: "Retry" }).count()) === 0) throw new Error("Alert did not render action slot text");
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
