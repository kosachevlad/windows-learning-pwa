export const ROOT_ID = "root";

export const FileKind = Object.freeze({
  FOLDER: "folder",
  TEXT: "text",
  PAINT: "paint"
});

const extensionByKind = {
  [FileKind.FOLDER]: "",
  [FileKind.TEXT]: ".txt",
  [FileKind.PAINT]: ".png"
};

export function createInitialState(now = Date.now()) {
  return {
    nodes: {
      [ROOT_ID]: { id: ROOT_ID, parentId: null, name: "", kind: FileKind.FOLDER, modifiedAt: now, sizeBytes: 0, trashedAt: null }
    },
    contents: {},
    desktop: {},
    clipboardId: null
  };
}

export function createFileSystem(initialState = createInitialState()) {
  let state = clone(initialState);

  function snapshot() {
    return clone(state);
  }

  function createFolder(name, parentId = ROOT_ID) {
    return createNode(name, parentId, FileKind.FOLDER, "");
  }

  function createText(name, parentId = ROOT_ID, text = "") {
    return createNode(name, parentId, FileKind.TEXT, text);
  }

  function createPaint(name, parentId = ROOT_ID, dataUrl = blankPaintDataUrl()) {
    return createNode(name, parentId, FileKind.PAINT, dataUrl);
  }

  function children(parentId = ROOT_ID) {
    requireLiveFolder(parentId);
    return Object.values(state.nodes).filter(node => node.parentId === parentId && isLive(node.id));
  }

  function trash() {
    return Object.values(state.nodes).filter(node => node.trashedAt);
  }

  function readText(id) {
    requireKind(id, FileKind.TEXT);
    return state.contents[id] || "";
  }

  function writeText(id, text) {
    const node = requireKind(id, FileKind.TEXT);
    state.contents[id] = String(text);
    state.nodes[id] = { ...node, modifiedAt: Date.now(), sizeBytes: byteSize(String(text)) };
    return clone(state.nodes[id]);
  }

  function readPaint(id) {
    requireKind(id, FileKind.PAINT);
    return state.contents[id] || blankPaintDataUrl();
  }

  function writePaint(id, dataUrl) {
    const node = requireKind(id, FileKind.PAINT);
    state.contents[id] = dataUrl;
    state.nodes[id] = { ...node, modifiedAt: Date.now(), sizeBytes: byteSize(dataUrl) };
    return clone(state.nodes[id]);
  }

  function rename(id, rawName) {
    protectRoot(id);
    const node = requireLiveNode(id);
    const name = prepareName(rawName, node.kind);
    ensureAvailable(node.parentId, name, id);
    state.nodes[id] = { ...node, name, modifiedAt: Date.now() };
    return clone(state.nodes[id]);
  }

  function copy(id) {
    protectRoot(id);
    requireLiveNode(id);
    state.clipboardId = id;
  }

  function paste(parentId = ROOT_ID) {
    const source = requireLiveNode(state.clipboardId || "");
    requireLiveFolder(parentId);
    if (isWithin(parentId, source.id)) throw new Error("COPY_INTO_SELF");
    let name = source.name;
    let number = 1;
    while (!isAvailable(parentId, name)) name = copyName(source, number++);
    const originals = subtree(source.id);
    const remap = new Map();
    for (const original of originals) {
      const id = crypto.randomUUID();
      remap.set(original.id, id);
      const parent = original.id === source.id ? parentId : remap.get(original.parentId);
      const next = { ...original, id, parentId: parent, name: original.id === source.id ? name : original.name, modifiedAt: Date.now(), trashedAt: null };
      state.nodes[id] = next;
      if (state.contents[original.id] !== undefined) state.contents[id] = state.contents[original.id];
    }
    return clone(state.nodes[remap.get(source.id)]);
  }

  function moveToTrash(id) {
    protectRoot(id);
    const node = requireLiveNode(id);
    state.nodes[id] = { ...node, trashedAt: Date.now(), modifiedAt: Date.now() };
    delete state.desktop[id];
    return clone(state.nodes[id]);
  }

  function restore(id, newName = null) {
    protectRoot(id);
    const node = state.nodes[id];
    if (!node) throw new Error("NOT_FOUND");
    if (!node.trashedAt) throw new Error("NOT_IN_TRASH");
    const parentId = state.nodes[node.parentId]?.kind === FileKind.FOLDER && isLive(node.parentId) ? node.parentId : ROOT_ID;
    const name = prepareName(newName || node.name, node.kind);
    ensureAvailable(parentId, name, id);
    state.nodes[id] = { ...node, parentId, name, trashedAt: null, modifiedAt: Date.now() };
    return clone(state.nodes[id]);
  }

  function deletePermanently(id) {
    protectRoot(id);
    const node = state.nodes[id];
    if (!node) throw new Error("NOT_FOUND");
    if (!node.trashedAt) throw new Error("NOT_IN_TRASH");
    for (const childId of subtreeIds(id)) {
      delete state.nodes[childId];
      delete state.contents[childId];
      delete state.desktop[childId];
    }
    if (state.clipboardId === id) state.clipboardId = null;
    return clone(node);
  }

  function emptyTrash() {
    const ids = Object.keys(state.nodes).filter(id => id !== ROOT_ID && !isLive(id));
    for (const id of ids) {
      delete state.nodes[id];
      delete state.contents[id];
      delete state.desktop[id];
    }
    if (ids.includes(state.clipboardId)) state.clipboardId = null;
    return ids.length;
  }

  function setDesktopPosition(id, x, y) {
    requireLiveNode(id);
    state.desktop[id] = { x, y };
  }

  function createNode(rawName, parentId, kind, content) {
    requireLiveFolder(parentId);
    const name = prepareName(rawName, kind);
    ensureAvailable(parentId, name);
    const id = crypto.randomUUID();
    const node = { id, parentId, name, kind, modifiedAt: Date.now(), sizeBytes: kind === FileKind.FOLDER ? 0 : byteSize(content), trashedAt: null };
    state.nodes[id] = node;
    if (kind !== FileKind.FOLDER) state.contents[id] = content;
    return clone(node);
  }

  function requireKind(id, kind) {
    const node = requireLiveNode(id);
    if (node.kind !== kind) throw new Error("WRONG_KIND");
    return node;
  }

  function requireLiveFolder(id) {
    const node = requireLiveNode(id);
    if (node.kind !== FileKind.FOLDER) throw new Error("NOT_A_FOLDER");
    return node;
  }

  function requireLiveNode(id) {
    const node = state.nodes[id];
    if (!node) throw new Error("NOT_FOUND");
    if (!isLive(id)) throw new Error("IN_TRASH");
    return node;
  }

  function isLive(id) {
    let current = id;
    while (current) {
      const node = state.nodes[current];
      if (!node || node.trashedAt) return false;
      current = node.parentId;
    }
    return true;
  }

  function isWithin(id, ancestorId) {
    let current = id;
    while (current) {
      if (current === ancestorId) return true;
      current = state.nodes[current]?.parentId;
    }
    return false;
  }

  function subtree(rootId) {
    const result = [];
    const pending = [state.nodes[rootId]];
    while (pending.length) {
      const current = pending.shift();
      result.push(current);
      pending.push(...Object.values(state.nodes).filter(node => node.parentId === current.id && isLive(node.id)));
    }
    return result;
  }

  function subtreeIds(rootId) {
    const ids = new Set();
    const pending = [rootId];
    while (pending.length) {
      const id = pending.shift();
      if (ids.has(id)) continue;
      ids.add(id);
      pending.push(...Object.values(state.nodes).filter(node => node.parentId === id).map(node => node.id));
    }
    return ids;
  }

  function isAvailable(parentId, name, exceptId = null) {
    const key = normalizeName(name);
    return !Object.values(state.nodes).some(node => node.parentId === parentId && isLive(node.id) && node.id !== exceptId && normalizeName(node.name) === key);
  }

  function ensureAvailable(parentId, name, exceptId = null) {
    if (!isAvailable(parentId, name, exceptId)) throw new Error("NAME_CONFLICT");
  }

  return {
    snapshot,
    children,
    trash,
    createFolder,
    createText,
    createPaint,
    readText,
    writeText,
    readPaint,
    writePaint,
    rename,
    copy,
    paste,
    moveToTrash,
    restore,
    deletePermanently,
    emptyTrash,
    setDesktopPosition
  };
}

export function displayName(node, showExtensions = true) {
  if (showExtensions || node.kind === FileKind.FOLDER) return node.name;
  return node.name.endsWith(extensionByKind[node.kind]) ? node.name.slice(0, -extensionByKind[node.kind].length) : node.name;
}

export function prepareName(rawName, kind) {
  const trimmed = String(rawName || "").trim();
  if (!trimmed || /[\\/:*?"<>|]/.test(trimmed)) throw new Error("INVALID_NAME");
  const extension = extensionByKind[kind];
  if (!extension || trimmed.toLowerCase().endsWith(extension)) return trimmed;
  return `${trimmed}${extension}`;
}

export function blankPaintDataUrl() {
  return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='600'%3E%3Crect width='800' height='600' fill='white'/%3E%3C/svg%3E";
}

function copyName(node, number) {
  const extension = extensionByKind[node.kind];
  const base = extension && node.name.toLowerCase().endsWith(extension) ? node.name.slice(0, -extension.length) : node.name;
  return `${base} - копія${number > 1 ? ` (${number})` : ""}${extension}`;
}

function normalizeName(name) {
  return name.trim().toLocaleLowerCase("uk-UA");
}

function byteSize(value) {
  return new TextEncoder().encode(value).length;
}

function protectRoot(id) {
  if (id === ROOT_ID) throw new Error("ROOT_PROTECTED");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

