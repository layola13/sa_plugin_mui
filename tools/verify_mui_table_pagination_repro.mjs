import { access, readFile, readdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const playwrightCacheDir = path.join(process.env.HOME ?? "", ".cache", "ms-playwright");

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
        server.close();
        reject(new Error("failed to bind static server"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}/index.html` });
    });
  });
}

async function main() {
  const rootDir = process.argv[2];
  if (!rootDir) throw new Error("usage: node tools/verify_mui_table_pagination_repro.mjs <dist-dir>");

  const { server, url } = await startStaticServer(rootDir);
  const executablePath = await resolveChromiumExecutablePath();
  const browser = await chromium.launch({ headless: true, executablePath: executablePath ?? undefined });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForSelector(".MuiTablePaginationActions-root", { timeout: 10000 });

    const classedPagination = page.locator(".MuiPagination-root.repro-pagination-root.repro-pagination-root-class.repro-pagination-root-slot").first();
    if ((await classedPagination.count()) === 0) throw new Error("missing repro Pagination root");
    const visibleFirstLastCount = await classedPagination
      .locator(".MuiPaginationItem-root.MuiPaginationItem-firstLast")
      .evaluateAll((nodes) => nodes.filter((node) => !node.hidden).length);
    if (visibleFirstLastCount !== 2) throw new Error(`Pagination expected 2 visible first/last items, got ${visibleFirstLastCount}`);
    const visiblePreviousNextCount = await classedPagination
      .locator(".MuiPaginationItem-root.MuiPaginationItem-previousNext")
      .evaluateAll((nodes) => nodes.filter((node) => !node.hidden).length);
    if (visiblePreviousNextCount !== 2) throw new Error(`Pagination expected 2 visible previous/next items, got ${visiblePreviousNextCount}`);

    const hiddenPagination = page.locator(".MuiPagination-root.repro-pagination-hide-root").first();
    if ((await hiddenPagination.count()) === 0) throw new Error("missing repro hidden Pagination root");
    const hiddenPreviousNextCount = await hiddenPagination
      .locator(".MuiPaginationItem-root.MuiPaginationItem-previousNext")
      .evaluateAll((nodes) => nodes.filter((node) => !node.hidden).length);
    if (hiddenPreviousNextCount !== 0) throw new Error(`Pagination expected 0 visible previous/next items after hide flags, got ${hiddenPreviousNextCount}`);

    const actions = page.locator(".MuiTablePaginationActions-root.repro-actions-root.repro-actions-root-class.repro-actions-root-slot").first();
    if ((await actions.count()) === 0) throw new Error("missing repro TablePaginationActions root");
    const visibleActionLabels = await actions
      .locator(".MuiIconButton-root")
      .evaluateAll((nodes) => nodes.filter((node) => !node.hidden).map((node) => node.getAttribute("aria-label") ?? ""));
    if (!visibleActionLabels.includes("Go to first page")) throw new Error("TablePaginationActions did not show the first page button when showFirstButton is set");
    if (!visibleActionLabels.includes("Go to last page")) throw new Error("TablePaginationActions did not show the last page button when showLastButton is set");

    const nestedTablePagination = page.locator(".MuiTablePagination-root.repro-table-pagination-root.repro-table-pagination-root-class.repro-table-pagination-root-slot").first();
    if ((await nestedTablePagination.count()) === 0) throw new Error("missing repro TablePagination root");
    const nestedActionLabels = await nestedTablePagination
      .locator(".MuiTablePaginationActions-root .MuiIconButton-root")
      .evaluateAll((nodes) => nodes.filter((node) => !node.hidden).map((node) => node.getAttribute("aria-label") ?? ""));
    if (!nestedActionLabels.includes("Go to first page")) throw new Error("TablePagination did not forward showFirstButton to nested actions");
    if (!nestedActionLabels.includes("Go to last page")) throw new Error("TablePagination did not forward showLastButton to nested actions");

    console.log(`ok: verified table/pagination repro in ${rootDir}`);
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
