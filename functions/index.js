const crypto = require("node:crypto");

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

initializeApp();

const adminPassword = defineSecret("MORNEVEN_ADMIN_PASSWORD");
const sessionSecret = defineSecret("MORNEVEN_SESSION_SECRET");

const SESSION_COOKIE = "__session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_IMAGES = 20;
const MAX_DATA_URL_BYTES = 12 * 1024 * 1024;
const STATE_REF = getFirestore().collection("siteState").doc("morneven");
const IMAGES_REF = getFirestore().collection("images");

const sendJSON = (response, status, payload, headers = {}) => {
  response.set({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.status(status).send(JSON.stringify(payload));
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
  crypto.createHmac("sha256", sessionSecret.value()).update(value).digest("base64url");

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

const isValidSession = (request) => {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return false;

  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature || Number(expiresAt) < Date.now()) return false;

  return timingSafeEqual(signature, sign(expiresAt));
};

const requireAdmin = (request, response) => {
  if (isValidSession(request)) return true;

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
  detail: normalizeText(
    payload.detail,
    "Added to the MOR.NEVEN board.",
    260,
  ),
  id: normalizeId(payload.id),
  r: normalizeText(payload.r, "0deg", 12),
  shape: payload.shape === "portrait" ? "portrait" : "wide",
  title: normalizeText(payload.title, "MOR.NEVEN IMAGE", 48),
  type: normalizeText(
    payload.type,
    "Ceramic work / Workshop archive",
    90,
  ),
  w: normalizeText(payload.w, payload.shape === "portrait" ? "122px" : "176px", 12),
  x: Number.isFinite(Number(payload.x)) ? Number(payload.x) : 50,
  y: Number.isFinite(Number(payload.y)) ? Number(payload.y) : 50,
});

const parseDataURL = (src) => {
  if (typeof src !== "string" || Buffer.byteLength(src) > MAX_DATA_URL_BYTES) {
    throw new Error("Invalid image.");
  }

  const match = src.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("Invalid image.");

  const contentType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  return {
    buffer: Buffer.from(match[2], "base64"),
    contentType,
  };
};

const getState = async () => {
  const [imageSnapshot, stateSnapshot] = await Promise.all([
    IMAGES_REF.orderBy("createdAt", "asc").get(),
    STATE_REF.get(),
  ]);

  return {
    hiddenDefaults: stateSnapshot.exists
      ? stateSnapshot.data().hiddenDefaults || []
      : [],
    images: imageSnapshot.docs.map((doc) => doc.data()),
    ok: true,
  };
};

const createImage = async (request, response) => {
  if (!requireAdmin(request, response)) return;

  const imageCount = (await IMAGES_REF.count().get()).data().count;
  if (imageCount >= MAX_IMAGES) {
    sendJSON(response, 409, { ok: false, error: "limit" });
    return;
  }

  const record = normalizeImageRecord(request.body || {});
  const { buffer, contentType } = parseDataURL(request.body.src);
  const extension = contentType.split("/")[1].replace("jpeg", "jpg");
  const storagePath = `images/${record.id}.${extension}`;
  const token = crypto.randomUUID();
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);

  await file.save(buffer, {
    metadata: {
      cacheControl: "public, max-age=31536000",
      contentType,
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
    },
    resumable: false,
  });

  const src = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
    storagePath,
  )}?alt=media&token=${token}`;
  const storedRecord = {
    ...record,
    createdAt: Date.now(),
    src,
    storagePath,
  };

  await IMAGES_REF.doc(record.id).set(storedRecord);
  sendJSON(response, 200, { image: storedRecord, ok: true });
};

const deleteImage = async (request, response, id) => {
  if (!requireAdmin(request, response)) return;

  if (id.startsWith("default-")) {
    await STATE_REF.set(
      { hiddenDefaults: FieldValue.arrayUnion(id) },
      { merge: true },
    );
    sendJSON(response, 200, { ok: true });
    return;
  }

  const imageRef = IMAGES_REF.doc(id);
  const imageSnapshot = await imageRef.get();
  if (!imageSnapshot.exists) {
    sendJSON(response, 404, { ok: false });
    return;
  }

  const image = imageSnapshot.data();
  if (image.storagePath) {
    await getStorage().bucket().file(image.storagePath).delete({ ignoreNotFound: true });
  }
  await imageRef.delete();
  sendJSON(response, 200, { ok: true });
};

const route = async (request, response) => {
  const url = new URL(request.url, `https://${request.headers.host}`);
  const pathname = url.pathname.replace(/^\/api/, "") || "/";

  try {
    if (request.method === "GET" && pathname === "/session") {
      sendJSON(response, 200, { ok: isValidSession(request) });
      return;
    }

    if (request.method === "POST" && pathname === "/login") {
      if (!timingSafeEqual(request.body?.password || "", adminPassword.value())) {
        sendJSON(response, 401, { ok: false });
        return;
      }

      sendJSON(response, 200, { ok: true }, {
        "Set-Cookie": `${SESSION_COOKIE}=${encodeURIComponent(
          createSessionToken(),
        )}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
      });
      return;
    }

    if (request.method === "GET" && pathname === "/images") {
      sendJSON(response, 200, await getState());
      return;
    }

    if (request.method === "POST" && pathname === "/images") {
      await createImage(request, response);
      return;
    }

    const deleteMatch = pathname.match(/^\/images\/([^/]+)$/);
    if (request.method === "DELETE" && deleteMatch) {
      await deleteImage(request, response, decodeURIComponent(deleteMatch[1]));
      return;
    }

    sendJSON(response, 404, { ok: false });
  } catch (error) {
    console.error(error);
    sendJSON(response, 500, { ok: false });
  }
};

exports.api = onRequest(
  {
    cors: false,
    invoker: "public",
    maxInstances: 10,
    region: "asia-northeast3",
    secrets: [adminPassword, sessionSecret],
  },
  route,
);
