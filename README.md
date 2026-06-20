# sa_plugin_mui

`sa_plugin_mui` is the SA/SAX Material UI component library for `sa_plugin_react`.

The implementation direction is SA-first: MUI components live in `mui/material.sax`, and React/SAX compilation should consume that source through an SA/SAX library mechanism. Zig in this plugin is limited to the plugin descriptor and installation of share assets; it must not implement MUI component behavior, theme logic, class generation, source rewriting, or CLI commands.

Upstream `/home/vscode/projects/material-ui` is a reference for the React model: default props resolve into owner state, slots, utility classes, theme tokens, and DOM output. It is not a runtime dependency, and this plugin must not call npm, Node MUI, React DOM, Emotion, or `@mui/material`.

## Current Use

The source library starts at `mui/material.sax`. Consume it through the generic React/SAX component source composition path. Components can declare slot-projected context defaults with `<Slot contextProps="..." />`; `sa_plugin_react` applies those defaults to user-component children before explicit props, matching the upstream MUI `default props -> ownerState -> slots` pattern without adding MUI logic to Zig. Current SA/SAX users of this path include ButtonGroup, ToggleButtonGroup, List/ListItem, and FormControl-style inherited defaults. ThemeProvider/CssVarsProvider now opt into `<Slot contextProps="color colorScheme defaultMode mode" contextScope="descendants" />` so default theme state can cross transparent layout wrappers while explicit child props still win. The same generic React/SAX path recognizes provider-wrapped slots such as `<MuiCssVarsProvider><Slot /></MuiCssVarsProvider>`, so wrapper components like `Experimental_CssVarsProvider` project theme context to their children without MUI-specific compiler logic. For UI work, prefer `sa vite dev` so SAX, CSS, and public asset edits rebuild and refresh the browser without repeatedly producing a copied static dist by hand.

Local development plugin path:

```bash
export SA_PLUGIN_DEV=1
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
SA_PLUGIN_DEV=1 SA_PLUGINS_PATH=/home/vscode/projects/sa_plugins/sa_plugin_react/zig-out/lib/libreact.so:/home/vscode/projects/sa_plugins/sa_plugin_mui/zig-out/lib/libmui.so /home/vscode/projects/sci/zig-out/bin/sa react check demos/mui_all_components_from_library.sax --include mui/material.sax --include mui/icons_material.sax
SA_PLUGIN_DEV=1 SA_PLUGINS_PATH=/home/vscode/projects/sa_plugins/sa_plugin_react/zig-out/lib/libreact.so:/home/vscode/projects/sa_plugins/sa_plugin_mui/zig-out/lib/libmui.so /home/vscode/projects/sci/zig-out/bin/sa react check demos/mui_material_kit_demo.sax --include mui/material.sax --include mui/icons_material.sax --include mui/material_kit_layout.sax --include mui/material_kit_views.sax
SA_PLUGIN_DEV=1 SA_PLUGINS_PATH=/home/vscode/projects/sa_plugins/sa_plugin_react/zig-out/lib/libreact.so:/home/vscode/projects/sa_plugins/sa_plugin_mui/zig-out/lib/libmui.so /home/vscode/projects/sci/zig-out/bin/sa react check demos/mui_material_kit_404.sax --include mui/material.sax --include mui/icons_material.sax --include mui/material_kit_layout.sax --include mui/material_kit_views.sax
```

Every MUI demo also has a same-name Sla handler entry ending in `_sla.sax`. Demos without event handlers are copied as Sla-compatible baselines; demos with SA label handlers have equivalent `fn handler() { ... }` logic. Components with Sla handlers rely on SAX destroy-time state cleanup and omit explicit `!state_name` release lines. Material Kit's reusable handler logic is mirrored in `mui/material_kit_layout_sla.sax` and `mui/material_kit_views_sla.sax`; the original SA files remain unchanged.

Compile the Sla demo set with:

```bash
export SA_PLUGIN_DEV=1
export SA_PLUGINS_PATH=/home/vscode/projects/sa_plugins/sa_plugin_react/zig-out/lib/libreact.so:/home/vscode/projects/sa_plugins/sa_plugin_mui/zig-out/lib/libmui.so
/home/vscode/projects/sci/zig-out/bin/sa react check demos/mui_basic_inlined_sla.sax
/home/vscode/projects/sci/zig-out/bin/sa react check demos/mui_all_components_sla.sax
/home/vscode/projects/sci/zig-out/bin/sa react check demos/mui_all_components_from_library_sla.sax --include mui/material.sax --include mui/icons_material.sax
/home/vscode/projects/sci/zig-out/bin/sa react check demos/mui_icons_smoke_sla.sax --include mui/material.sax --include mui/icons_material.sax
/home/vscode/projects/sci/zig-out/bin/sa react check demos/mui_table_pagination_repro_sla.sax --include mui/material.sax --include mui/icons_material.sax
/home/vscode/projects/sci/zig-out/bin/sa react check demos/mui_dashboard_sla.sax --include mui/material.sax --include mui/icons_material.sax
/home/vscode/projects/sci/zig-out/bin/sa react check demos/mui_theme_lab_smoke_sla.sax --include mui/material.sax --include mui/icons_material.sax
/home/vscode/projects/sci/zig-out/bin/sa react check demos/mui_material_kit_demo_sla.sax --include mui/material.sax --include mui/icons_material.sax --include mui/material_kit_layout_sla.sax --include mui/material_kit_views_sla.sax
```

For all seven Sla Material Kit routes, repeat the last command with `demos/mui_material_kit_products_sla.sax`, `demos/mui_material_kit_blog_sla.sax`, `demos/mui_material_kit_users_sla.sax`, `demos/mui_material_kit_sign_in_sla.sax`, `demos/mui_material_kit_register_sla.sax`, and `demos/mui_material_kit_404_sla.sax`.

Build and browser-verify the focused Sla smoke target with a screenshot:

```bash
npm ci
SA_PLUGIN_DEV=1 SA_PLUGINS_PATH=/home/vscode/projects/sa_plugins/sa_plugin_react/zig-out/lib/libreact.so:/home/vscode/projects/sa_plugins/sa_plugin_mui/zig-out/lib/libmui.so \
  /home/vscode/projects/sci/zig-out/bin/sa react build demos/mui_theme_lab_smoke_sla.sax --include mui/material.sax --include mui/icons_material.sax --out-dir dist/theme-lab-smoke-sla
MUI_BROWSER_EXECUTABLE=/home/vscode/.local/bin/chromium \
MUI_BROWSER_SCREENSHOT=$PWD/dist/theme-lab-smoke-sla/theme_lab_sla_chromium.png \
  node tools/verify_mui_theme_lab_browser.mjs dist/theme-lab-smoke-sla
```

When `sa_plugin_vite` is available, build the Sla Material Kit static suite with `sa vite build` using the same commands as the SA suite but replacing the entry files with `_sla.sax`, the includes with `mui/material_kit_layout_sla.sax` and `mui/material_kit_views_sla.sax`, and the output root with `dist/material-kit-sla`. The root `index.html` keeps the original SA links and adds the Sla links under `Sla Material Kit Navigation`. The browser verifier can be run against a static server:

```bash
python3 -m http.server 4177 --bind 127.0.0.1
MUI_BROWSER_EXECUTABLE=/home/vscode/.local/bin/chromium \
MUI_BROWSER_SCREENSHOT=$PWD/dist/material-kit-sla/material_kit_sla_chromium.png \
  node tools/verify_mui_material_kit_browser.mjs http://127.0.0.1:4177/dist/material-kit-sla/index.html
```

For static dist verification, build and browser-verify the same library-consumption path with:

```bash
SA_PLUGIN_DEV=1 SA_PLUGINS_PATH=/home/vscode/projects/sa_plugins/sa_plugin_react/zig-out/lib/libreact.so:/home/vscode/projects/sa_plugins/sa_plugin_mui/zig-out/lib/libmui.so /home/vscode/projects/sci/zig-out/bin/sa react build demos/mui_all_components_from_library.sax --include mui/material.sax --include mui/icons_material.sax --out-dir .zig-cache/mui-share-dist
node tools/verify_mui_browser.mjs .zig-cache/mui-share-dist
```

For the focused TablePagination/TablePaginationActions repro, use:

```bash
SA_PLUGIN_DEV=1 SA_PLUGINS_PATH=/home/vscode/projects/sa_plugins/sa_plugin_react/zig-out/lib/libreact.so:/home/vscode/projects/sa_plugins/sa_plugin_mui/zig-out/lib/libmui.so /home/vscode/projects/sci/zig-out/bin/sa react build demos/mui_table_pagination_repro.sax --include mui/material.sax --include mui/icons_material.sax --out-dir .zig-cache/mui-table-pagination-repro-dist
node tools/verify_mui_table_pagination_repro.mjs .zig-cache/mui-table-pagination-repro-dist
```

For a focused theme/default-prop smoke check that stays below the current full-demo memory envelope, use:

```bash
SA_PLUGIN_DEV=1 SA_PLUGINS_PATH=/home/vscode/projects/sa_plugins/sa_plugin_react/zig-out/lib/libreact.so:/home/vscode/projects/sa_plugins/sa_plugin_mui/zig-out/lib/libmui.so /home/vscode/projects/sci/zig-out/bin/sa react check demos/mui_theme_lab_smoke.sax --include mui/material.sax --include mui/icons_material.sax
SA_PLUGIN_DEV=1 SA_PLUGINS_PATH=/home/vscode/projects/sa_plugins/sa_plugin_react/zig-out/lib/libreact.so:/home/vscode/projects/sa_plugins/sa_plugin_mui/zig-out/lib/libmui.so /home/vscode/projects/sci/zig-out/bin/sa react build demos/mui_theme_lab_smoke.sax --include mui/material.sax --include mui/icons_material.sax --out-dir .zig-cache/mui-theme-lab-smoke
node tools/verify_mui_theme_lab_browser.mjs .zig-cache/mui-theme-lab-smoke
```

This check verifies real `data-mui-color-scheme`, `data-mui-mode`, and `data-mui-default-color` output plus inherited ThemeProvider color defaults through a nested wrapper. It also verifies theme mode/colorScheme/defaultMode consumption by CssBaseline, ScopedCssBaseline, InitColorSchemeScript, and the provider-wrapped `Experimental_CssVarsProvider` path. The same focused browser check covers the current overlay accessibility slice: Modal, Popover, Popper, Menu, Drawer, Snackbar, and Dialog reflect `open` into `Mui-open`/`Mui-hidden`, `aria-hidden`, and modal paper `aria-modal` where applicable. Dialog also accepts upstream-style `aria-labelledby` and `aria-describedby` props and forwards them to the dialog paper while DialogTitle/DialogContentText expose `id`. It checks root `className` merging for common root-slot components including Button, ButtonGroup, Paper, Card, Typography, Link, IconButton, Fab, Chip, Badge, Alert, Breadcrumbs, Pagination, PaginationItem, BottomNavigation, BottomNavigationAction, and AvatarGroup, checks static `classes={{ ... }}` plus `slotProps={{ slot: { className: ... } }}` projection for Menu, Dialog, Slider, Tooltip, Autocomplete, Rating, Alert, SnackbarContent, Breadcrumbs root/ol slots, Pagination root/ul slots, PaginationItem root/icon slots, BottomNavigation root slot, BottomNavigationAction root/label slots, and AvatarGroup root slots, checks Alert role/action/icon/message slots plus `color || severity` variant-color utility classes, checks Snackbar/SnackbarContent message/action/role forwarding, checks Pagination default-prop projection to child PaginationItem with explicit child overrides, checks BottomNavigation `showLabels` projection to actions plus selected/disabled action ownerState, checks AvatarGroup variant context projection to child Avatar while explicit child variants still win, checks SimpleTreeView/TreeItem role, ARIA, data attributes, and expanded/selected/disabled utility classes, checks SwitchBase-family input prop reflection for Checkbox indeterminate/name/value/required, Radio name/value/required, and Switch edge/name/value/required, checks CardHeader/ListItemText text slots including `disableTypography` class removal, checks the SAX-expressible CardMedia `image`/`src`/`component` class/data-attribute subset, and checks Avatar image-slot `src`/`srcSet`/`alt` plus `colorDefault` ownerState removal for image avatars. It is not a replacement for the full all-components dashboard; it is the narrow regression target for the current theme/default-props, class/slot className, Alert/SnackbarContent slot-action, Breadcrumbs/Pagination/BottomNavigation navigation slots, overlay semantics, Lab tree-view/SwitchBase, text-slot, CardMedia, and Avatar/AvatarGroup slices.

The Material Kit static suite currently includes seven SA/SAX routes under `dist/material-kit`: dashboard, products, blog, users, sign-in, register, and 404. The 404 route follows the upstream `NotFoundView` structure with a fixed logo, centered copy, `illustration-404.svg`, and a home `Link`/button action. Browser verification covers the route, `Link.href` output, and `Button.fullWidth` utility-class output on auth pages.

Lab-like coverage currently includes SA/SAX `LoadingButton`, Timeline, Masonry, `TabContext`/`TabList`/`TabPanel`, SimpleTreeView/TreeItem, and SpeedDial-family components. `TabContext` projects its `value` through the generic React/SAX slot context path, `TabList` forwards orientation to `Tabs`, and `TabPanel` reflects the effective value through `data-value` for focused verification. SimpleTreeView/TreeItem expose the SAX-expressible subset of the MUI/X tree model: role/ARIA/data attributes and ownerState utility classes for multi-select, disabled-item focusability, disableSelection, expanded, selected, and disabled states.

## Build Memory Notes

Large SA-MUI demos are expected to be compiled with the current SCI compiler memory fixes. Use `--mem-report` when investigating compile memory; text mode prints live RSS stages, while JSON mode exposes `metrics.memory.rss_bytes`, `metrics.memory.verifier_rss_bytes`, and `peak_rss_bytes` for scripts.

The previous default parallel verifier path could exceed 5 GiB RSS on the generated SA-MUI all-components workload because per-job arena allocation retained temporary verifier snapshots. Current SCI uses per-worker verifier allocators and releases worker-owned annotated results during merge. On the large MUI wasm sample, verifier memory now completes around 289 MiB after verify with a verifier merge peak around 402 MiB; the remaining process peak around 2.7 GiB is from the downstream Zig/LLVM wasm link stage.

For repeatable local checks, prefer the static/dev Vite paths in this README and keep Vite/React build cache enabled. Use `--no-incremental --mem-report` only for cold memory investigations. On the current 8 GiB development host, a direct `sa react check demos/mui_all_components_from_library.sax --include mui/material.sax --include mui/icons_material.sax` can still be killed under memory pressure; the 2026-06-14 focused TreeView slice saw SIGKILL after 1:29.88 at 6,302,540 KB RSS while swap was nearly full. Use the focused smoke target above when other compile threads may also be active. If builds fail late with `NoSpaceLeft`, inspect this repository's ignored `.sa_cache/` and `.zig-cache/`; stale `vite-browser-wasm-incremental` entries are safe to prune and will be rebuilt on demand.

`demos/mui_all_components_from_library.sax` directly instantiates all locked core Material components without inlining their definitions. The browser verifier checks that the generated bundle mounts representative MUI DOM classes in Chromium, including checked/disabled/selected ownerState output (`Mui-checked`, `Mui-disabled`, `Mui-selected`), Alert classes and slots such as `MuiAlert-standardSuccess`, `MuiAlert-filledWarning`, `MuiAlert-outlinedInfo`, `MuiAlert-icon`, `MuiAlert-message`, `MuiAlert-action`, role forwarding, and icon hiding, SnackbarContent message/action/role slots and Snackbar prop forwarding, Breadcrumbs root `aria-label` plus custom root/ol slot classes, Pagination root/ul slot classes and PaginationItem inherited color/size/shape/variant plus icon slot classes, BottomNavigation `showLabels` projection, selected action iconOnly removal, disabled action native button output, and custom root/label slot classes, AvatarGroup variant context projection to Avatar children, SwitchBase-family classes and input props such as `MuiCheckbox-indeterminate`, `data-indeterminate`, `MuiSwitch-edgeStart`, `MuiSwitch-edgeEnd`, `name`, `value`, and `required`, text-slot classes and text projection such as `MuiCardHeader-title`, `MuiCardHeader-subheader`, `MuiListItemText-primary`, `MuiListItemText-secondary`, and `disableTypography` omission of `MuiTypography-root`, media ownerState output such as `MuiCardMedia-media`, `MuiCardMedia-img`, `data-image`, `data-src`, and `data-component`, Avatar image-slot output such as `MuiAvatar-img`, `src`, `srcset`, `alt`, and image-avatar omission of `MuiAvatar-colorDefault`, Form/Input state classes such as `Mui-error`, `Mui-focused`, `Mui-required`, `Mui-readOnly`, `MuiInputBase-fullWidth`, and `MuiInputBase-multiline`, InputAdornment/Select classes such as `MuiInputAdornment-disablePointerEvents`, `MuiInputAdornment-hiddenLabel`, `MuiSelect-multiple`, `MuiSelect-iconOpen`, and `MuiNativeSelect-multiple`, form layout classes such as `MuiFormGroup-row`, `MuiRadioGroup-row`, and `MuiFormControlLabel-label.Mui-disabled`, Step/Accordion state classes such as `Mui-active`, `Mui-completed`, `Mui-expanded`, `MuiStepConnector-alternativeLabel`, `MuiStepper-alternativeLabel`, `MuiAccordion-rounded`, `MuiAccordion-gutters`, and `MuiAccordionSummary-gutters`, Table state classes such as `MuiTable-stickyHeader`, `MuiTableRow-hover`, and `MuiTableCell-stickyHeader`, List/Chip/Badge classes such as `MuiList-dense`, `MuiListItem-divider`, `MuiListSubheader-inset`, `MuiChip-clickable`, and `MuiBadge-invisible`, status component classes such as `MuiBackdrop-invisible`, `MuiRating-readOnly`, `MuiSlider-thumb.Mui-disabled`, `MuiCircularProgress-circleDisableShrink`, `MuiLoadingButton-loadingPositionStart`, and `MuiLoadingButton-loadingPositionEnd`, navigation/overlay classes such as `MuiButtonGroup-fullWidth`, `MuiButtonGroup-colorSecondary`, inherited child `MuiButton-colorSecondary`, `MuiTabs-centered`, `MuiTab-fullWidth`, `MuiTab-wrapped`, `MuiToggleButtonGroup-fullWidth`, `MuiAutocomplete-fullWidth`, `MuiAutocomplete-popupIndicatorOpen`, `MuiAutocomplete-popperDisablePortal`, `MuiBottomNavigationAction-iconOnly`, `MuiSpeedDial-actionsClosed`, `MuiSpeedDialAction-fabClosed`, `MuiTooltip-popperArrow`, and `MuiTooltip-popperInteractive`, base surface/action classes such as `MuiTypography-noWrap`, `MuiTypography-gutterBottom`, `MuiToolbar-gutters`, `MuiPaper-rounded`, `MuiAccordionActions-spacing`, `MuiDialogActions-spacing`, and `MuiCardActions-spacing`, plus layout/dialog/tree classes such as `MuiStack-directionRow`, `MuiStack-spacing2`, `MuiStack-useFlexGap`, `MuiTreeView-multiSelect`, `MuiTreeView-disableSelection`, `MuiSimpleTreeView-disabledItemsFocusable`, `MuiTreeItem-root.Mui-expanded`, `MuiTreeItem-root.Mui-selected`, `MuiDialog-paperFullWidth`, `MuiDialog-paperFullScreen`, `MuiDialogContent-dividers`, `MuiContainer-fixed`, `MuiContainer-disableGutters`, `MuiDivider-absolute`, and `MuiDivider-flexItem`, all driven from SA/SAX state. The older inlined demos remain as verification baselines. Composition, share-asset resolution, React prop alias lowering, and slot context prop projection are generic React/SAX behavior in `sa_plugin_react`; this plugin still must not add a Zig source expander or CLI command.

## Scope

The v1 component inventory is locked to default component exports from `@mui/material/src/index.js`, excluding hooks and helpers. Lab-like SAX components live in `mui/material.sax`; pure SAX material icon wrappers live in `mui/icons_material.sax` and depend on the same SA `SvgIcon` surface. The icon set currently covers dashboard/navigation and Material Kit-adjacent actions such as search, notifications, account, dashboard, people, shopping bag/cart, article, menu, close, settings, status, expand/language/more/filter, edit/delete, logout/home, visibility, add, done-all, share, restart, arrow-forward, and access-time.

Current `className` support is incremental. Common root-slot components merge the incoming root `className` after generated utility classes. Static MUI object props are also projected by `sa_plugin_react`: `classes={{ root: "...", paper: "..." }}` maps to declared SAX states such as `classesRoot`/`classesPaper`, and `slotProps={{ paper: { className: "..." } }}` maps to states such as `slotPropsPaperClassName`; `componentsProps` is accepted as the same alias. Dynamic object values, custom slot component replacement, styled-engine overrides, theme `styleOverrides`, transition orchestration, portals, focus traps, and full keyboard/a11y behavior remain follow-up work.
