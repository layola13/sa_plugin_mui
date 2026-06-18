import { access, readFile, readdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const playwrightCacheDir = path.join(process.env.HOME ?? "", ".cache", "ms-playwright");
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

async function resolveChromiumExecutablePath() {
  const entries = await readdir(playwrightCacheDir, { withFileTypes: true }).catch(() => []);
  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();

  for (const name of names) {
    for (const candidate of [
      path.join(playwrightCacheDir, name, "chrome-linux", "chrome"),
      path.join(playwrightCacheDir, name, "chrome-headless-shell-linux64", "chrome-headless-shell"),
    ]) {
      try {
        await access(candidate);
        return candidate;
      } catch {}
    }
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
  const candidates = [
    path.join(rootDir, safePath),
    path.join(repoRoot, safePath),
  ];

  return candidates;
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
        server.close();
        reject(new Error("failed to bind static server"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}/index.html` });
    });
  });
}

async function expectCount(page, selector, label) {
  const count = await page.locator(selector).count();
  if (count === 0) throw new Error(`missing ${label}: ${selector}`);
}

async function expectOverlayState(page, selector, text, state) {
  const overlay = page.locator(selector, { hasText: text }).first();
  if ((await overlay.count()) === 0) throw new Error(`missing overlay ${text}: ${selector}`);

  const ariaHidden = await overlay.getAttribute("aria-hidden");
  if (ariaHidden !== state.ariaHidden) {
    throw new Error(`${text} aria-hidden expected ${state.ariaHidden}, got ${ariaHidden}`);
  }

  const className = await overlay.getAttribute("class");
  if (!className?.split(/\s+/).includes(state.className)) {
    throw new Error(`${text} missing ${state.className}: ${className}`);
  }

  return overlay;
}

async function expectNestedAttr(locator, selector, attr, value, label) {
  const node = locator.locator(selector).first();
  if ((await node.count()) === 0) throw new Error(`missing ${label}: ${selector}`);
  const actual = await node.getAttribute(attr);
  if (actual !== value) throw new Error(`${label} ${attr} expected ${value}, got ${actual}`);
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

async function main() {
  const rootDir = process.argv[2];
  if (!rootDir) throw new Error("usage: node tools/verify_mui_theme_lab_browser.mjs <dist-dir>");

  const { server, url } = await startStaticServer(rootDir);
  const executablePath = await resolveChromiumExecutablePath();
  const browser = await chromium.launch({ headless: true, executablePath: executablePath ?? undefined });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForSelector(".mui-theme-lab-smoke", { timeout: 10000 });
    await expectImagesLoaded(page);

    const themeProvider = page.locator(".MuiThemeProvider-root.MuiThemeProvider-modeDark").first();
    if ((await themeProvider.getAttribute("data-mui-color-scheme")) !== "dark") {
      throw new Error("ThemeProvider color-scheme data attribute did not match dark");
    }
    if ((await themeProvider.getAttribute("data-mui-mode")) !== "dark") {
      throw new Error("ThemeProvider mode data attribute did not match dark");
    }
    if ((await themeProvider.getAttribute("data-mui-default-color")) !== "primary") {
      throw new Error("ThemeProvider default color data attribute did not match primary");
    }
    if ((await themeProvider.getAttribute("data-mui-default-mode")) !== "system") {
      throw new Error("ThemeProvider defaultMode data attribute did not match system");
    }

    await expectCount(page, ".MuiLoadingButton-root.MuiLoadingButton-loading.MuiLoadingButton-loadingPositionCenter .MuiLoadingButton-loadingIndicator.MuiLoadingButton-loadingIndicatorCenter", "center LoadingButton loadingPosition classes");
    await expectCount(page, ".MuiLoadingButton-root.MuiLoadingButton-loading.MuiLoadingButton-loadingPositionStart .MuiLoadingButton-loadingIndicator.MuiLoadingButton-loadingIndicatorStart", "start LoadingButton loadingPosition classes");
    await expectCount(page, ".MuiLoadingButton-root.MuiLoadingButton-loading.MuiLoadingButton-loadingPositionEnd .MuiLoadingButton-loadingIndicator.MuiLoadingButton-loadingIndicatorEnd", "end LoadingButton loadingPosition classes");

    const cssVarsProvider = page.locator(".MuiCssVarsProvider-root.MuiCssVarsProvider-modeDark", { hasText: "CSS vars provider" }).first();
    if ((await cssVarsProvider.count()) === 0) throw new Error("CssVarsProvider did not render dark provider root");
    if ((await cssVarsProvider.getAttribute("data-mui-default-mode")) !== "system") {
      throw new Error("CssVarsProvider defaultMode data attribute did not match system");
    }

    const experimentalCssVarsProvider = page.locator(".MuiCssVarsProvider-root.MuiCssVarsProvider-modeDark", { hasText: "Experimental CSS vars provider" }).first();
    if ((await experimentalCssVarsProvider.count()) === 0) throw new Error("Experimental_CssVarsProvider did not render through MuiCssVarsProvider");
    if ((await experimentalCssVarsProvider.getAttribute("data-mui-default-mode")) !== "system") {
      throw new Error("Experimental_CssVarsProvider defaultMode did not pass through to MuiCssVarsProvider");
    }
    const experimentalInitScript = experimentalCssVarsProvider.locator(".MuiInitColorSchemeScript-root.MuiInitColorSchemeScript-modeDark.MuiInitColorSchemeScript-colorSchemeDark").first();
    if ((await experimentalInitScript.count()) === 0) throw new Error("Experimental_CssVarsProvider did not propagate mode/colorScheme to InitColorSchemeScript");
    if ((await experimentalInitScript.getAttribute("data-mui-default-mode")) !== "system") {
      throw new Error("Experimental_CssVarsProvider did not propagate defaultMode to InitColorSchemeScript");
    }

    const cssBaseline = page.locator(".MuiCssBaseline-root.MuiCssBaseline-enableColorScheme.MuiCssBaseline-modeDark.MuiCssBaseline-colorSchemeDark").first();
    if ((await cssBaseline.count()) === 0) throw new Error("CssBaseline did not inherit dark theme state");
    if ((await cssBaseline.getAttribute("data-mui-color-scheme")) !== "dark") {
      throw new Error("CssBaseline color-scheme data attribute did not inherit dark");
    }
    if ((await cssBaseline.getAttribute("data-mui-mode")) !== "dark") {
      throw new Error("CssBaseline mode data attribute did not inherit dark");
    }

    const scopedBaseline = page.locator(".MuiScopedCssBaseline-root.MuiScopedCssBaseline-enableColorScheme.MuiScopedCssBaseline-modeDark.MuiScopedCssBaseline-colorSchemeDark", { hasText: "Scoped baseline inherits dark mode" }).first();
    if ((await scopedBaseline.count()) === 0) throw new Error("ScopedCssBaseline did not inherit dark theme state");
    if ((await scopedBaseline.getAttribute("data-mui-color-scheme")) !== "dark") {
      throw new Error("ScopedCssBaseline color-scheme data attribute did not inherit dark");
    }
    if ((await scopedBaseline.getAttribute("data-mui-mode")) !== "dark") {
      throw new Error("ScopedCssBaseline mode data attribute did not inherit dark");
    }

    const initScript = page.locator(".MuiInitColorSchemeScript-root.MuiInitColorSchemeScript-modeDark.MuiInitColorSchemeScript-colorSchemeDark").first();
    if ((await initScript.count()) === 0) throw new Error("InitColorSchemeScript did not inherit dark theme state");
    if ((await initScript.getAttribute("data-mui-color-scheme")) !== "dark") {
      throw new Error("InitColorSchemeScript color-scheme data attribute did not inherit dark");
    }
    if ((await initScript.getAttribute("data-mui-mode")) !== "dark") {
      throw new Error("InitColorSchemeScript mode data attribute did not inherit dark");
    }
    if ((await initScript.getAttribute("data-mui-default-mode")) !== "system") {
      throw new Error("InitColorSchemeScript defaultMode data attribute did not inherit system");
    }
    if ((await initScript.getAttribute("data-mui-attribute")) !== "data-mui-color-scheme") {
      throw new Error("InitColorSchemeScript attribute default was not initialized");
    }

    await expectCount(page, ".mui-theme-provider-nested-defaults .MuiButton-root.MuiButton-colorSecondary", "theme default secondary button");
    await expectCount(page, ".mui-theme-provider-nested-defaults .MuiButton-root.MuiButton-colorPrimary", "explicit primary button override");
    await expectCount(page, ".mui-theme-provider-nested-defaults .MuiIconify-root.MuiIconify-colorSecondary", "theme default secondary iconify");
    await expectCount(page, ".MuiStack-root.MuiStack-directionRow.MuiStack-spacing2.MuiStack-useFlexGap.mui-stack-owner-state", "responsive Stack ownerState classes");
    await expectCount(page, ".mui-progress-smoke .MuiCircularProgress-root.MuiCircularProgress-determinate.MuiCircularProgress-colorInherit[role='progressbar'][data-variant='determinate'][data-value='72'][data-size='48'][data-thickness='6']", "determinate CircularProgress data contract");
    await expectCount(page, ".mui-progress-smoke .MuiLinearProgress-root.MuiLinearProgress-determinate.MuiLinearProgress-colorSecondary[role='progressbar'][data-variant='determinate'][data-value='64']", "determinate LinearProgress data contract");
    await expectCount(page, ".mui-progress-smoke .MuiLinearProgress-root.MuiLinearProgress-buffer[role='progressbar'][data-variant='buffer'][data-value='32'][data-value-buffer='68']", "buffer LinearProgress data contract");
    await expectCount(page, ".mui-progress-smoke .MuiSkeleton-root.MuiSkeleton-rounded.MuiSkeleton-wave[data-variant='rounded'][data-animation='wave'][data-width='96'][data-height='28']", "rounded Skeleton data contract");
    await expectCount(page, ".mui-image-list-smoke .MuiImageList-root.MuiImageList-woven[data-cols='4'][data-gap='6'][data-row-height='180']", "woven ImageList data contract");
    await expectCount(page, ".mui-image-list-smoke .MuiImageListItem-root.MuiImageListItem-woven[data-cols='2'][data-rows='2']", "woven ImageListItem data contract");
    await expectCount(page, ".mui-image-list-smoke .MuiImageListItemBar-root.MuiImageListItemBar-positionTop.MuiImageListItemBar-actionPositionLeft", "ImageListItemBar ownerState classes");
    await expectCount(page, ".mui-image-list-smoke .MuiImageListItemBar-title", "ImageListItemBar title slot");
    await expectCount(page, ".mui-image-list-smoke .MuiImageListItemBar-subtitle", "ImageListItemBar subtitle slot");
    await expectCount(page, ".mui-image-list-smoke .MuiImageListItemBar-actionIcon", "ImageListItemBar actionIcon slot");
    if ((await page.locator(".mui-image-list-smoke .MuiImageListItemBar-title", { hasText: "Theme image title" }).count()) === 0) {
      throw new Error("ImageListItemBar title slot did not render title text");
    }
    if ((await page.locator(".mui-image-list-smoke .MuiImageListItemBar-subtitle", { hasText: "Theme image subtitle" }).count()) === 0) {
      throw new Error("ImageListItemBar subtitle slot did not render subtitle text");
    }
    if ((await page.locator(".mui-image-list-smoke .MuiImageListItemBar-actionIcon", { hasText: "Open" }).count()) === 0) {
      throw new Error("ImageListItemBar actionIcon slot did not render action text");
    }
    await expectCount(page, ".mui-material-icon-smoke .MuiSvgIcon-root.MuiSvgIcon-colorPrimary", "AddIcon wrapper smoke");
    await expectCount(page, ".mui-material-icon-smoke .MuiSvgIcon-root.MuiSvgIcon-colorSecondary", "ShoppingCartIcon wrapper smoke");
    await expectCount(page, ".mui-material-icon-smoke .MuiSvgIcon-root.MuiSvgIcon-colorSuccess", "DoneAllIcon wrapper smoke");
    await expectCount(page, ".MuiTabContext-root[data-value='overview'] .MuiTabPanel-root[data-value='overview']", "explicit TabPanel data-value");
    await expectCount(page, ".MuiTabContext-root[data-value='settings'] .MuiTabs-root.MuiTabs-vertical", "vertical TabList orientation propagation");
    await expectCount(page, ".MuiTabContext-root[data-value='settings'] .MuiTabPanel-root.MuiTabPanel-keepMounted[data-value='settings']", "inherited TabPanel context value");

    const tree = page.locator(".mui-treeview-smoke .MuiTreeView-root.MuiSimpleTreeView-root.MuiTreeView-multiSelect.MuiSimpleTreeView-disabledItemsFocusable[role='tree'][aria-label='Theme navigation']").first();
    if ((await tree.count()) === 0) throw new Error("missing SimpleTreeView role/classes/aria-label smoke");
    if ((await tree.getAttribute("aria-multiselectable")) !== "true") throw new Error("SimpleTreeView did not emit aria-multiselectable true");
    if ((await tree.getAttribute("data-expanded-items")) !== "root,reports") throw new Error("SimpleTreeView did not preserve expandedItems data attribute");
    if ((await tree.getAttribute("data-selected-items")) !== "reports") throw new Error("SimpleTreeView did not preserve selectedItems data attribute");
    await expectCount(page, ".mui-treeview-smoke .MuiTreeItem-root.Mui-expanded[data-node-id='root'][aria-expanded='true'][aria-level='1'] .MuiTreeItem-label", "expanded TreeItem label");
    await expectCount(page, ".mui-treeview-smoke .MuiTreeItem-root.Mui-selected[data-node-id='reports'][aria-selected='true'][aria-level='2'] .MuiTreeItem-content.Mui-selected", "selected TreeItem state classes");
    await expectCount(page, ".mui-treeview-smoke .MuiTreeItem-root.Mui-disabled[data-node-id='archive'][aria-disabled='true'][aria-level='2'] .MuiTreeItem-content.Mui-disabled", "disabled TreeItem state classes");

    const rootClassChecks = [
      [".mui-root-classname-smoke .MuiButton-root.MuiButton-contained.custom-root-button", "Classed button"],
      [".mui-root-classname-smoke .MuiButtonGroup-root.MuiButtonGroup-colorSecondary.custom-root-button-group", "Classed button group"],
      [".mui-root-classname-smoke .MuiPaper-root.MuiPaper-elevation3.custom-root-paper", "Classed paper"],
      [".mui-root-classname-smoke .MuiCard-root.MuiPaper-elevation8.custom-root-card", "Classed card"],
      [".mui-root-classname-smoke .MuiTypography-root.MuiTypography-h6.custom-root-typography", "Classed typography"],
      [".mui-root-classname-smoke .MuiLink-root.MuiLink-underlineAlways.custom-root-link", "Classed link"],
      [".mui-root-classname-smoke .MuiIconButton-root.MuiIconButton-colorSecondary.custom-root-icon-button", "Classed icon button"],
      [".mui-root-classname-smoke .MuiFab-root.MuiFab-secondary.custom-root-fab", "Fab"],
      [".mui-root-classname-smoke .MuiChip-root.MuiChip-colorSecondary.custom-root-chip", "Classed chip"],
      [".mui-root-classname-smoke .MuiBadge-root.custom-root-badge", "Classed badge"],
      [".mui-root-classname-smoke .MuiAlert-root.MuiAlert-colorWarning.custom-root-alert", "Classed alert"],
    ];
    for (const [selector, text] of rootClassChecks) {
      await expectCount(page, selector, `root className merge for ${text}`);
    }
    if ((await page.locator(".custom-root-link").first().getAttribute("href")) !== "#classed-link") {
      throw new Error("classed Link did not preserve href prop");
    }

    const clickAwayPanel = page.locator(".mui-click-away-panel").first();
    if ((await clickAwayPanel.count()) === 0) throw new Error("missing click-away smoke panel");
    if (!(await clickAwayPanel.isVisible())) throw new Error("click-away smoke panel was hidden before outside click");
    await page.mouse.click(24, 24);
    await page.waitForTimeout(100);
    if (await clickAwayPanel.isVisible()) throw new Error("click-away smoke panel did not hide on outside click");
    await expectCount(page, ".mui-click-away-status.mui-click-away-closed", "click-away close status");

    const slotClassChecks = [
      [".mui-slot-class-smoke .MuiMenu-root.custom-menu-root.custom-menu-root-slot", "Menu root slot classes"],
      [".mui-slot-class-smoke .MuiMenu-paper.custom-menu-paper.custom-menu-paper-slot", "Menu paper slot classes"],
      [".mui-slot-class-smoke .MuiMenu-list.custom-menu-list.custom-menu-list-slot", "Menu list slot classes"],
      [".mui-slot-class-smoke .MuiDialog-root.custom-dialog-root.custom-dialog-root-slot", "Dialog root slot classes"],
      [".mui-slot-class-smoke .MuiDialog-backdrop.custom-dialog-backdrop", "Dialog backdrop classes"],
      [".mui-slot-class-smoke .MuiDialog-container.custom-dialog-container", "Dialog container classes"],
      [".mui-slot-class-smoke .MuiDialog-paper.custom-dialog-paper.custom-dialog-paper-slot", "Dialog paper slot classes"],
      [".mui-slot-class-smoke .MuiSlider-root.custom-slider-root", "Slider root classes"],
      [".mui-slot-class-smoke .MuiSlider-track.custom-slider-track.custom-slider-track-slot", "Slider track slot classes"],
      [".mui-slot-class-smoke .MuiSlider-thumb.custom-slider-thumb.custom-slider-thumb-slot", "Slider thumb slot classes"],
      [".mui-slot-class-smoke .MuiSlider-input.custom-slider-input", "Slider input classes"],
      [".mui-slot-class-smoke .MuiTooltip-popper.custom-tooltip-popper.custom-tooltip-popper-slot", "Tooltip popper slot classes"],
      [".mui-slot-class-smoke .MuiTooltip-tooltip.custom-tooltip-body.custom-tooltip-body-slot", "Tooltip tooltip slot classes"],
      [".mui-slot-class-smoke .MuiTooltip-arrow.custom-tooltip-arrow.custom-tooltip-arrow-slot", "Tooltip arrow slot classes"],
      [".mui-slot-class-smoke .MuiAutocomplete-root.custom-autocomplete-root", "Autocomplete root classes"],
      [".mui-slot-class-smoke .MuiAutocomplete-inputRoot.custom-autocomplete-input-root", "Autocomplete inputRoot classes"],
      [".mui-slot-class-smoke .MuiAutocomplete-input.custom-autocomplete-input.custom-autocomplete-input-slot", "Autocomplete input slot classes"],
      [".mui-slot-class-smoke .MuiAutocomplete-popupIndicator.custom-autocomplete-popup", "Autocomplete popupIndicator classes"],
      [".mui-slot-class-smoke .MuiAutocomplete-popper.custom-autocomplete-popper.custom-autocomplete-popper-slot", "Autocomplete popper slot classes"],
      [".mui-slot-class-smoke .MuiAutocomplete-paper.custom-autocomplete-paper", "Autocomplete paper classes"],
      [".mui-slot-class-smoke .MuiAutocomplete-listbox.custom-autocomplete-listbox.custom-autocomplete-listbox-slot", "Autocomplete listbox slot classes"],
      [".mui-slot-class-smoke .MuiRating-root.custom-rating-root.custom-rating-root-slot", "Rating root slot classes"],
      [".mui-slot-class-smoke .MuiRating-label.custom-rating-label", "Rating label classes"],
      [".mui-slot-class-smoke .MuiRating-icon.custom-rating-icon.custom-rating-icon-slot", "Rating icon slot classes"],
      [".mui-slot-class-smoke .MuiRating-iconFilled.custom-rating-icon-filled", "Rating filled icon classes"],
      [".mui-slot-class-smoke .MuiRating-iconEmpty.custom-rating-icon-empty", "Rating empty icon classes"],
      [".mui-slot-class-smoke .MuiAlert-root.MuiAlert-outlined.MuiAlert-colorInfo.MuiAlert-outlinedInfo[role='status']", "Alert outlined info root classes"],
      [".mui-slot-class-smoke .MuiAlert-icon.custom-alert-icon.custom-alert-icon-slot", "Alert icon slot classes"],
      [".mui-slot-class-smoke .MuiAlert-message.custom-alert-message.custom-alert-message-slot", "Alert message slot classes"],
      [".mui-slot-class-smoke .MuiAlert-action.custom-alert-action.custom-alert-action-slot", "Alert action slot classes"],
      [".mui-slot-class-smoke .MuiSnackbarContent-root.custom-snackbar-root.custom-snackbar-root-slot[role='status']", "SnackbarContent root slot classes"],
      [".mui-slot-class-smoke .MuiSnackbarContent-message.custom-snackbar-message.custom-snackbar-message-slot", "SnackbarContent message slot classes"],
      [".mui-slot-class-smoke .MuiSnackbarContent-action.custom-snackbar-action.custom-snackbar-action-slot", "SnackbarContent action slot classes"],
      [".mui-slot-class-smoke .MuiBreadcrumbs-root.custom-breadcrumb-root.custom-breadcrumb-root-class.custom-breadcrumb-root-slot[aria-label='Theme breadcrumb']", "Breadcrumbs root slot classes"],
      [".mui-slot-class-smoke .MuiBreadcrumbs-ol.custom-breadcrumb-ol.custom-breadcrumb-ol-slot", "Breadcrumbs ol slot classes"],
      [".mui-slot-class-smoke .MuiPagination-root.custom-pagination-root.custom-pagination-root-class.custom-pagination-root-slot[aria-label='Theme pages']", "Pagination root slot classes"],
      [".mui-slot-class-smoke .MuiPagination-ul.custom-pagination-ul.custom-pagination-ul-slot", "Pagination ul slot classes"],
      [".mui-slot-class-smoke .MuiPaginationItem-root.custom-pagination-item.custom-pagination-item-root.custom-pagination-item-root-slot", "PaginationItem root slot classes"],
      [".mui-slot-class-smoke .MuiPaginationItem-icon.custom-pagination-icon.custom-pagination-icon-slot", "PaginationItem icon slot classes"],
      [".mui-slot-class-smoke .MuiBottomNavigation-root.custom-bottom-navigation-root.custom-bottom-navigation-root-class.custom-bottom-navigation-root-slot", "BottomNavigation root slot classes"],
      [".mui-slot-class-smoke .MuiBottomNavigationAction-root.custom-bottom-action-root.custom-bottom-action-root-slot", "BottomNavigationAction root slot classes"],
      [".mui-slot-class-smoke .MuiBottomNavigationAction-label.custom-bottom-action-label.custom-bottom-action-label-slot", "BottomNavigationAction label slot classes"],
    ];
    for (const [selector, label] of slotClassChecks) {
      await expectCount(page, selector, label);
    }
    const slotAutocomplete = page.locator(".mui-slot-class-smoke .MuiAutocomplete-root.custom-autocomplete-root[data-open='1'][data-full-width='0'][data-disable-portal='0'][data-disabled='0'][data-read-only='0'][data-input-value='Option'][data-placeholder='Search']", { hasText: "Option one" }).first();
    if ((await slotAutocomplete.count()) === 0) throw new Error("missing Autocomplete DOM data contract in slot smoke");
    if ((await slotAutocomplete.locator(".MuiAutocomplete-popper.custom-autocomplete-popper.custom-autocomplete-popper-slot[data-autocomplete-open='1'][data-autocomplete-disable-portal='0']").count()) === 0) {
      throw new Error("missing Autocomplete popper DOM data contract in slot smoke");
    }
    if ((await page.locator(".mui-slot-class-smoke .MuiPaginationItem-root.MuiPaginationItem-sizeSmall.MuiPaginationItem-outlined.MuiPaginationItem-rounded.MuiPaginationItem-colorSecondary", { hasText: "Theme inherited page" }).count()) === 0) {
      throw new Error("PaginationItem did not inherit Pagination color/size/shape/variant defaults");
    }
    if ((await page.locator(".mui-slot-class-smoke .MuiPaginationItem-root.MuiPaginationItem-sizeSmall.MuiPaginationItem-text.MuiPaginationItem-circular.MuiPaginationItem-colorSecondary", { hasText: "Theme explicit page" }).count()) === 0) {
      throw new Error("PaginationItem explicit shape/variant did not override inherited Pagination defaults");
    }
    const inheritedBottomAction = page.locator(".mui-slot-class-smoke .MuiBottomNavigationAction-root", { hasText: "Theme parent label" }).first();
    if ((await inheritedBottomAction.count()) === 0) throw new Error("missing BottomNavigation showLabels inherited action");
    if (await inheritedBottomAction.evaluate((node) => node.classList.contains("MuiBottomNavigationAction-iconOnly"))) {
      throw new Error("BottomNavigationAction inherited showLabels still emitted root iconOnly");
    }
    if (await inheritedBottomAction.locator(".MuiBottomNavigationAction-label").first().evaluate((node) => node.classList.contains("MuiBottomNavigationAction-iconOnly"))) {
      throw new Error("BottomNavigationAction inherited showLabels still emitted label iconOnly");
    }
    const selectedBottomAction = page.locator(".mui-slot-class-smoke .MuiBottomNavigationAction-root.Mui-selected", { hasText: "Theme selected label" }).first();
    if ((await selectedBottomAction.count()) === 0) throw new Error("missing selected BottomNavigationAction smoke");
    if (await selectedBottomAction.evaluate((node) => node.classList.contains("MuiBottomNavigationAction-iconOnly"))) {
      throw new Error("selected BottomNavigationAction still emitted root iconOnly");
    }
    const disabledBottomAction = page.locator(".mui-slot-class-smoke .MuiBottomNavigationAction-root.Mui-disabled", { hasText: "Theme disabled label" }).first();
    if ((await disabledBottomAction.count()) === 0) throw new Error("missing disabled BottomNavigationAction smoke");
    if (!(await disabledBottomAction.evaluate((node) => node instanceof HTMLButtonElement && node.disabled))) {
      throw new Error("disabled BottomNavigationAction did not set native disabled");
    }
    const tablePagination = page.locator(".mui-slot-class-smoke .MuiTablePagination-root.custom-table-pagination-root.custom-table-pagination-root-class.custom-table-pagination-root-slot", { hasText: "Theme classed pagination" }).first();
    if ((await tablePagination.count()) === 0) throw new Error("missing classed TablePagination root target");
    if ((await tablePagination.locator(".MuiTablePagination-toolbar.custom-table-pagination-toolbar.custom-table-pagination-toolbar-slot").count()) === 0) throw new Error("TablePagination did not merge toolbar slot classes");
    if ((await tablePagination.locator(".MuiTablePagination-spacer.custom-table-pagination-spacer.custom-table-pagination-spacer-slot").count()) === 0) throw new Error("TablePagination did not merge spacer slot classes");
    if ((await tablePagination.locator(".MuiTablePagination-selectLabel.custom-table-pagination-select-label.custom-table-pagination-select-label-slot", { hasText: "Rows per page:" }).count()) === 0) throw new Error("TablePagination did not merge selectLabel slot classes");
    if ((await tablePagination.locator(".MuiTablePagination-input.MuiTablePagination-selectRoot.custom-table-pagination-input.custom-table-pagination-select-root.custom-table-pagination-input-slot.custom-table-pagination-select-root-slot").count()) === 0) throw new Error("TablePagination did not merge input/selectRoot slot classes");
    if ((await tablePagination.locator(".MuiTablePagination-select.custom-table-pagination-select.custom-table-pagination-select-slot").count()) === 0) throw new Error("TablePagination did not merge select slot classes");
    if ((await tablePagination.locator(".MuiTablePagination-selectIcon.custom-table-pagination-select-icon.custom-table-pagination-select-icon-slot").count()) === 0) throw new Error("TablePagination did not merge selectIcon slot classes");
    if ((await tablePagination.locator(".MuiTablePagination-displayedRows.custom-table-pagination-displayed-rows.custom-table-pagination-displayed-rows-slot", { hasText: "0-0 of 0" }).count()) === 0) throw new Error("TablePagination did not merge displayedRows slot classes");
    if ((await tablePagination.locator(".MuiTablePagination-actions.custom-table-pagination-actions.custom-table-pagination-actions-slot").count()) === 0) throw new Error("TablePagination did not merge actions slot classes");

    const classedPaginationActions = page.locator(".mui-slot-class-smoke .MuiTablePaginationActions-root.custom-table-pagination-actions-root.custom-table-pagination-actions-root-class.custom-table-pagination-actions-root-slot", { hasText: "Theme classed pagination actions" }).first();
    if ((await classedPaginationActions.count()) === 0) throw new Error("missing classed TablePaginationActions root target");
    if ((await classedPaginationActions.locator(".MuiIconButton-root.custom-table-pagination-first-button.custom-table-pagination-first-button-slot").count()) === 0) throw new Error("TablePaginationActions did not merge first button classes");
    if ((await classedPaginationActions.locator(".MuiSvgIcon-root.custom-table-pagination-first-button-icon.custom-table-pagination-first-button-icon-slot").count()) === 0) throw new Error("TablePaginationActions did not merge first button icon classes");
    if ((await classedPaginationActions.locator(".MuiIconButton-root.custom-table-pagination-previous-button.custom-table-pagination-previous-button-slot").count()) === 0) throw new Error("TablePaginationActions did not merge previous button classes");
    if ((await classedPaginationActions.locator(".MuiSvgIcon-root.custom-table-pagination-previous-button-icon.custom-table-pagination-previous-button-icon-slot").count()) === 0) throw new Error("TablePaginationActions did not merge previous button icon classes");
    if ((await classedPaginationActions.locator(".MuiIconButton-root.custom-table-pagination-next-button.custom-table-pagination-next-button-slot").count()) === 0) throw new Error("TablePaginationActions did not merge next button classes");
    if ((await classedPaginationActions.locator(".MuiSvgIcon-root.custom-table-pagination-next-button-icon.custom-table-pagination-next-button-icon-slot").count()) === 0) throw new Error("TablePaginationActions did not merge next button icon classes");
    if ((await classedPaginationActions.locator(".MuiIconButton-root.custom-table-pagination-last-button.custom-table-pagination-last-button-slot").count()) === 0) throw new Error("TablePaginationActions did not merge last button classes");
    if ((await classedPaginationActions.locator(".MuiSvgIcon-root.custom-table-pagination-last-button-icon.custom-table-pagination-last-button-icon-slot").count()) === 0) throw new Error("TablePaginationActions did not merge last button icon classes");
    const visibleThemePaginationActionButtons = await classedPaginationActions
      .locator(".MuiIconButton-root")
      .evaluateAll((nodes) => nodes.filter((node) => !node.hidden).map((node) => node.getAttribute("aria-label")));
    if (!visibleThemePaginationActionButtons.includes("Go to first page")) throw new Error("focused TablePaginationActions did not show the first page button when showFirstButton is set");
    if (!visibleThemePaginationActionButtons.includes("Go to last page")) throw new Error("focused TablePaginationActions did not show the last page button when showLastButton is set");
    if ((await page.locator(".mui-slot-class-smoke .MuiAlert-action", { hasText: "Retry" }).count()) === 0) {
      throw new Error("Alert action slot did not render action text");
    }
    if ((await page.locator(".mui-slot-class-smoke .MuiSnackbarContent-message", { hasText: "Slot snackbar message" }).count()) === 0) {
      throw new Error("SnackbarContent message slot did not render message prop");
    }
    if ((await page.locator(".mui-slot-class-smoke .MuiSnackbarContent-action", { hasText: "Dismiss" }).count()) === 0) {
      throw new Error("SnackbarContent action slot did not render action prop");
    }

    const indeterminateCheckbox = page.locator(".mui-switchbase-prop-smoke .MuiCheckbox-root.MuiCheckbox-indeterminate", { hasText: "Theme indeterminate checkbox" }).first();
    if ((await indeterminateCheckbox.count()) === 0) throw new Error("missing focused indeterminate Checkbox state");
    const indeterminateInput = indeterminateCheckbox.locator("input[type='checkbox']").first();
    if ((await indeterminateInput.getAttribute("data-indeterminate")) !== "true") throw new Error("focused Checkbox did not emit data-indeterminate=true");
    if (!(await indeterminateInput.evaluate((node) => node.required))) throw new Error("focused Checkbox did not set input.required");
    if ((await indeterminateInput.getAttribute("name")) !== "themeConsent") throw new Error("focused Checkbox did not preserve name prop");
    if ((await indeterminateInput.getAttribute("value")) !== "partial") throw new Error("focused Checkbox did not preserve value prop");

    const namedRadio = page.locator(".mui-switchbase-prop-smoke .MuiRadio-root", { hasText: "Theme named required radio" }).first();
    const namedRadioInput = namedRadio.locator("input[type='radio']").first();
    if (!(await namedRadioInput.evaluate((node) => node.required))) throw new Error("focused Radio did not set input.required");
    if ((await namedRadioInput.getAttribute("name")) !== "themeChoice") throw new Error("focused Radio did not preserve name prop");
    if ((await namedRadioInput.getAttribute("value")) !== "named") throw new Error("focused Radio did not preserve value prop");

    const edgeStartSwitch = page.locator(".mui-switchbase-prop-smoke .MuiSwitch-root.MuiSwitch-edgeStart", { hasText: "Theme edge start switch" }).first();
    if ((await edgeStartSwitch.count()) === 0) throw new Error("missing focused Switch edgeStart state");
    const edgeStartSwitchInput = edgeStartSwitch.locator("input[type='checkbox']").first();
    if (!(await edgeStartSwitchInput.evaluate((node) => node.required))) throw new Error("focused Switch did not set input.required");
    if ((await edgeStartSwitchInput.getAttribute("name")) !== "themeNotifications") throw new Error("focused Switch did not preserve name prop");
    if ((await edgeStartSwitchInput.getAttribute("value")) !== "enabled") throw new Error("focused Switch did not preserve value prop");
    await expectCount(page, ".mui-switchbase-prop-smoke .MuiSwitch-root.MuiSwitch-edgeEnd", "focused Switch edgeEnd state");

    const openCollapse = page.locator(".mui-collapse-smoke .MuiCollapse-root.MuiCollapse-vertical.MuiCollapse-entered", { hasText: "Open vertical collapse" }).first();
    if ((await openCollapse.count()) === 0) throw new Error("missing open Collapse ownerState classes");
    if ((await openCollapse.getAttribute("aria-hidden")) !== "false") throw new Error("open Collapse did not set aria-hidden=false");
    if ((await openCollapse.getAttribute("data-state")) !== "entered") throw new Error("open Collapse did not set entered data state");

    const closedCollapse = page.locator(".mui-collapse-smoke .MuiCollapse-root.MuiCollapse-vertical.MuiCollapse-hidden", { hasText: "Closed vertical collapse" }).first();
    if ((await closedCollapse.count()) === 0) throw new Error("missing closed vertical Collapse ownerState classes");
    if ((await closedCollapse.getAttribute("aria-hidden")) !== "true") throw new Error("closed vertical Collapse did not set aria-hidden=true");
    if ((await closedCollapse.getAttribute("data-state")) !== "exited") throw new Error("closed vertical Collapse did not set exited data state");
    if ((await closedCollapse.getAttribute("data-collapsed-size")) !== "0px") throw new Error("closed vertical Collapse lost default collapsedSize");
    if ((await closedCollapse.getAttribute("data-collapse-axis")) !== "height") throw new Error("closed vertical Collapse did not set height axis data");

    const closedHorizontalCollapse = page.locator(".mui-collapse-smoke .MuiCollapse-root.MuiCollapse-horizontal", { hasText: "Closed horizontal collapse" }).first();
    if ((await closedHorizontalCollapse.count()) === 0) throw new Error("missing horizontal Collapse ownerState classes");
    if ((await closedHorizontalCollapse.getAttribute("aria-hidden")) !== "true") throw new Error("closed horizontal Collapse did not set aria-hidden=true");
    if ((await closedHorizontalCollapse.getAttribute("data-state")) !== "exited") throw new Error("closed horizontal Collapse did not set exited data state");
    if ((await closedHorizontalCollapse.getAttribute("data-collapsed-size")) !== "12px") throw new Error("closed horizontal Collapse did not preserve collapsedSize");
    if ((await closedHorizontalCollapse.getAttribute("data-collapse-axis")) !== "width") throw new Error("closed horizontal Collapse did not set width axis data");
    if ((await closedHorizontalCollapse.locator(".MuiCollapse-wrapper.MuiCollapse-horizontal").count()) === 0) throw new Error("horizontal Collapse wrapper lost orientation class");
    if ((await closedHorizontalCollapse.locator(".MuiCollapse-wrapperInner.MuiCollapse-horizontal").count()) === 0) throw new Error("horizontal Collapse wrapperInner lost orientation class");

    const cardHeader = page.locator(".mui-text-slot-smoke .MuiCardHeader-root", { hasText: "Theme card title" }).first();
    if ((await cardHeader.locator(".MuiCardHeader-title.MuiTypography-root.MuiTypography-h5", { hasText: "Theme card title" }).count()) === 0) {
      throw new Error("CardHeader title did not render through Typography title slot");
    }
    if ((await cardHeader.locator(".MuiCardHeader-subheader.MuiTypography-root.MuiTypography-body1", { hasText: "Theme card subheader" }).count()) === 0) {
      throw new Error("CardHeader subheader did not render through Typography subheader slot");
    }
    const plainCardHeader = page.locator(".mui-text-slot-smoke .MuiCardHeader-root", { hasText: "Plain theme card title" }).first();
    if ((await plainCardHeader.count()) === 0) throw new Error("missing disableTypography CardHeader target");
    if ((await plainCardHeader.locator(".MuiCardHeader-title.MuiTypography-root").count()) !== 0) {
      throw new Error("disableTypography CardHeader title still emitted Typography class");
    }
    if ((await plainCardHeader.locator(".MuiCardHeader-subheader.MuiTypography-root").count()) !== 0) {
      throw new Error("disableTypography CardHeader subheader still emitted Typography class");
    }

    const imageMedia = page.locator(".mui-text-slot-smoke .MuiCardMedia-root.MuiCardMedia-img", { hasText: "Theme image media" }).first();
    if ((await imageMedia.count()) === 0) throw new Error("missing focused CardMedia image ownerState class");
    if ((await imageMedia.getAttribute("data-image")) !== "assets/mui_demo_cover.webp") {
      throw new Error("focused CardMedia did not preserve image prop as data-image");
    }
    if ((await imageMedia.getAttribute("data-component")) !== "div") {
      throw new Error("focused CardMedia default component data attribute was not div");
    }
    const imgMedia = page.locator(".mui-text-slot-smoke .MuiCardMedia-root.MuiCardMedia-media.MuiCardMedia-img", { hasText: "Theme img media" }).first();
    if ((await imgMedia.count()) === 0) throw new Error("missing focused CardMedia component=img media/img classes");
    if ((await imgMedia.getAttribute("data-component")) !== "img") throw new Error("focused CardMedia did not preserve component=img");
    if ((await imgMedia.getAttribute("data-src")) !== "assets/mui_demo_inline.webp") throw new Error("focused CardMedia did not preserve src prop as data-src");

    const imageAvatar = page.locator(".mui-text-slot-smoke .MuiAvatar-root", { hasText: "Theme image avatar" }).first();
    if ((await imageAvatar.count()) === 0) throw new Error("missing focused image Avatar target");
    if (await imageAvatar.evaluate((node) => node.classList.contains("MuiAvatar-colorDefault"))) {
      throw new Error("image Avatar still emitted colorDefault ownerState class");
    }
    const avatarImg = imageAvatar.locator("img.MuiAvatar-img:not(.MuiAvatar-imgHidden)").first();
    if ((await avatarImg.count()) === 0) throw new Error("image Avatar did not render visible MuiAvatar-img slot");
    if ((await avatarImg.getAttribute("alt")) !== "Theme avatar") throw new Error("image Avatar did not preserve alt prop");
    if ((await avatarImg.getAttribute("src")) !== "assets/mui_demo_avatar.webp") throw new Error("image Avatar did not preserve src prop");
    if ((await avatarImg.getAttribute("srcset")) !== "assets/mui_demo_avatar@2x.webp 2x") throw new Error("image Avatar did not preserve srcSet prop");

    const avatarGroup = page.locator(".mui-text-slot-smoke .MuiAvatarGroup-root.custom-avatar-group.custom-avatar-group-root.custom-avatar-group-slot", { hasText: "Inherited rounded avatar" }).first();
    if ((await avatarGroup.count()) === 0) throw new Error("missing AvatarGroup root class/slot class merge target");
    if ((await avatarGroup.locator(".MuiAvatar-root.MuiAvatar-rounded", { hasText: "Inherited rounded avatar" }).count()) === 0) {
      throw new Error("AvatarGroup did not project variant context to child Avatar");
    }
    if ((await avatarGroup.locator(".MuiAvatar-root.MuiAvatar-square", { hasText: "Explicit square avatar" }).count()) === 0) {
      throw new Error("explicit Avatar variant did not override AvatarGroup variant context");
    }

    const listText = page.locator(".mui-text-slot-smoke .MuiListItemText-root", { hasText: "Theme list child" }).first();
    if ((await listText.locator(".MuiListItemText-primary.MuiTypography-root.MuiTypography-body1", { hasText: "Theme primary" }).count()) === 0) {
      throw new Error("ListItemText primary did not render through Typography primary slot");
    }
    if ((await listText.locator(".MuiListItemText-secondary.MuiTypography-root.MuiTypography-body2", { hasText: "Theme secondary" }).count()) === 0) {
      throw new Error("ListItemText secondary did not render through Typography secondary slot");
    }
    const plainListText = page.locator(".mui-text-slot-smoke .MuiListItemText-root", { hasText: "Plain theme primary" }).first();
    if ((await plainListText.count()) === 0) throw new Error("missing disableTypography ListItemText target");
    if ((await plainListText.locator(".MuiListItemText-primary.MuiTypography-root").count()) !== 0) {
      throw new Error("disableTypography ListItemText primary still emitted Typography class");
    }
    if ((await plainListText.locator(".MuiListItemText-secondary.MuiTypography-root").count()) !== 0) {
      throw new Error("disableTypography ListItemText secondary still emitted Typography class");
    }

    const closedModal = await expectOverlayState(page, ".mui-overlay-a11y-smoke .MuiModal-root:not(.MuiPopover-root):not(.MuiDrawer-root)", "Closed modal", { ariaHidden: "true", className: "Mui-hidden" });
    const openModal = await expectOverlayState(page, ".mui-overlay-a11y-smoke .MuiModal-root:not(.MuiPopover-root):not(.MuiDrawer-root)", "Open modal", { ariaHidden: "false", className: "Mui-open" });
    if ((await closedModal.getAttribute("data-open")) !== "0") throw new Error("closed Modal root did not preserve data-open=0");
    if ((await closedModal.getAttribute("data-hide-backdrop")) !== "0") throw new Error("closed Modal root did not preserve default data-hide-backdrop=0");
    if ((await closedModal.getAttribute("data-keep-mounted")) !== "0") throw new Error("closed Modal root did not preserve default data-keep-mounted=0");
    if ((await closedModal.getAttribute("data-disable-portal")) !== "0") throw new Error("closed Modal root did not preserve default data-disable-portal=0");
    if ((await closedModal.getAttribute("data-disable-scroll-lock")) !== "0") throw new Error("closed Modal root did not preserve default data-disable-scroll-lock=0");
    if ((await closedModal.getAttribute("data-close-after-transition")) !== "0") throw new Error("closed Modal root did not preserve default data-close-after-transition=0");
    if ((await closedModal.getAttribute("data-disable-auto-focus")) !== "0") throw new Error("closed Modal root did not preserve default data-disable-auto-focus=0");
    if ((await closedModal.getAttribute("data-disable-enforce-focus")) !== "0") throw new Error("closed Modal root did not preserve default data-disable-enforce-focus=0");
    if ((await closedModal.getAttribute("data-disable-restore-focus")) !== "0") throw new Error("closed Modal root did not preserve default data-disable-restore-focus=0");
    if ((await openModal.getAttribute("data-open")) !== "1") throw new Error("open Modal root did not preserve data-open=1");
    if ((await openModal.getAttribute("data-hide-backdrop")) !== "0") throw new Error("open Modal root did not preserve default data-hide-backdrop=0");
    if ((await openModal.getAttribute("data-keep-mounted")) !== "0") throw new Error("open Modal root did not preserve default data-keep-mounted=0");
    if ((await openModal.getAttribute("data-disable-portal")) !== "0") throw new Error("open Modal root did not preserve default data-disable-portal=0");
    if ((await openModal.getAttribute("data-disable-scroll-lock")) !== "0") throw new Error("open Modal root did not preserve default data-disable-scroll-lock=0");
    if ((await openModal.getAttribute("data-close-after-transition")) !== "0") throw new Error("open Modal root did not preserve default data-close-after-transition=0");
    if ((await openModal.getAttribute("data-disable-auto-focus")) !== "0") throw new Error("open Modal root did not preserve default data-disable-auto-focus=0");
    if ((await openModal.getAttribute("data-disable-enforce-focus")) !== "0") throw new Error("open Modal root did not preserve default data-disable-enforce-focus=0");
    if ((await openModal.getAttribute("data-disable-restore-focus")) !== "0") throw new Error("open Modal root did not preserve default data-disable-restore-focus=0");
    const closedPopover = await expectOverlayState(page, ".mui-overlay-a11y-smoke .MuiPopover-root:not(.MuiMenu-root)", "Closed popover", { ariaHidden: "true", className: "Mui-hidden" });
    const openPopover = await expectOverlayState(page, ".mui-overlay-a11y-smoke .MuiPopover-root:not(.MuiMenu-root)", "Open popover", { ariaHidden: "false", className: "Mui-open" });
    if ((await closedPopover.getAttribute("data-open")) !== "0") throw new Error("closed Popover root did not preserve data-open=0");
    if ((await closedPopover.getAttribute("data-anchor-origin-vertical")) !== "top") throw new Error("closed Popover root did not preserve default vertical anchor origin");
    if ((await closedPopover.getAttribute("data-anchor-origin-horizontal")) !== "left") throw new Error("closed Popover root did not preserve default horizontal anchor origin");
    if ((await closedPopover.getAttribute("data-transform-origin-vertical")) !== "top") throw new Error("closed Popover root did not preserve default vertical transform origin");
    if ((await closedPopover.getAttribute("data-transform-origin-horizontal")) !== "left") throw new Error("closed Popover root did not preserve default horizontal transform origin");
    if ((await openPopover.getAttribute("data-open")) !== "1") throw new Error("open Popover root did not preserve data-open=1");
    if ((await openPopover.getAttribute("data-anchor-origin-vertical")) !== "top") throw new Error("open Popover root did not preserve default vertical anchor origin");
    if ((await openPopover.getAttribute("data-anchor-origin-horizontal")) !== "left") throw new Error("open Popover root did not preserve default horizontal anchor origin");
    if ((await openPopover.getAttribute("data-transform-origin-vertical")) !== "top") throw new Error("open Popover root did not preserve default vertical transform origin");
    if ((await openPopover.getAttribute("data-transform-origin-horizontal")) !== "left") throw new Error("open Popover root did not preserve default horizontal transform origin");
    const closedPopper = await expectOverlayState(page, ".mui-overlay-a11y-smoke .MuiPopper-root", "Closed popper", { ariaHidden: "true", className: "Mui-hidden" });
    const openPopper = await expectOverlayState(page, ".mui-overlay-a11y-smoke .MuiPopper-root", "Open popper", { ariaHidden: "false", className: "Mui-open" });
    if ((await closedPopper.getAttribute("data-open")) !== "0") throw new Error("closed Popper root did not preserve data-open=0");
    if ((await closedPopper.getAttribute("data-placement")) !== "bottom") throw new Error("closed Popper root did not preserve default data-placement=bottom");
    if ((await openPopper.getAttribute("data-open")) !== "1") throw new Error("open Popper root did not preserve data-open=1");
    if ((await openPopper.getAttribute("data-placement")) !== "bottom") throw new Error("open Popper root did not preserve default data-placement=bottom");
    const closedMenu = await expectOverlayState(page, ".mui-overlay-a11y-smoke .MuiMenu-root", "Closed menu action", { ariaHidden: "true", className: "Mui-hidden" });
    const openMenu = await expectOverlayState(page, ".mui-overlay-a11y-smoke .MuiMenu-root", "Open menu action", { ariaHidden: "false", className: "Mui-open" });
    if ((await closedMenu.getAttribute("data-open")) !== "0") throw new Error("closed Menu root did not preserve data-open=0");
    if ((await closedMenu.getAttribute("data-anchor-origin-vertical")) !== "bottom") throw new Error("closed Menu root did not preserve default vertical anchor origin");
    if ((await closedMenu.getAttribute("data-anchor-origin-horizontal")) !== "left") throw new Error("closed Menu root did not preserve default horizontal anchor origin");
    if ((await closedMenu.getAttribute("data-transform-origin-vertical")) !== "top") throw new Error("closed Menu root did not preserve default vertical transform origin");
    if ((await closedMenu.getAttribute("data-transform-origin-horizontal")) !== "left") throw new Error("closed Menu root did not preserve default horizontal transform origin");
    if ((await openMenu.getAttribute("data-open")) !== "1") throw new Error("open Menu root did not preserve data-open=1");
    if ((await openMenu.getAttribute("data-anchor-origin-vertical")) !== "bottom") throw new Error("open Menu root did not preserve default vertical anchor origin");
    if ((await openMenu.getAttribute("data-anchor-origin-horizontal")) !== "left") throw new Error("open Menu root did not preserve default horizontal anchor origin");
    if ((await openMenu.getAttribute("data-transform-origin-vertical")) !== "top") throw new Error("open Menu root did not preserve default vertical transform origin");
    if ((await openMenu.getAttribute("data-transform-origin-horizontal")) !== "left") throw new Error("open Menu root did not preserve default horizontal transform origin");
    const closedDrawer = await expectOverlayState(page, ".mui-overlay-a11y-smoke .MuiDrawer-root", "Closed drawer", { ariaHidden: "true", className: "Mui-hidden" });
    const openDrawer = await expectOverlayState(page, ".mui-overlay-a11y-smoke .MuiDrawer-root", "Open drawer", { ariaHidden: "false", className: "Mui-open" });
    if ((await closedDrawer.getAttribute("data-open")) !== "0") throw new Error("closed Drawer root did not preserve data-open=0");
    if ((await closedDrawer.getAttribute("data-anchor")) !== "left") throw new Error("closed Drawer root did not preserve default data-anchor=left");
    if ((await closedDrawer.getAttribute("data-variant")) !== "temporary") throw new Error("closed Drawer root did not preserve default data-variant=temporary");
    if ((await closedDrawer.getAttribute("data-hide-backdrop")) !== "0") throw new Error("closed Drawer root did not preserve default data-hide-backdrop=0");
    if ((await openDrawer.getAttribute("data-open")) !== "1") throw new Error("open Drawer root did not preserve data-open=1");
    if ((await openDrawer.getAttribute("data-anchor")) !== "left") throw new Error("open Drawer root did not preserve default data-anchor=left");
    if ((await openDrawer.getAttribute("data-variant")) !== "temporary") throw new Error("open Drawer root did not preserve default data-variant=temporary");
    if ((await openDrawer.getAttribute("data-hide-backdrop")) !== "0") throw new Error("open Drawer root did not preserve default data-hide-backdrop=0");
    await expectNestedAttr(closedDrawer, ".MuiDrawer-paper", "aria-modal", "false", "closed drawer paper");
    await expectNestedAttr(openDrawer, ".MuiDrawer-paper", "aria-modal", "true", "open drawer paper");
    const closedSnackbar = await expectOverlayState(page, ".mui-overlay-a11y-smoke .MuiSnackbar-root", "Closed snackbar", { ariaHidden: "true", className: "Mui-hidden" });
    const openSnackbar = await expectOverlayState(page, ".mui-overlay-a11y-smoke .MuiSnackbar-root", "Open snackbar", { ariaHidden: "false", className: "Mui-open" });
    if ((await closedSnackbar.getAttribute("data-open")) !== "0") throw new Error("closed Snackbar root did not preserve data-open=0");
    if ((await closedSnackbar.getAttribute("data-anchor-origin-vertical")) !== "bottom") throw new Error("closed Snackbar root did not preserve default vertical anchor origin");
    if ((await closedSnackbar.getAttribute("data-anchor-origin-horizontal")) !== "left") throw new Error("closed Snackbar root did not preserve default horizontal anchor origin");
    if ((await openSnackbar.getAttribute("data-open")) !== "1") throw new Error("open Snackbar root did not preserve data-open=1");
    if ((await openSnackbar.getAttribute("data-anchor-origin-vertical")) !== "bottom") throw new Error("open Snackbar root did not preserve default vertical anchor origin");
    if ((await openSnackbar.getAttribute("data-anchor-origin-horizontal")) !== "left") throw new Error("open Snackbar root did not preserve default horizontal anchor origin");
    if ((await openSnackbar.locator(".MuiSnackbarContent-message", { hasText: "Open snackbar prop" }).count()) === 0) {
      throw new Error("Snackbar did not forward message prop to SnackbarContent");
    }
    if ((await openSnackbar.locator(".MuiSnackbarContent-action", { hasText: "Undo" }).count()) === 0) {
      throw new Error("Snackbar did not forward action prop to SnackbarContent");
    }
    const closedDialog = await expectOverlayState(page, ".mui-overlay-a11y-smoke .MuiDialog-root", "Closed dialog", { ariaHidden: "true", className: "Mui-hidden" });
    const openDialog = await expectOverlayState(page, ".mui-overlay-a11y-smoke .MuiDialog-root", "Open dialog", { ariaHidden: "false", className: "Mui-open" });
    if ((await closedDialog.getAttribute("data-open")) !== "0") throw new Error("closed dialog root did not preserve data-open=0");
    if ((await closedDialog.getAttribute("data-scroll")) !== "paper") throw new Error("closed dialog root did not preserve default data-scroll");
    if ((await closedDialog.getAttribute("data-max-width")) !== "sm") throw new Error("closed dialog root did not preserve default data-max-width");
    if ((await closedDialog.getAttribute("data-full-width")) !== "0") throw new Error("closed dialog root did not preserve default data-full-width=0");
    if ((await closedDialog.getAttribute("data-full-screen")) !== "0") throw new Error("closed dialog root did not preserve default data-full-screen=0");
    if ((await openDialog.getAttribute("data-open")) !== "1") throw new Error("open dialog root did not preserve data-open=1");
    if ((await openDialog.getAttribute("data-scroll")) !== "paper") throw new Error("open dialog root did not preserve default data-scroll");
    if ((await openDialog.getAttribute("data-max-width")) !== "sm") throw new Error("open dialog root did not preserve default data-max-width");
    if ((await openDialog.getAttribute("data-full-width")) !== "0") throw new Error("open dialog root did not preserve default data-full-width=0");
    if ((await openDialog.getAttribute("data-full-screen")) !== "0") throw new Error("open dialog root did not preserve default data-full-screen=0");
    await expectNestedAttr(openDialog, ".MuiDialog-container", "data-dialog-scroll", "paper", "open dialog container");
    await expectNestedAttr(openDialog, ".MuiDialog-paper", "data-dialog-max-width", "sm", "open dialog paper");
    await expectNestedAttr(openDialog, ".MuiDialog-paper", "data-dialog-full-width", "0", "open dialog paper");
    await expectNestedAttr(openDialog, ".MuiDialog-paper", "data-dialog-full-screen", "0", "open dialog paper");
    await expectNestedAttr(closedDialog, ".MuiDialog-paper", "aria-modal", "false", "closed dialog paper");
    await expectNestedAttr(openDialog, ".MuiDialog-paper", "aria-modal", "true", "open dialog paper");
    await expectNestedAttr(openDialog, ".MuiDialog-paper", "aria-labelledby", "smoke-dialog-title", "open dialog paper");
    await expectNestedAttr(openDialog, ".MuiDialog-paper", "aria-describedby", "smoke-dialog-description", "open dialog paper");
    await expectNestedAttr(openDialog, ".MuiDialogTitle-root", "id", "smoke-dialog-title", "open dialog title");
    await expectNestedAttr(openDialog, ".MuiDialogContentText-root", "id", "smoke-dialog-description", "open dialog description");

    console.log("MUI theme lab browser verification passed");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
