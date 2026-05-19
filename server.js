const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const ADMIN_PASSWORD = process.env.MORNEVEN_ADMIN_PASSWORD;
const SESSION_SECRET =
  process.env.MORNEVEN_SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const SESSION_COOKIE = "__session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_IMAGES = 20;
const MAX_BODY_BYTES = 14 * 1024 * 1024;
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

const parseCookies = (header = "") =>
  Object.fromEntries(
    header
      .split(";")
      .map((item) => {
        const [key, ...valueParts] = item.trim().split("=");
        return [key, valueParts.join("=")];
      })
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)]),
  );

const sign = (value) =>
  crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");

const timingSafeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
};

const createSessionToken = () => {
  const expiresAt = String(Date.now() + SESSION_TTL_MS);
  return `${expiresAt}.${sign(expiresAt)}`;
};

const isValidSession = (token) => {
  if (!token) return false;

  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature || Number(expiresAt) < Date.now()) return false;

  return timingSafeEqual(signature, sign(expiresAt));
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
  if (isValidSession(cookies[SESSION_COOKIE])) return true;

  sendJSON(response, 401, { ok: false });
  return false;
};

const normalizeText = (value, fallback, maxLength) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maxLength);
};

const normalizeId = (value) => {
  const fallback = `custom-${Date.now()}-${crypto.randomUUID()}`;
  const id = normalizeText(value, fallback, 120)
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return id || fallback;
};

const normalizeImageRecord = (payload) => ({
  alt: normalizeText(payload.alt || payload.title, "MOR.NEVEN IMAGE", 80),
  detail: normalizeText(payload.detail, "Added to the MOR.NEVEN board.", 260),
  id: normalizeId(payload.id),
  r: normalizeText(payload.r, "0deg", 12),
  shape: payload.shape === "portrait" ? "portrait" : "wide",
  title: normalizeText(payload.title, "MOR.NEVEN IMAGE", 48),
  type: normalizeText(payload.type, "Ceramic work / Workshop archive", 90),
  w: normalizeText(payload.w, payload.shape === "portrait" ? "122px" : "176px", 12),
  x: Number.isFinite(Number(payload.x)) ? Number(payload.x) : 50,
  y: Number.isFinite(Number(payload.y)) ? Number(payload.y) : 50,
});

const parseDataURL = (src) => {
  if (typeof src !== "string" || Buffer.byteLength(src) > MAX_BODY_BYTES) {
    throw new Error("Invalid image.");
  }

  const match = src.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("Invalid image.");

  const contentType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  return {
    buffer: Buffer.from(match[2], "base64"),
    contentType,
    extension: contentType.split("/")[1].replace("jpeg", "jpg"),
  };
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
  sendJSON(response, 200, { image: storedRecord, ok: true });
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
    sendJSON(response, 200, { ok: isValidSession(cookies[SESSION_COOKIE]) });
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
          createSessionToken(),
        )}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
      });
    } catch {
      sendJSON(response, 400, { ok: false });
    }
    return true;
  }

  if (pathname === "/api/images" && request.method === "GET") {
    sendJSON(response, 200, { ...(await readData()), ok: true });
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
