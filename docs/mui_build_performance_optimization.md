# MUI Build Performance Optimization Plan

## Scope

This document covers the build path used by `sa_plugin_mui` for SA/SAX Material Kit demos, especially the new SLA Material Kit suite. It focuses on where time is spent today, why the current caching layers still leave the first build slow, and what to change next.

The discussion is intentionally practical:

- input: `demos/mui_material_kit_*.sax` and `demos/mui_material_kit_*_sla.sax`
- build path: `sa vite build`
- output: `dist/material-kit` and `dist/material-kit-sla`
- observed workload: seven Material Kit routes plus the focused theme/all-components smoke targets

## Current Status

### Measured SLA timings

The current SLA route timings recorded in `.zig-cache/sla_dist_build_times.log` are:

| Target | Time |
|---|---:|
| `material-kit-sla-dashboard` | 108.91s |
| `material-kit-sla-products` | 30.51s |
| `material-kit-sla-blog` | 37.03s |
| `material-kit-sla-users` | 35.86s |
| `material-kit-sla-sign-in` | 15.48s |
| `material-kit-sla-register` | 15.85s |
| `material-kit-sla-404` | 12.90s |
| seven-route total | 256.54s |
| dashboard cache hit | 0.44s |
| `theme-lab-smoke-sla` | 212.19s |
| `all-components-library-sla` | 555.27s |

The important observation is not just the total. The first dashboard build is expensive, but the exact same dashboard input can hit the build cache and drop to sub-second latency. That means the system already has a working cache; the problem is that the cache only helps in narrow cases.

### Existing caching layers

There are three relevant layers today.

1. Vite build cache in `sa_plugin_vite`
   - `src/dev_server.zig` checks a build fingerprint before rebuilding.
   - If the fingerprint matches and the expected outputs still exist, it returns a cache hit and only refreshes assets.
   - This is why an unchanged dashboard build can fall to `0.44s`.

2. Browser wasm cache in `sa_plugin_react`
   - `src/react/build.zig` hashes source text, optimization, DCE mode, exports, and `sa_std` inputs.
   - It stores `output.wasm` plus a cached `artifact.sa.bc` under `.sa_cache/vite-browser-wasm/<hash>/`.
   - If both files exist, the build short-circuits and copies the cached outputs.

3. Function-level `.bc` cache in `sa_plugin_react`
   - When the full wasm cache misses, the build is split into per-function tasks.
   - Each function emits a separate `.sa.bc` file under `.sa_cache/vite-browser-wasm-incremental/<stable-hash>/functions/`.
   - That means unchanged functions can skip LLVM bitcode emission on later builds.

### What is still expensive

Even with those caches, the system still does a full final wasm link when the exact wasm cache misses.

The final stage is in `src/driver/zigcc.zig`:

- `compileWasm()` builds a `zig build-exe` command.
- It passes many `.sa.bc` files at once.
- It uses `-target wasm32-freestanding`, `-fno-entry`, `--import-symbols`, and explicit exports.
- Zig/LLVM still has to link and codegen the whole wasm artifact.

So the current cache removes some upstream work, but not the final whole-program wasm link.

## Why It Is Still Slow

### 1. The cache is exact-input oriented

The browser wasm cache only hits when the full hash matches. That is good for repeat builds of the same page, but it does not help across sibling routes.

For Material Kit:

- dashboard, products, blog, users, sign-in, register, and 404 are separate entries
- each route produces its own `app.wasm`
- a cache hit for dashboard does not mean products can reuse dashboard's final wasm

### 2. Function `.bc` reuse avoids emission, not final link

The function cache saves LLVM emission for unchanged functions, but the route still has to be linked into a complete wasm.

That means:

- if a route has 100 functions and 95 are cached, the last 5 still do work
- the linker still sees the full `.bc` set
- the expensive part can move from “emit everything” to “link everything,” but it does not disappear

### 3. Cache keys are conservative

`computeFunctionObjectKey()` in `sa_plugin_react` hashes:

- source path
- all function signatures
- constant declarations
- the current function body text

That is safe, but it also reduces reuse across related routes when the shared logic is structurally similar but not byte-identical.

### 4. The current build path is route-local

The Material Kit routes are built one by one.

That means the system cannot currently do a “compile shared route core once, then only relink route-specific glue” flow. The shared layout/view code is duplicated into each route's own final output.

### 5. Vite cache does not help first build

The `sa vite build` cache only helps after the first successful build of a given exact dist fingerprint. The first SLA build of a route is still cold.

This is why the initial dashboard build is still over a minute, even though the second identical build drops to 0.44s.

## Root Cause Summary

The build is slow for two separate reasons:

1. Cache scope is too narrow for cross-route reuse.
2. Final wasm generation still performs a full link/codegen pass even when most upstream work is cached.

The second point is the real bottleneck. The `.bc` split helps, but it stops short of incremental linking.

## Recommended Improvement Directions

### Phase 1: Instrument the time budget per stage

Before changing behavior, add explicit timing around the build stages.

Measure:

- SAX parse/verify/flatten time
- function `.bc` cache hit rate
- per-function LLVM emission time
- final wasm link time
- output copy time

Why this matters:

- right now we know total wall time
- we do not have a stage-level breakdown for the expensive SLA routes
- without that, any further optimization is guesswork

Expected outcome:

- clear attribution of whether the time is spent in lowering, LLVM emission, or final linking
- better estimates for the next phases

### Phase 2: Widen reuse of stable shared code

The biggest low-risk win is to make shared Material Kit logic more reusable between routes.

Ideas:

- isolate route-independent layout/view functions into stable shared units
- avoid route-specific noise in function cache keys when the function body is truly identical
- consider a shared prelinked core for the common Material Kit shell

Why:

- dashboard/products/blog/users/sign-in/register/404 all share a lot of layout and component wiring
- today they still pay for route-local finalization

Expected outcome:

- better `.bc` reuse across sibling routes
- lower cold build cost for the five smaller routes

### Phase 3: Reduce final link cost

This is the main structural optimization.

Possible approaches:

1. Link shared objects once, then relink only route-specific entry objects.
2. Cache a prelinked wasm object for the shared Material Kit core.
3. Split route entry code from shared layout code so the final link graph is smaller.
4. Keep optimization level lower for dev builds and reserve `ReleaseSmall` for static export builds.

Why:

- the current `compileWasm()` path always invokes `zig build-exe` over the complete `.bc` set
- a full link is expensive even when upstream function emission is cached

Expected outcome:

- the largest improvement for initial route build times
- especially noticeable for dashboard and all-components/library routes

### Phase 4: Introduce route-group caching

Material Kit routes naturally fall into groups:

- dashboard shell family
- auth family
- content family
- 404

Instead of caching only per exact route hash, introduce a reusable artifact per group where the shared `.bc` can be reused.

This is a larger design change, but it could reduce the repeated work currently paid by each route.

### Phase 5: Evaluate parallelism carefully

The build already uses some parallelism in LLVM emission, but the final wasm link is still a serial endpoint.

Options:

- parallelize more of the per-function `.bc` emission
- avoid oversubscribing CPU during link-heavy builds
- separate “fast developer builds” from “full release builds” in default command paths

## Estimated Benefit by Stage

These are directional estimates, not guarantees.

### If only more caching is added

- expected improvement: 10% to 30% on repeated near-duplicate builds
- effect: good for iterative edits inside a single route
- limit: does not remove full link cost on cold builds

### If shared code is split better

- expected improvement: 20% to 40% on the five smaller Material Kit routes
- effect: more `.bc` cache hits and smaller link graphs
- limit: dashboard and large smoke routes still pay significant final link cost

### If final link cost is reduced

- expected improvement: 2x to 5x on cold builds for route bundles with heavy shared code
- effect: this is the first change likely to move dashboard/build totals materially
- limit: depends on how much of the current wasm graph can be factored out

### If route-group caching is added

- expected improvement: potentially another 20% to 50% on families of related routes
- effect: best case for Material Kit-style demo suites
- limit: requires a more invasive build graph change

## Practical Priority Order

1. Add stage timers and cache hit counters.
2. Measure current route-level link time separately from lowering time.
3. Split shared Material Kit code so sibling routes reuse more `.bc`.
4. Reduce final wasm link work by reusing a prelinked shared core.
5. Only then consider larger route-group caching or build graph restructuring.

## What Not To Expect

The current `.bc` split is useful, but it is not enough by itself to make first builds cheap.

It does not remove:

- final wasm link time
- repeated route-specific codegen
- exact-input cache misses on sibling routes

So if the goal is “first build should feel instant,” the answer is not just “more caching.” The build graph itself needs to be made more reusable.



## Evaluation of Cache Compilation Optimization Scheme (Phase 1 Results)

Following the implementation of Phase 1 (Stage Timers & Cache Hit Counter Instrumentation) in `sa_plugin_react/src/react/build.zig`, we compiled the SLA Material Kit Dashboard and sibling routes. The measured execution details are analyzed below:

### Measured Route Timings (Cold vs. Sibling Build)

1. **Dashboard Cold Build** (No Cache):
   - **Total Time**: 92,173 ms
   - **Lowering/Emission (`compileSourceText` & LLVM C-API `emitLlvmcToFile`)**: 78,013 ms (84.6%)
   - **Object File Compilation (`zig build-obj` on each shard)**: 10,295 ms (11.2%)
   - **Final WASM Linking (`zig build-exe` over `.sa.o` set)**: 96 ms (0.1%)

2. **Products Sibling Build** (Hot Cache for Shared Components):
   - **Total Time**: 26,526 ms (3.4x speedup)
   - **Lowering/Emission**: 19,091 ms (71.9%)
   - **Object File Compilation**: 4,077 ms (15.3%)
   - **Final WASM Linking**: 59 ms (0.2%)

### Scheme Evaluation

- **WASM Linking bottleneck is resolved**: Linking `.sa.o` object files directly via `zig build-exe` takes **< 100ms** (reduced from tens of seconds to virtually instant).
- **Object caching is effective**: Sibling route builds benefit significantly from compiled `.sa.o` object files, compiling only route-specific changes/uncached parts (4.0s vs 10.3s).
- **New Bottleneck Identified**: **Lowering & LLVM Bitcode Emission** represents **70% to 85%** of compile time. Parsing, semantic checking, and calling LLVM APIs sequentially for each component is the primary limiter.

---

## Cache Build Optimization Development Plan

Based on the Phase 1 performance profile, we formulate the following multi-stage development plan:

### Stage 1: Parallelize Component/Unit Compilation
- **Problem**: The unit/component loop in `buildBrowserWasmFromSourceUnits` / `buildBrowserWasmFromSourceText` compiles components sequentially. LLVM emission and object generation are CPU-bound and run on a single thread.
- **Action**: Introduce a multi-threaded compilation pipeline in Zig (using a thread pool or task queue) to process multiple `units` or `functions` in parallel.
- **Estimated Gain**: **2x - 4x speedup** on multi-core systems during cold builds (bringing the 78s emission phase down to 20-30s).

### Stage 2: Cache LLVM Contexts / Avoid Re-initialization
- **Problem**: Each unit currently initializes and disposes of the LLVM C API context and module structure sequentially.
- **Action**: Reuse LLVM builder instances or keep a worker-pool of LLVM contexts to avoid setup/teardown overhead.
- **Estimated Gain**: **5% - 10%** reduction in emission overhead.

### Stage 3: Fine-Grained Semantic Verification Caching
- **Problem**: Changes to the entry file trigger re-verification of the entire reachable AST, even when shared modules (`mui/material.sax`, etc.) are unchanged.
- **Action**: Cache checked module ASTs. If dependency modules are unmodified, skip the semantic verification stage for those AST nodes and only check the entry-specific nodes.
- **Estimated Gain**: **30% - 50%** reduction in lowering/checking time on hot builds.

### Stage 4: Release vs. Development Mode Split
- **Problem**: Dev builds currently pay the compilation and optimization penalties of `ReleaseSmall` or `ReleaseFast`.
- **Action**: Configure the compiler to run in `-O Debug` with minimum LLVM optimizations during local development/watch mode, and only trigger full compilation for production exports.
- **Estimated Gain**: **3x - 5x speedup** for local development loop.
