const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const {
  MAX_DATA_URL_BYTES,
  MAX_IMAGES,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSessionToken,
  isValidSessionToken,
  normalizeImageRecord,
  parseCookies,
  parseDataURL,
  timingSafeEqual,
  toPublicImageRecord,
} = require("./functions/shared");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const ADMIN_PASSWORD = process.env.MORNEVEN_ADMIN_PASSWORD;
const SESSION_SECRET =
  process.env.MORNEVEN_SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const MAX_BODY_BYTES = MAX_DATA_URL_BYTES + 2 * 1024 * 1024;
const DATA_DIR = path.join(ROOT, ".local-data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const DATA_FILE = path.join(DATA_DIR, "images.json");

if (!ADMIN_PASSWORD) {
  console.error("MORNEVEN_ADMIN_PASSWORD is required.");
  process.exit(1);
}

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const sendJSON = (response, status, payload, headers = {}) => {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(payload));
};

const readRequestBody = (request) =>
  new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error("Request body too large."));
        request.destroy();
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });

const ensureDataFile = async () => {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });

  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(
      DATA_FILE,
      JSON.stringify({ hiddenDefaults: [], images: [] }, null, 2),
    );
  }
};

const readData = async () => {
  await ensureDataFile();
  return JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
};

const writeData = async (data) => {
  await ensureDataFile();
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
};

const requireAdmin = (request, response) => {
  const cookies = parseCookies(request.headers.cookie);
  if (isValidSessionToken(cookies[SESSION_COOKIE], SESSION_SECRET)) return true;

  sendJSON(response, 401, { ok: false });
  return false;
};

const createImage = async (request, response, payload) => {
  if (!requireAdmin(request, response)) return;

  const data = await readData();
  if (data.images.length >= MAX_IMAGES) {
    sendJSON(response, 409, { ok: false, error: "limit" });
    return;
  }

  const record = normalizeImageRecord(payload);
  const image = parseDataURL(payload.src);
  const filename = `${record.id}.${image.extension}`;
  const uploadPath = path.join(UPLOAD_DIR, filename);

  await fs.writeFile(uploadPath, image.buffer);

  const storedRecord = {
    ...record,
    createdAt: Date.now(),
    src: `/uploads/${filename}`,
    storagePath: uploadPath,
  };

  data.images.push(storedRecord);
  await writeData(data);
  sendJSON(response, 200, { image: toPublicImageRecord(storedRecord), ok: true });
};

const deleteImage = async (request, response, id) => {
  if (!requireAdmin(request, response)) return;

  const data = await readData();

  if (id.startsWith("default-")) {
    data.hiddenDefaults = Array.from(new Set([...data.hiddenDefaults, id]));
    await writeData(data);
    sendJSON(response, 200, { ok: true });
    return;
  }

  const image = data.images.find((item) => item.id === id);
  if (!image) {
    sendJSON(response, 404, { ok: false });
    return;
  }

  data.images = data.images.filter((item) => item.id !== id);
  await writeData(data);

  if (image?.storagePath) {
    await fs.rm(image.storagePath, { force: true });
  }

  sendJSON(response, 200, { ok: true });
};

const serveStatic = async (request, response, pathname) => {
  const normalizedPathname = pathname === "/" ? "/index.html" : pathname;
  const relativePath = decodeURIComponent(normalizedPathname).replace(/^\/+/, "");
  const segments = relativePath.split("/");

  if (
    segments.some((segment) => segment.startsWith(".")) ||
    ["server.js", "functions", "firebase.json", "firestore.rules", "storage.rules"].includes(
      segments[0],
    )
  ) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const filePath = path.resolve(ROOT, relativePath);
  if (!filePath.startsWith(`${ROOT}${path.sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
};

const handleAPI = async (request, response, pathname) => {
  if (pathname === "/api/session" && request.method === "GET") {
    const cookies = parseCookies(request.headers.cookie);
    sendJSON(response, 200, {
      ok: isValidSessionToken(cookies[SESSION_COOKIE], SESSION_SECRET),
    });
    return true;
  }

  if (pathname === "/api/login" && request.method === "POST") {
    try {
      const payload = JSON.parse((await readRequestBody(request)) || "{}");

      if (!timingSafeEqual(payload.password || "", ADMIN_PASSWORD)) {
        sendJSON(response, 401, { ok: false });
        return true;
      }

      sendJSON(response, 200, { ok: true }, {
        "Set-Cookie": `${SESSION_COOKIE}=${encodeURIComponent(
          createSessionToken(SESSION_SECRET),
        )}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
      });
    } catch {
      sendJSON(response, 400, { ok: false });
    }
    return true;
  }

  if (pathname === "/api/images" && request.method === "GET") {
    const data = await readData();
    sendJSON(response, 200, {
      ...data,
      images: data.images.map(toPublicImageRecord),
      ok: true,
    });
    return true;
  }

  if (pathname === "/api/images" && request.method === "POST") {
    try {
      await createImage(request, response, JSON.parse(await readRequestBody(request)));
    } catch {
      sendJSON(response, 400, { ok: false });
    }
    return true;
  }

  const deleteMatch = pathname.match(/^\/api\/images\/([^/]+)$/);
  if (deleteMatch && request.method === "DELETE") {
    await deleteImage(request, response, decodeURIComponent(deleteMatch[1]));
    return true;
  }

  return false;
};

const server = http.createServer(async (request, response) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (await handleAPI(request, response, pathname)) return;

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405);
      response.end("Method not allowed");
      return;
    }

    await serveStatic(request, response, pathname);
  } catch (error) {
    console.error(error);
    response.writeHead(500);
    response.end("Server error");
  }
});

server.listen(PORT, () => {
  console.log(`MOR.NEVEN local server listening on http://127.0.0.1:${PORT}/`);
});
