import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(projectRoot, "dist");

const assets = [
    ["index.html", "index.html"],
    ["styles.css", "styles.css"],
    ["app.js", "app.js"],
    ["data/mock-positions.js", "data/mock-positions.js"],
    [".openai/hosting.json", ".openai/hosting.json"]
];

fs.rmSync(distRoot, { recursive: true, force: true });

for (const [source, destination] of assets) {
    const sourcePath = path.join(projectRoot, source);
    const destinationPath = path.join(distRoot, destination);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
}

console.log(`Built ${assets.length} deterministic static assets into ${path.relative(projectRoot, distRoot)}/`);
