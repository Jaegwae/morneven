const crypto = require("node:crypto");

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const {
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
} = require("./shared");

initializeApp();

const adminPassword = defineSecret("MORNEVEN_ADMIN_PASSWORD");
const sessionSecret = defineSecret("MORNEVEN_SESSION_SECRET");

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

const isValidSession = (request) => {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  return isValidSessionToken(token, sessionSecret.value());
};

const requireAdmin = (request, response) => {
  if (isValidSession(request)) return true;

  sendJSON(response, 401, { ok: false });
  return false;
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
    images: imageSnapshot.docs.map((doc) => toPublicImageRecord(doc.data())),
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

  const payload = request.body || {};
  const record = normalizeImageRecord(payload);
  let image;
  try {
    image = parseDataURL(payload.src);
  } catch {
    sendJSON(response, 400, { ok: false, error: "invalid-image" });
    return;
  }

  const { buffer, contentType, extension } = image;
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
  sendJSON(response, 200, { image: toPublicImageRecord(storedRecord), ok: true });
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
          createSessionToken(sessionSecret.value()),
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
