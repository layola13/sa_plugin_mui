import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const distDir = path.resolve(process.argv[2] ?? path.join(repoRoot, ".zig-cache/mui-dashboard-dist"));
const cssSource = path.join(repoRoot, "assets", "mui_dashboard.css");
const cssTarget = path.join(distDir, "mui-dashboard.css");
const htmlPath = path.join(distDir, "index.html");

let html = await readFile(htmlPath, "utf8");
await copyFile(cssSource, cssTarget);

html = html.replace(/<title>.*?<\/title>/, "<title>SA MUI Component Dashboard</title>");

const linkTag = '  <link rel="stylesheet" href="./mui-dashboard.css">';
if (!html.includes('href="./mui-dashboard.css"')) {
  html = html.replace("</head>", `${linkTag}\n</head>`);
}

await writeFile(htmlPath, html);
console.log(`[dashboard] prepared ${distDir}`);
