const crypto = require("node:crypto");

const SESSION_COOKIE = "__session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_IMAGES = 20;
const MAX_DATA_URL_BYTES = 12 * 1024 * 1024;
const DEFAULT_CUSTOM_DETAIL = "Added to the MOR.NEVEN board.";
const DEFAULT_CUSTOM_TYPE = "Ceramic work / Workshop archive";

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

const timingSafeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
};

const signSessionValue = (value, secret) =>
  crypto.createHmac("sha256", secret).update(value).digest("base64url");

const createSessionToken = (secret, now = Date.now()) => {
  const expiresAt = String(now + SESSION_TTL_MS);
  return `${expiresAt}.${signSessionValue(expiresAt, secret)}`;
};

const isValidSessionToken = (token, secret, now = Date.now()) => {
  if (!token) return false;

  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature || Number(expiresAt) < now) return false;

  return timingSafeEqual(signature, signSessionValue(expiresAt, secret));
};

const normalizeText = (value, fallback, maxLength) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maxLength);
};

const normalizeId = (value, fallback = `custom-${Date.now()}-${crypto.randomUUID()}`) => {
  const id = normalizeText(value, fallback, 120)
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return id || fallback;
};

const normalizeImageRecord = (payload = {}) => ({
  alt: normalizeText(payload.alt || payload.title, "MOR.NEVEN IMAGE", 80),
  detail: normalizeText(payload.detail, DEFAULT_CUSTOM_DETAIL, 260),
  id: normalizeId(payload.id),
  r: normalizeText(payload.r, "0deg", 12),
  shape: payload.shape === "portrait" ? "portrait" : "wide",
  title: normalizeText(payload.title, "MOR.NEVEN IMAGE", 48),
  type: normalizeText(payload.type, DEFAULT_CUSTOM_TYPE, 90),
  w: normalizeText(payload.w, payload.shape === "portrait" ? "122px" : "176px", 12),
  x: Number.isFinite(Number(payload.x)) ? Number(payload.x) : 50,
  y: Number.isFinite(Number(payload.y)) ? Number(payload.y) : 50,
});

const parseDataURL = (src, { maxBytes = MAX_DATA_URL_BYTES } = {}) => {
  if (typeof src !== "string" || Buffer.byteLength(src) > maxBytes) {
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

const toPublicImageRecord = (record) => {
  const { storagePath, ...publicRecord } = record;
  return publicRecord;
};

module.exports = {
  DEFAULT_CUSTOM_DETAIL,
  DEFAULT_CUSTOM_TYPE,
  MAX_DATA_URL_BYTES,
  MAX_IMAGES,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSessionToken,
  isValidSessionToken,
  normalizeId,
  normalizeImageRecord,
  normalizeText,
  parseCookies,
  parseDataURL,
  timingSafeEqual,
  toPublicImageRecord,
};
