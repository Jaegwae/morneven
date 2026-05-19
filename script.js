const stage = document.querySelector(".stage");
const modalLayer = document.querySelector(".modal-layer");
const managerTrigger = document.querySelector(".image-manager-trigger");
const managerOverlay = document.querySelector(".manager-overlay");
const managerPanel = document.querySelector(".manager-panel");
const managerClose = document.querySelector(".manager-close");
const managerCount = document.querySelector(".manager-count");
const managerGrid = document.querySelector(".manager-grid");
const managerAdd = document.querySelector(".manager-add");
const managerFile = document.querySelector(".manager-file");
const managerStatus = document.querySelector(".manager-status");
const managerDraft = document.querySelector(".manager-draft");
const managerDraftList = document.querySelector(".manager-draft-list");
const managerSave = document.querySelector(".manager-save");
const managerCancel = document.querySelector(".manager-cancel");
const authOverlay = document.querySelector(".auth-overlay");
const authPanel = document.querySelector(".auth-panel");
const authClose = document.querySelector(".auth-close");
const authForm = document.querySelector(".auth-form");
const authPassword = document.querySelector(".auth-password");
const authStatus = document.querySelector(".auth-status");
const authSubmit = document.querySelector(".auth-submit");

const MAX_IMAGES = 20;
const DEFAULT_CUSTOM_DETAIL = "Added to the MOR.NEVEN board.";
const DEFAULT_CUSTOM_TYPE = "Ceramic work / Workshop archive";
const DELETED_DEFAULTS_KEY = "morneven.deletedDefaults";
const DB_NAME = "morneven-image-store";
const DB_VERSION = 1;
const IMAGE_STORE = "images";

let topLayer = 20;
let modalSerial = 0;
let openWindows = [];
let pendingRecords = [];
let adminUnlocked = false;
let remoteAvailable = false;

const isMobileViewport = () => window.matchMedia("(max-width: 760px)").matches;

const readNumber = (element, name) => {
  const value = element.style.getPropertyValue(name).trim();
  return Number.parseFloat(value) || 0;
};

const writeOffset = (element, x, y) => {
  element.style.setProperty("--tx", `${x}px`);
  element.style.setProperty("--ty", `${y}px`);
};

const escapeHTML = (value) =>
  String(value).replace(/[&<>"']/g, (character) => {
    const escapes = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return escapes[character];
  });

const getDeletedDefaults = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(DELETED_DEFAULTS_KEY) || "[]"));
  } catch {
    return new Set();
  }
};

const saveDeletedDefaults = (deletedDefaults) => {
  localStorage.setItem(
    DELETED_DEFAULTS_KEY,
    JSON.stringify(Array.from(deletedDefaults)),
  );
};

const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);

  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(IMAGE_STORE)) {
      db.createObjectStore(IMAGE_STORE, { keyPath: "id" });
    }
  };

  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const withImageStore = async (mode, operation) => {
  const db = await dbPromise;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IMAGE_STORE, mode);
    const store = transaction.objectStore(IMAGE_STORE);
    const request = operation(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const getStoredImages = async () => {
  const records = await withImageStore("readonly", (store) => store.getAll());
  return records.sort((a, b) => a.createdAt - b.createdAt);
};

const putStoredImage = (record) =>
  withImageStore("readwrite", (store) => store.put(record));

const deleteStoredImage = (id) =>
  withImageStore("readwrite", (store) => store.delete(id));

const requestJSON = async (url, options = {}) => {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    ...options,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Request failed.");
    error.status = response.status;
    throw error;
  }

  return payload;
};

const getRemoteState = () => requestJSON("/api/images");

const putRemoteImage = (record) =>
  requestJSON("/api/images", {
    body: JSON.stringify(record),
    method: "POST",
  });

const deleteRemoteImage = (id) =>
  requestJSON(`/api/images/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

const currentPieceCount = () => document.querySelectorAll(".piece").length;

const getPieceById = (id) =>
  Array.from(document.querySelectorAll(".piece")).find(
    (piece) => piece.dataset.id === id,
  );

const setLayerState = () => {
  const isOpen = openWindows.length > 0;
  modalLayer.classList.toggle("is-open", isOpen);
  modalLayer.setAttribute("aria-hidden", String(!isOpen));
  document.body.classList.toggle("modal-open", isOpen);
};

const focusWindow = (windowElement) => {
  topLayer += 1;
  windowElement.style.zIndex = String(topLayer);
  const active = openWindows.find((item) => item.element === windowElement);
  if (active) {
    openWindows = openWindows.filter((item) => item.element !== windowElement);
    openWindows.push(active);
  }
  openWindows.forEach((item) => {
    item.element.classList.toggle("is-active", item.element === windowElement);
  });
};

const closeWindow = (windowElement) => {
  windowElement.remove();
  openWindows = openWindows.filter((item) => item.element !== windowElement);
  if (openWindows.at(-1)) {
    focusWindow(openWindows.at(-1).element);
  }
  setLayerState();
};

const closeWindowsForPiece = (id) => {
  openWindows
    .filter((item) => item.id === id)
    .forEach((item) => item.element.remove());
  openWindows = openWindows.filter((item) => item.id !== id);
  if (openWindows.at(-1)) {
    focusWindow(openWindows.at(-1).element);
  }
  setLayerState();
};

const getPieceData = (piece) => {
  const image = piece.querySelector("img");
  const title = piece.querySelector("figcaption").textContent.trim();

  return {
    alt: image.alt,
    detail: piece.dataset.detail || image.alt,
    id: piece.dataset.id,
    src: image.src,
    title,
    type: piece.dataset.type || DEFAULT_CUSTOM_TYPE,
  };
};

const makeWindow = ({ alt, detail, id, src, title, type }) => {
  modalSerial += 1;
  const titleId = `modal-title-${modalSerial}`;
  const windowElement = document.createElement("section");
  const safeAlt = escapeHTML(alt);
  const safeDetail = escapeHTML(detail);
  const safeSrc = escapeHTML(src);
  const safeTitle = escapeHTML(title);
  const safeType = escapeHTML(type || DEFAULT_CUSTOM_TYPE);
  windowElement.className = "mac-window";
  windowElement.dataset.pieceId = id;
  windowElement.setAttribute("role", "dialog");
  windowElement.setAttribute("aria-modal", "false");
  windowElement.setAttribute("aria-labelledby", titleId);
  windowElement.tabIndex = -1;
  windowElement.innerHTML = `
    <header class="mac-window__bar">
      <div class="traffic" aria-label="Window controls">
        <button class="traffic__dot traffic__dot--close" type="button" aria-label="Close"></button>
        <button class="traffic__dot traffic__dot--minimize" type="button" aria-label="Minimize"></button>
        <button class="traffic__dot traffic__dot--zoom" type="button" aria-label="Zoom"></button>
      </div>
      <p>Information about: ${safeTitle}</p>
    </header>

    <div class="mac-window__body">
      <div class="modal-intro">
        <img class="modal-thumb" src="${safeSrc}" alt="${safeAlt}" />
        <div>
          <h2 id="${titleId}">${safeTitle}</h2>
          <p class="modal-kicker">MOR.NEVEN ceramic studio</p>
        </div>
      </div>
      <p class="modal-copy">${safeDetail}</p>
      <details open>
        <summary>Details:</summary>
        <p><strong>Type:</strong> ${safeType}</p>
      </details>
      <details open>
        <summary>Preview:</summary>
        <img class="modal-preview" src="${safeSrc}" alt="${safeAlt}" />
      </details>
    </div>
  `;

  return windowElement;
};

const positionWindow = (windowElement) => {
  if (isMobileViewport()) return;

  const offset = Math.min(openWindows.length, 2) * 34;
  const left = Math.round(window.innerWidth / 2 - 306 + offset);
  const top = Math.round(window.innerHeight / 2 - 345 + offset);
  windowElement.style.setProperty("--window-left", `${Math.max(24, left)}px`);
  windowElement.style.setProperty("--window-top", `${Math.max(24, top)}px`);
};

const openModal = (piece) => {
  const data = getPieceData(piece);

  if (isMobileViewport()) {
    openWindows.forEach((item) => item.element.remove());
    openWindows = [];
  } else if (openWindows.length >= 3) {
    closeWindow(openWindows[0].element);
  }

  const existing = openWindows.find((item) => item.id === data.id);
  if (existing) {
    existing.element.classList.remove("is-minimized");
    focusWindow(existing.element);
    existing.element.focus({ preventScroll: true });
    return;
  }

  const windowElement = makeWindow(data);
  positionWindow(windowElement);
  modalLayer.append(windowElement);
  openWindows.push({ element: windowElement, id: data.id, title: data.title });
  setLayerState();
  bindWindow(windowElement);
  focusWindow(windowElement);

  requestAnimationFrame(() => {
    windowElement.classList.add("is-visible");
    windowElement.focus({ preventScroll: true });
  });
};

const bindWindow = (windowElement) => {
  const bar = windowElement.querySelector(".mac-window__bar");
  const closeButton = windowElement.querySelector(".traffic__dot--close");
  const minimizeButton = windowElement.querySelector(".traffic__dot--minimize");
  const zoomButton = windowElement.querySelector(".traffic__dot--zoom");
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;

  windowElement.addEventListener("pointerdown", () => {
    focusWindow(windowElement);
  });

  closeButton.addEventListener("click", () => closeWindow(windowElement));

  minimizeButton.addEventListener("click", () => {
    if (isMobileViewport()) return;

    windowElement.classList.toggle("is-minimized");
    windowElement.classList.remove("is-zoomed");
    focusWindow(windowElement);
  });

  zoomButton.addEventListener("click", () => {
    if (isMobileViewport()) return;

    windowElement.classList.toggle("is-zoomed");
    windowElement.classList.remove("is-minimized");
    if (windowElement.classList.contains("is-zoomed")) {
      windowElement.style.setProperty("--window-left", "50%");
      windowElement.style.setProperty("--window-top", "24px");
      windowElement.style.transform = "translateX(-50%)";
    } else {
      windowElement.style.transform = "";
      positionWindow(windowElement);
    }
    focusWindow(windowElement);
  });

  bar.addEventListener("pointerdown", (event) => {
    if (isMobileViewport() || event.button !== 0) return;
    if (event.target.closest(".traffic")) return;

    const rect = windowElement.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    originX = rect.left;
    originY = rect.top;
    dragging = true;
    windowElement.classList.add("is-window-dragging");
    windowElement.classList.remove("is-zoomed");
    windowElement.style.transform = "";
    windowElement.setPointerCapture(event.pointerId);
    focusWindow(windowElement);
    event.preventDefault();
  });

  windowElement.addEventListener("pointermove", (event) => {
    if (!dragging) return;

    const width = windowElement.offsetWidth;
    const nextX = Math.min(
      window.innerWidth - Math.min(120, width),
      Math.max(0, originX + event.clientX - startX),
    );
    const nextY = Math.min(
      window.innerHeight - 32,
      Math.max(0, originY + event.clientY - startY),
    );

    windowElement.style.setProperty("--window-left", `${nextX}px`);
    windowElement.style.setProperty("--window-top", `${nextY}px`);
  });

  const stopWindowDrag = (event) => {
    if (!dragging) return;

    dragging = false;
    windowElement.classList.remove("is-window-dragging");
    if (windowElement.hasPointerCapture(event.pointerId)) {
      windowElement.releasePointerCapture(event.pointerId);
    }
  };

  windowElement.addEventListener("pointerup", stopWindowDrag);
  windowElement.addEventListener("pointercancel", stopWindowDrag);
};

const bindPiece = (piece) => {
  if (piece.dataset.bound === "true") return;
  piece.dataset.bound = "true";

  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;
  let moved = false;

  piece.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;

    startX = event.clientX;
    startY = event.clientY;
    originX = readNumber(piece, "--tx");
    originY = readNumber(piece, "--ty");
    moved = false;

    piece.classList.add("is-dragging");
    piece.style.zIndex = String(++topLayer);
    piece.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  piece.addEventListener("pointermove", (event) => {
    if (!piece.classList.contains("is-dragging")) return;

    const nextX = originX + event.clientX - startX;
    const nextY = originY + event.clientY - startY;
    if (Math.abs(nextX - originX) + Math.abs(nextY - originY) > 7) {
      moved = true;
    }
    writeOffset(piece, nextX, nextY);
  });

  const stopDrag = (event) => {
    if (!piece.classList.contains("is-dragging")) return;

    piece.classList.remove("is-dragging");
    if (piece.hasPointerCapture(event.pointerId)) {
      piece.releasePointerCapture(event.pointerId);
    }
  };

  piece.addEventListener("pointerup", stopDrag);
  piece.addEventListener("pointercancel", stopDrag);

  piece.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      openModal(piece);
      event.preventDefault();
      return;
    }

    const step = event.shiftKey ? 24 : 8;
    const currentX = readNumber(piece, "--tx");
    const currentY = readNumber(piece, "--ty");
    const keyMap = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };

    const delta = keyMap[event.key];
    if (!delta) return;

    writeOffset(piece, currentX + delta[0], currentY + delta[1]);
    piece.style.zIndex = String(++topLayer);
    event.preventDefault();
  });

  piece.addEventListener("click", (event) => {
    if (moved) {
      moved = false;
      return;
    }

    openModal(piece);
    event.preventDefault();
  });
};

const makePlacement = (count, shape) => {
  const slots = [
    [83, 18],
    [8, 42],
    [78, 68],
    [18, 18],
    [43, 70],
    [84, 39],
    [9, 72],
    [54, 12],
    [32, 29],
    [68, 25],
    [24, 57],
    [57, 55],
  ];
  const [x, y] = slots[count % slots.length];
  const rotations = [-4, 3, -2, 5, 2, -5, 4, -3];

  return {
    r: `${rotations[count % rotations.length]}deg`,
    w: shape === "portrait" ? "122px" : "176px",
    x,
    y,
  };
};

const createPieceElement = (record) => {
  const piece = document.createElement("figure");
  const shapeClass = record.shape === "portrait" ? "piece-portrait" : "piece-wide";
  piece.className = `piece ${shapeClass}`;
  piece.dataset.detail = record.detail;
  piece.dataset.id = record.id;
  piece.dataset.kind = "custom";
  piece.dataset.type = record.type || DEFAULT_CUSTOM_TYPE;
  piece.tabIndex = 0;
  piece.style.setProperty("--x", record.x);
  piece.style.setProperty("--y", record.y);
  piece.style.setProperty("--w", record.w);
  piece.style.setProperty("--r", record.r);
  piece.style.setProperty("--delay", "0ms");
  piece.innerHTML = `
    <img src="${escapeHTML(record.src)}" alt="${escapeHTML(record.alt)}" />
    <figcaption>${escapeHTML(record.title)}</figcaption>
  `;
  stage.append(piece);
  bindPiece(piece);
  return piece;
};

const normalizeTitle = (filename) => {
  const base = filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  return (base || "MOR.NEVEN IMAGE").slice(0, 22).toUpperCase();
};

const imageFileToRecord = (file, count) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      const maxSide = 1800;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      const shape = width >= height ? "wide" : "portrait";
      const placement = makePlacement(count, shape);

      canvas.width = width;
      canvas.height = height;
      context.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);

      resolve({
        alt: normalizeTitle(file.name),
        createdAt: Date.now() + count,
        detail: "",
        id: `custom-${Date.now()}-${
          crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
        }`,
        originalName: file.name,
        shape,
        src: canvas.toDataURL("image/jpeg", 0.88),
        title: normalizeTitle(file.name),
        type: DEFAULT_CUSTOM_TYPE,
        ...placement,
      });
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Image load failed."));
    };

    image.src = objectUrl;
  });

const hydrateDefaults = (hiddenDefaults = getDeletedDefaults()) => {
  Array.from(document.querySelectorAll(".piece")).forEach((piece, index) => {
    const id = `default-${index + 1}`;
    piece.dataset.id = id;
    piece.dataset.kind = "default";

    if (hiddenDefaults.has(id)) {
      piece.remove();
      return;
    }

    bindPiece(piece);
  });
};

const hydrateStoredImages = async () => {
  try {
    const records = await getStoredImages();
    records.forEach((record) => createPieceElement(record));
  } catch {
    managerStatus.textContent = "Storage unavailable.";
  }
};

const normalizeDraftTitle = (value, fallback) => {
  const title = String(value || "").replace(/\s+/g, " ").trim();
  return (title || normalizeTitle(fallback || "MOR.NEVEN IMAGE")).slice(0, 48);
};

const normalizeDraftDetail = (value) => {
  const detail = String(value || "").replace(/\s+/g, " ").trim();
  return (detail || DEFAULT_CUSTOM_DETAIL).slice(0, 260);
};

const normalizeDraftType = (value) => {
  const type = String(value || "").replace(/\s+/g, " ").trim();
  return (type || DEFAULT_CUSTOM_TYPE).slice(0, 90);
};

const createDraftField = ({
  field = "input",
  label,
  maxLength,
  onInput,
  placeholder,
  value,
}) => {
  const wrapper = document.createElement("label");
  wrapper.className = "manager-field";

  const labelText = document.createElement("span");
  labelText.textContent = label;

  const input =
    field === "textarea"
      ? document.createElement("textarea")
      : document.createElement("input");
  if (input.tagName === "INPUT") {
    input.type = "text";
  }
  input.maxLength = maxLength;
  input.placeholder = placeholder;
  input.value = value;
  input.addEventListener("input", () => onInput(input.value));

  wrapper.append(labelText, input);
  return wrapper;
};

const renderDrafts = () => {
  managerDraft.hidden = pendingRecords.length === 0;
  managerDraftList.replaceChildren();
  managerSave.disabled = pendingRecords.length === 0 || currentPieceCount() >= MAX_IMAGES;

  pendingRecords.forEach((record, index) => {
    const item = document.createElement("article");
    item.className = "manager-draft-item";

    const preview = document.createElement("img");
    preview.src = record.src;
    preview.alt = record.alt;

    const fields = document.createElement("div");
    fields.className = "manager-draft-fields";

    const titleLabel = createDraftField({
      label: "Name",
      maxLength: 48,
      placeholder: "Image name",
      value: record.title,
      onInput: (value) => {
        pendingRecords[index].title = value;
        pendingRecords[index].alt = normalizeDraftTitle(
          value,
          record.originalName,
        );
      },
    });

    const typeLabel = createDraftField({
      label: "Type",
      maxLength: 90,
      placeholder: DEFAULT_CUSTOM_TYPE,
      value: record.type || DEFAULT_CUSTOM_TYPE,
      onInput: (value) => {
        pendingRecords[index].type = value;
      },
    });

    const detailLabel = createDraftField({
      field: "textarea",
      label: "Description",
      maxLength: 260,
      placeholder: "Description",
      value: record.detail,
      onInput: (value) => {
        pendingRecords[index].detail = value;
      },
    });

    fields.append(titleLabel, typeLabel, detailLabel);
    item.append(preview, fields);
    managerDraftList.append(item);
  });
};

const renderManager = () => {
  const allPieces = Array.from(document.querySelectorAll(".piece"));
  const stagedCount = allPieces.length + pendingRecords.length;
  managerCount.textContent = `${allPieces.length} / ${MAX_IMAGES}`;
  managerGrid.replaceChildren();
  managerAdd.classList.toggle("is-disabled", stagedCount >= MAX_IMAGES);
  managerFile.disabled = stagedCount >= MAX_IMAGES;

  allPieces.forEach((piece) => {
    const data = getPieceData(piece);
    const item = document.createElement("article");
    item.className = "manager-item";

    const thumb = document.createElement("img");
    thumb.src = data.src;
    thumb.alt = data.alt;

    const title = document.createElement("p");
    title.textContent = data.title;

    const detail = document.createElement("small");
    detail.textContent = `${data.type} · ${data.detail}`;

    const deleteButton = document.createElement("button");
    deleteButton.className = "manager-delete";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => deletePiece(data.id));

    item.append(thumb, title, detail, deleteButton);
    managerGrid.append(item);
  });

  renderDrafts();
};

const closeAuth = () => {
  authOverlay.classList.remove("is-open");
  authOverlay.setAttribute("aria-hidden", "true");
  authPassword.value = "";
  authStatus.textContent = "";
};

const openAuth = () => {
  if (isMobileViewport()) return;

  authOverlay.classList.add("is-open");
  authOverlay.setAttribute("aria-hidden", "false");
  authPanel.focus({ preventScroll: true });
  requestAnimationFrame(() => authPassword.focus({ preventScroll: true }));
};

const checkAdminSession = async () => {
  try {
    const result = await requestJSON("/api/session");
    return result.ok === true;
  } catch {
    return false;
  }
};

const requestAdminAccess = async () => {
  if (isMobileViewport()) return;

  if (adminUnlocked || (await checkAdminSession())) {
    adminUnlocked = true;
    openManager();
    return;
  }

  openAuth();
};

const submitAuth = async (event) => {
  event.preventDefault();

  authSubmit.disabled = true;
  authStatus.textContent = "Checking.";

  try {
    await requestJSON("/api/login", {
      body: JSON.stringify({ password: authPassword.value }),
      method: "POST",
    });

    adminUnlocked = true;
    closeAuth();
    openManager();
  } catch (error) {
    authStatus.textContent =
      error.status === 401 ? "Wrong password." : "Admin server unavailable.";
  } finally {
    authSubmit.disabled = false;
  }
};

const openManager = () => {
  if (isMobileViewport()) return;

  managerStatus.textContent = "";
  renderManager();
  managerOverlay.classList.add("is-open");
  managerOverlay.setAttribute("aria-hidden", "false");
  managerPanel.focus({ preventScroll: true });
};

const closeManager = () => {
  pendingRecords = [];
  renderDrafts();
  managerOverlay.classList.remove("is-open");
  managerOverlay.setAttribute("aria-hidden", "true");
};

const deletePiece = async (id) => {
  const piece = getPieceById(id);
  if (!piece) return;

  closeWindowsForPiece(id);

  if (remoteAvailable) {
    await deleteRemoteImage(id);
  } else if (piece.dataset.kind === "default") {
    const deletedDefaults = getDeletedDefaults();
    deletedDefaults.add(id);
    saveDeletedDefaults(deletedDefaults);
  } else {
    await deleteStoredImage(id);
  }

  piece.remove();
  managerStatus.textContent = "";
  renderManager();
};

const prepareFiles = async (fileList) => {
  const files = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
  const slots = MAX_IMAGES - currentPieceCount() - pendingRecords.length;

  if (files.length === 0) {
    managerStatus.textContent = "Choose image files.";
    return;
  }

  if (slots <= 0) {
    managerStatus.textContent = "Limit 20.";
    return;
  }

  const selectedFiles = files.slice(0, slots);
  managerAdd.classList.add("is-busy");
  managerFile.disabled = true;
  managerStatus.textContent = "Preparing images.";

  try {
    const baseCount = currentPieceCount() + pendingRecords.length;
    const records = await Promise.all(
      selectedFiles.map((file, index) => imageFileToRecord(file, baseCount + index)),
    );
    pendingRecords = [...pendingRecords, ...records];
    managerStatus.textContent =
      selectedFiles.length < files.length
        ? "Only open slots were prepared."
        : "Edit details, then save.";
  } catch {
    managerStatus.textContent = "Image could not be read.";
  } finally {
    managerAdd.classList.remove("is-busy");
    renderManager();
  }
};

const savePendingImages = async () => {
  if (pendingRecords.length === 0) return;

  const slots = MAX_IMAGES - currentPieceCount();
  if (slots <= 0) {
    managerStatus.textContent = "Limit 20.";
    renderDrafts();
    return;
  }

  const records = pendingRecords.slice(0, slots);
  managerSave.disabled = true;
  managerStatus.textContent = "Saving images.";

  try {
    const baseCount = currentPieceCount();

    for (const [index, draft] of records.entries()) {
      const title = normalizeDraftTitle(draft.title, draft.originalName);
      const record = {
        ...draft,
        ...makePlacement(baseCount + index, draft.shape),
        alt: title,
        createdAt: Date.now() + index,
        detail: normalizeDraftDetail(draft.detail),
        title,
        type: normalizeDraftType(draft.type),
      };

      delete record.originalName;
      if (remoteAvailable) {
        const result = await putRemoteImage(record);
        createPieceElement(result.image);
      } else {
        await putStoredImage(record);
        createPieceElement(record);
      }
    }

    pendingRecords = [];
    managerStatus.textContent = records.length === 1 ? "Image added." : "Images added.";
  } catch {
    managerStatus.textContent = "Images could not be saved.";
  } finally {
    renderManager();
  }
};

managerTrigger.addEventListener("click", requestAdminAccess);
authClose.addEventListener("click", closeAuth);
authForm.addEventListener("submit", submitAuth);
authOverlay.addEventListener("click", (event) => {
  if (event.target === authOverlay) {
    closeAuth();
  }
});
managerClose.addEventListener("click", closeManager);
managerCancel.addEventListener("click", () => {
  pendingRecords = [];
  managerStatus.textContent = "";
  renderDrafts();
});
managerSave.addEventListener("click", savePendingImages);
managerOverlay.addEventListener("click", (event) => {
  if (event.target === managerOverlay) {
    closeManager();
  }
});
modalLayer.addEventListener("click", (event) => {
  if (!isMobileViewport() || event.target !== modalLayer || openWindows.length === 0) {
    return;
  }

  closeWindow(openWindows.at(-1).element);
});
managerFile.addEventListener("change", async (event) => {
  await prepareFiles(event.target.files);
  managerFile.value = "";
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  if (authOverlay.classList.contains("is-open")) {
    closeAuth();
    return;
  }

  if (managerOverlay.classList.contains("is-open")) {
    closeManager();
    return;
  }

  if (openWindows.length > 0) {
    closeWindow(openWindows.at(-1).element);
  }
});

window.addEventListener("resize", () => {
  if (isMobileViewport()) {
    closeAuth();
    closeManager();
    if (openWindows.length > 1) {
      openWindows.slice(0, -1).forEach((item) => item.element.remove());
      openWindows = openWindows.slice(-1);
    }
  }
  setLayerState();
});

const init = async () => {
  try {
    const state = await getRemoteState();
    remoteAvailable = true;
    hydrateDefaults(new Set(state.hiddenDefaults || []));
    (state.images || []).forEach((record) => createPieceElement(record));
  } catch {
    remoteAvailable = false;
    hydrateDefaults();
    await hydrateStoredImages();
  }
  renderManager();
};

void init();
