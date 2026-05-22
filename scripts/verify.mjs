import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const shared = require(path.join(root, "functions/shared.js"));

const files = {
  functionApi: "functions/index.js",
  html: "index.html",
  script: "script.js",
  server: "server.js",
  shared: "functions/shared.js",
  styles: "styles.css",
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

const assertThrows = (operation, message) => {
  try {
    operation();
  } catch {
    return;
  }
  throw new Error(message);
};

const extractImageRefs = (html) =>
  Array.from(html.matchAll(/(?:src|href)="\.\/([^"]+\.(?:png|jpe?g|svg|webp))"/g), (match) =>
    match[1]
  );

for (const filename of [files.script, files.server, files.functionApi, files.shared]) {
  run("node", ["--check", filename]);
}

const [html, script, server, functionApi, sharedSource, styles] = await Promise.all([
  read(files.html),
  read(files.script),
  read(files.server),
  read(files.functionApi),
  read(files.shared),
  read(files.styles),
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
  maxImageConstants[0] === 20 &&
    maxImageConstants.slice(1).every((value) => value === null) &&
    shared.MAX_IMAGES === 20,
  `MAX_IMAGES mismatch: ${maxImageConstants.join(", ")}`,
);

const defaultPieceStyles = Array.from(
  html.matchAll(/<figure[\s\S]*?class="piece[^"]*"[\s\S]*?style="([^"]+)"/g),
  (match) => match[1],
);
assert(defaultPieceStyles.length === 8, `Expected 8 default pieces, found ${defaultPieceStyles.length}`);
assert(
  defaultPieceStyles.every((style) => style.includes("--mobile-x") && style.includes("--mobile-y")),
  "Default pieces must carry stable mobile placement variables.",
);
assert(
  !styles.includes(".piece:nth-of-type("),
  "Mobile piece placement must not depend on DOM order.",
);

const normalized = shared.normalizeImageRecord({
  alt: "",
  detail: "  Detailed   text  ",
  id: " custom item! ",
  r: "2deg",
  shape: "portrait",
  title: "  Test  Piece  ",
  type: "",
  w: "",
  x: "12",
  y: "34",
});
assert(normalized.id === "custom-item", `Unexpected normalized id: ${normalized.id}`);
assert(normalized.detail === "Detailed text", "Detail whitespace normalization failed.");
assert(normalized.shape === "portrait", "Portrait shape normalization failed.");
assert(normalized.w === "122px", "Portrait width fallback failed.");
assert(normalized.x === 12 && normalized.y === 34, "Numeric placement normalization failed.");

const parsedImage = shared.parseDataURL("data:image/jpg;base64,SGVsbG8=");
assert(parsedImage.contentType === "image/jpeg", "image/jpg should normalize to image/jpeg.");
assert(parsedImage.extension === "jpg", "JPEG extension normalization failed.");
assertThrows(
  () => shared.parseDataURL("data:text/plain;base64,SGVsbG8="),
  "Non-image data URLs must be rejected.",
);

const token = shared.createSessionToken("test-secret", 1000);
assert(shared.isValidSessionToken(token, "test-secret", 1001), "Fresh session token rejected.");
assert(!shared.isValidSessionToken(token, "wrong-secret", 1001), "Wrong session secret accepted.");
assert(!shared.isValidSessionToken(token, "test-secret", 1000 + shared.SESSION_TTL_MS + 1), "Expired token accepted.");

const publicRecord = shared.toPublicImageRecord({
  id: "custom-1",
  src: "/uploads/custom-1.jpg",
  storagePath: "/private/path/custom-1.jpg",
});
assert(!("storagePath" in publicRecord), "Public image records must not expose storagePath.");
assert(
  server.includes("toPublicImageRecord") && functionApi.includes("toPublicImageRecord"),
  "API responses must use public image DTOs.",
);
assert(
  sharedSource.includes("MAX_DATA_URL_BYTES = 12 * 1024 * 1024"),
  "Shared image size limit changed unexpectedly.",
);

console.log("MOR.NEVEN verification passed.");
