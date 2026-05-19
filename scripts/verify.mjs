import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const files = {
  functionApi: "functions/index.js",
  html: "index.html",
  script: "script.js",
  server: "server.js",
};

const expectedDockLinks = [
  "https://www.instagram.com/mor.neven/",
  "https://pf.kakao.com/_ZbRZX",
  "https://booking.naver.com/booking/6/bizes/1623253",
  "https://naver.me/Ix0GyLKI",
];

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr}`);
  }
};

const read = (filename) => readFile(path.join(root, filename), "utf8");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const extractImageRefs = (html) =>
  Array.from(html.matchAll(/(?:src|href)="\.\/([^"]+\.(?:png|jpe?g|svg|webp))"/g), (match) =>
    match[1]
  );

for (const filename of [files.script, files.server, files.functionApi]) {
  run("node", ["--check", filename]);
}

const [html, script, server, functionApi] = await Promise.all([
  read(files.html),
  read(files.script),
  read(files.server),
  read(files.functionApi),
]);

for (const href of expectedDockLinks) {
  assert(html.includes(`href="${href}"`), `Missing dock link: ${href}`);
}

for (const assetPath of extractImageRefs(html)) {
  await access(path.join(root, assetPath));
}

const maxImageConstants = [script, server, functionApi].map((source) => {
  const match = source.match(/const MAX_IMAGES = (\d+);/);
  return match ? Number(match[1]) : null;
});

assert(
  maxImageConstants.every((value) => value === 20),
  `MAX_IMAGES mismatch: ${maxImageConstants.join(", ")}`,
);

console.log("MOR.NEVEN verification passed.");
