# sa_plugin_mui

`sa_plugin_mui` is the SA/SAX Material UI component library for `sa_plugin_react`.

The implementation direction is SA-first: MUI components live in `mui/material.sax`, and React/SAX compilation should consume that source through an SA/SAX library mechanism. Zig in this plugin is limited to the plugin descriptor and installation of share assets; it must not implement MUI component behavior, theme logic, class generation, source rewriting, or CLI commands.

Upstream `/home/vscode/projects/material-ui` is a reference for the React model: default props resolve into owner state, slots, utility classes, theme tokens, and DOM output. It is not a runtime dependency, and this plugin must not call npm, Node MUI, React DOM, Emotion, or `@mui/material`.

## Current Use

The source library starts at `mui/material.sax`. Consume it through the generic React/SAX component source composition path. Components can declare slot-projected context defaults with `<Slot contextProps="..." />`; `sa_plugin_react` applies those defaults to user-component children before explicit props, matching the upstream MUI `default props -> ownerState -> slots` pattern without adding MUI logic to Zig. Current SA/SAX users of this path include ButtonGroup, ToggleButtonGroup, List/ListItem, and FormControl-style inherited defaults. For UI work, prefer `sa vite dev` so SAX, CSS, and public asset edits rebuild and refresh the browser without repeatedly producing a copied static dist by hand.

Local development plugin path:

```bash
export SA_PLUGINS_PATH=/home/vscode/projects/sa_plugins/sa_plugin_vite/zig-out/lib/libvite.so:/home/vscode/projects/sa_plugins/sa_plugin_http_server/zig-out/lib/libhttp-server.so:/home/vscode/projects/sa_plugins/sa_plugin_react/zig-out/lib/libreact.so:/home/vscode/projects/sa_plugins/sa_plugin_mui/zig-out/lib/libmui.so
```

Run the all-components dashboard with hot reload:

```bash
/home/vscode/projects/sci/zig-out/bin/sa vite dev demos/mui_dashboard.sax \
  --react \
  --include mui/material.sax \
  --out-dir .zig-cache/mui-dashboard-dev-dist \
  --port 5173 \
  --debounce-ms 60 \
  --title "SA MUI Component Dashboard" \
  --css assets/mui_dashboard.css
```

Run the Material Kit-inspired demo with hot reload and static assets from the upstream reference app:

```bash
/home/vscode/projects/sci/zig-out/bin/sa vite dev demos/mui_material_kit_demo.sax \
  --react \
  --include mui/material.sax \
  --include mui/icons_material.sax \
  --include mui/material_kit_layout.sax \
  --include mui/material_kit_views.sax \
  --out-dir .zig-cache/mui-material-kit-dev-dist \
  --port 5174 \
  --debounce-ms 60 \
  --title "SA Material Kit Demo" \
  --css assets/mui_material_kit_demo.css \
  --public-dir /home/vscode/projects/material-kit-react2/public
```

`sa_plugin_vite` watches the entry SAX tree, React includes, `--css`, and `--public-dir` inputs in dev mode. Successful rebuilds push a reload event to the browser; build errors show through the live client overlay.

For compile-only checks, use:

```bash
SA_PLUGINS_PATH=/home/vscode/projects/sa_plugins/sa_plugin_react/zig-out/lib/libreact.so:/home/vscode/projects/sa_plugins/sa_plugin_mui/zig-out/lib/libmui.so /home/vscode/projects/sci/zig-out/bin/sa react check demos/mui_all_components_from_library.sax --include mui/material.sax --include mui/icons_material.sax
SA_PLUGINS_PATH=/home/vscode/projects/sa_plugins/sa_plugin_react/zig-out/lib/libreact.so:/home/vscode/projects/sa_plugins/sa_plugin_mui/zig-out/lib/libmui.so /home/vscode/projects/sci/zig-out/bin/sa react check demos/mui_material_kit_demo.sax --include mui/material.sax --include mui/icons_material.sax --include mui/material_kit_layout.sax --include mui/material_kit_views.sax
SA_PLUGINS_PATH=/home/vscode/projects/sa_plugins/sa_plugin_react/zig-out/lib/libreact.so:/home/vscode/projects/sa_plugins/sa_plugin_mui/zig-out/lib/libmui.so /home/vscode/projects/sci/zig-out/bin/sa react check demos/mui_material_kit_404.sax --include mui/material.sax --include mui/icons_material.sax --include mui/material_kit_layout.sax --include mui/material_kit_views.sax
```

For static dist verification, build and browser-verify the same library-consumption path with:

```bash
SA_PLUGINS_PATH=/home/vscode/projects/sa_plugins/sa_plugin_react/zig-out/lib/libreact.so:/home/vscode/projects/sa_plugins/sa_plugin_mui/zig-out/lib/libmui.so /home/vscode/projects/sci/zig-out/bin/sa react build demos/mui_all_components_from_library.sax --include mui/material.sax --include mui/icons_material.sax --out-dir .zig-cache/mui-share-dist
node tools/verify_mui_browser.mjs .zig-cache/mui-share-dist
```

The Material Kit static suite currently includes seven SA/SAX routes under `dist/material-kit`: dashboard, products, blog, users, sign-in, register, and 404. The 404 route follows the upstream `NotFoundView` structure with a fixed logo, centered copy, `illustration-404.svg`, and a home `Link`/button action. Browser verification covers the route, `Link.href` output, and `Button.fullWidth` utility-class output on auth pages.

## Build Memory Notes

Large SA-MUI demos are expected to be compiled with the current SCI compiler memory fixes. Use `--mem-report` when investigating compile memory; text mode prints live RSS stages, while JSON mode exposes `metrics.memory.rss_bytes`, `metrics.memory.verifier_rss_bytes`, and `peak_rss_bytes` for scripts.

The previous default parallel verifier path could exceed 5 GiB RSS on the generated SA-MUI all-components workload because per-job arena allocation retained temporary verifier snapshots. Current SCI uses per-worker verifier allocators and releases worker-owned annotated results during merge. On the large MUI wasm sample, verifier memory now completes around 289 MiB after verify with a verifier merge peak around 402 MiB; the remaining process peak around 2.7 GiB is from the downstream Zig/LLVM wasm link stage.

For repeatable local checks, prefer the static/dev Vite paths in this README and keep Vite/React build cache enabled. Use `--no-incremental --mem-report` only for cold memory investigations.

`demos/mui_all_components_from_library.sax` directly instantiates all locked core Material components without inlining their definitions. The browser verifier checks that the generated bundle mounts representative MUI DOM classes in Chromium, including checked/disabled/selected ownerState output (`Mui-checked`, `Mui-disabled`, `Mui-selected`), Form/Input state classes such as `Mui-error`, `Mui-focused`, `Mui-required`, `Mui-readOnly`, `MuiInputBase-fullWidth`, and `MuiInputBase-multiline`, InputAdornment/Select classes such as `MuiInputAdornment-disablePointerEvents`, `MuiInputAdornment-hiddenLabel`, `MuiSelect-multiple`, `MuiSelect-iconOpen`, and `MuiNativeSelect-multiple`, form layout classes such as `MuiFormGroup-row`, `MuiRadioGroup-row`, and `MuiFormControlLabel-label.Mui-disabled`, Step/Accordion state classes such as `Mui-active`, `Mui-completed`, `Mui-expanded`, `MuiStepConnector-alternativeLabel`, `MuiStepper-alternativeLabel`, `MuiAccordion-rounded`, `MuiAccordion-gutters`, and `MuiAccordionSummary-gutters`, Table state classes such as `MuiTable-stickyHeader`, `MuiTableRow-hover`, and `MuiTableCell-stickyHeader`, List/Chip/Badge classes such as `MuiList-dense`, `MuiListItem-divider`, `MuiListSubheader-inset`, `MuiChip-clickable`, and `MuiBadge-invisible`, status component classes such as `MuiBackdrop-invisible`, `MuiRating-readOnly`, `MuiSlider-thumb.Mui-disabled`, and `MuiCircularProgress-circleDisableShrink`, navigation/overlay classes such as `MuiButtonGroup-fullWidth`, `MuiButtonGroup-colorSecondary`, inherited child `MuiButton-colorSecondary`, `MuiTabs-centered`, `MuiTab-fullWidth`, `MuiTab-wrapped`, `MuiToggleButtonGroup-fullWidth`, `MuiAutocomplete-fullWidth`, `MuiAutocomplete-popupIndicatorOpen`, `MuiAutocomplete-popperDisablePortal`, `MuiBottomNavigationAction-iconOnly`, `MuiSpeedDial-actionsClosed`, `MuiSpeedDialAction-fabClosed`, `MuiTooltip-popperArrow`, and `MuiTooltip-popperInteractive`, base surface/action classes such as `MuiTypography-noWrap`, `MuiTypography-gutterBottom`, `MuiToolbar-gutters`, `MuiPaper-rounded`, `MuiAccordionActions-spacing`, `MuiDialogActions-spacing`, and `MuiCardActions-spacing`, plus layout/dialog classes such as `MuiDialog-paperFullWidth`, `MuiDialog-paperFullScreen`, `MuiDialogContent-dividers`, `MuiContainer-fixed`, `MuiContainer-disableGutters`, `MuiDivider-absolute`, and `MuiDivider-flexItem`, all driven from SA/SAX state. The older inlined demos remain as verification baselines. Composition, share-asset resolution, React prop alias lowering, and slot context prop projection are generic React/SAX behavior in `sa_plugin_react`; this plugin still must not add a Zig source expander or CLI command.

## Scope

The v1 component inventory is locked to default component exports from `@mui/material/src/index.js`, excluding hooks and helpers. Lab-like SAX components live in `mui/material.sax`; the first pure SAX material icon wrappers live in `mui/icons_material.sax` and depend on the same SA `SvgIcon` surface.
