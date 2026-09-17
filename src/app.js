import { FileKind, ROOT_ID, blankPaintDataUrl, createFileSystem, displayName } from "./file-system.js";
import { loadState, resetState, saveState } from "./storage.js";

const app = document.querySelector("#app");
const fs = createFileSystem(loadState());
let activeWindow = null;
let contextMenu = null;
let showExtensions = true;

const icons = {
  thisPc: "▦",
  files: "▣",
  notepad: "✎",
  paint: "◒",
  trashEmpty: "♲",
  trashFull: "♻",
  folder: "▰",
  text: "≡",
  image: "▧"
};

function persist() {
  saveState(fs.snapshot());
  render();
}

function render() {
  const snapshot = fs.snapshot();
  const trashNotEmpty = Object.values(snapshot.nodes).some(node => node.trashedAt);
  app.innerHTML = "";
  app.append(desktop(snapshot, trashNotEmpty), taskbar());
  if (activeWindow) app.append(activeWindow);
  if (contextMenu) app.append(contextMenu);
}

function desktop(snapshot, trashNotEmpty) {
  const shell = el("main", { className: "desktop", oncontextmenu: event => openDesktopMenu(event) });
  const system = [
    { id: "this-pc", label: "Цей ПК", icon: icons.thisPc, y: 16, open: () => openExplorer(ROOT_ID, "Цей ПК") },
    { id: "my-files", label: "Мої файли", icon: icons.files, y: 116, open: () => openExplorer(ROOT_ID, "Мої файли") },
    { id: "notepad", label: "Блокнот", icon: icons.notepad, y: 216, open: () => openNotepad(null) },
    { id: "paint", label: "Paint", icon: icons.paint, y: 316, open: () => openPaint(null) },
    { id: "trash", label: "Кошик", icon: trashNotEmpty ? icons.trashFull : icons.trashEmpty, y: 416, open: () => openTrash() }
  ];
  for (const item of system) {
    shell.append(desktopIcon(item.label, item.icon, 16, item.y, item.open));
  }
  const desktopNodes = Object.values(snapshot.nodes).filter(node => node.parentId === ROOT_ID && !node.trashedAt && snapshot.desktop[node.id]);
  for (const node of desktopNodes) {
    const position = snapshot.desktop[node.id];
    shell.append(userIcon(node, position.x, position.y));
  }
  return shell;
}

function desktopIcon(label, icon, x, y, open) {
  const button = el("button", { className: "desktop-icon", style: `left:${x}px;top:${y}px`, ondblclick: open, onclick: clearMenu });
  button.append(el("span", { className: "icon-glyph", textContent: icon }), el("span", { className: "icon-label", textContent: label }));
  return button;
}

function userIcon(node, x, y) {
  const button = desktopIcon(displayName(node, showExtensions), iconFor(node), x, y, () => openNode(node));
  button.oncontextmenu = event => {
    event.preventDefault();
    showMenu(event.clientX, event.clientY, [
      ["Відкрити", () => openNode(node)],
      ["Копіювати", () => { fs.copy(node.id); persist(); }],
      ["Перейменувати", () => promptRename(node)],
      ["Видалити", () => confirmDelete(node)]
    ]);
  };
  return button;
}

function taskbar() {
  const bar = el("footer", { className: "taskbar" });
  const start = el("button", { className: "start-button", textContent: "Пуск", onclick: event => {
    showMenu(event.clientX, window.innerHeight - 180, [
      ["Мої файли", () => openExplorer(ROOT_ID, "Мої файли")],
      ["Блокнот", () => openNotepad(null)],
      ["Paint", () => openPaint(null)],
      ["Скинути навчальне сховище", () => {
        if (confirm("Очистити всі навчальні файли?")) {
          resetState();
          location.reload();
        }
      }]
    ]);
  }});
  bar.append(start, el("div", { className: "task-title", textContent: activeWindow?.dataset.title || "Windows Learning Desktop" }), el("time", { textContent: new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }) }));
  return bar;
}

function openDesktopMenu(event) {
  if (event.target.closest(".desktop-icon")) return;
  event.preventDefault();
  showMenu(event.clientX, event.clientY, [
    ["Нова папка", () => createOnDesktop(FileKind.FOLDER, event.clientX, event.clientY)],
    ["Новий текстовий документ", () => createOnDesktop(FileKind.TEXT, event.clientX, event.clientY)],
    ["Новий точковий рисунок", () => createOnDesktop(FileKind.PAINT, event.clientX, event.clientY)],
    ["Вставити", () => { tryAction(() => { const node = fs.paste(ROOT_ID); fs.setDesktopPosition(node.id, event.clientX, event.clientY); }); persist(); }]
  ]);
}

function createOnDesktop(kind, x, y) {
  const defaults = {
    [FileKind.FOLDER]: "Нова папка",
    [FileKind.TEXT]: "Новий текстовий документ",
    [FileKind.PAINT]: "Новий точковий рисунок"
  };
  const name = prompt("Ім'я", defaults[kind]);
  if (!name) return;
  tryAction(() => {
    const node = kind === FileKind.FOLDER ? fs.createFolder(name) : kind === FileKind.TEXT ? fs.createText(name) : fs.createPaint(name);
    fs.setDesktopPosition(node.id, x, y);
  });
  persist();
}

function openNode(node) {
  if (node.kind === FileKind.FOLDER) openExplorer(node.id, displayName(node, showExtensions));
  if (node.kind === FileKind.TEXT) openNotepad(node.id);
  if (node.kind === FileKind.PAINT) openPaint(node.id);
}

function openExplorer(parentId, title) {
  const body = el("div", { className: "explorer-body" });
  const toolbar = el("div", { className: "window-toolbar" });
  toolbar.append(
    el("button", { textContent: "Нова папка", onclick: () => createInFolder(FileKind.FOLDER, parentId) }),
    el("button", { textContent: "Текст", onclick: () => createInFolder(FileKind.TEXT, parentId) }),
    el("button", { textContent: "Paint", onclick: () => createInFolder(FileKind.PAINT, parentId) }),
    el("button", { textContent: "Вставити", onclick: () => { tryAction(() => fs.paste(parentId)); persist(); } })
  );
  const list = el("div", { className: "file-list" });
  const rows = fs.children(parentId);
  if (!rows.length) list.append(el("p", { className: "empty", textContent: "Ця папка порожня" }));
  for (const node of rows) list.append(fileRow(node));
  body.append(toolbar, list);
  openWindow(title, body);
}

function fileRow(node) {
  const row = el("button", { className: "file-row", ondblclick: () => openNode(node) });
  row.append(el("span", { className: "row-icon", textContent: iconFor(node) }), el("span", { textContent: displayName(node, showExtensions) }), el("span", { textContent: typeLabel(node) }), el("span", { textContent: formatSize(node.sizeBytes) }));
  row.oncontextmenu = event => {
    event.preventDefault();
    showMenu(event.clientX, event.clientY, [
      ["Відкрити", () => openNode(node)],
      ["Копіювати", () => { fs.copy(node.id); persist(); }],
      ["Перейменувати", () => promptRename(node)],
      ["Видалити", () => confirmDelete(node)]
    ]);
  };
  return row;
}

function openNotepad(id) {
  let node = id ? fs.snapshot().nodes[id] : null;
  const text = el("textarea", { className: "notepad-text", value: id ? fs.readText(id) : "" });
  const body = el("div", { className: "notepad" });
  const toolbar = el("div", { className: "window-toolbar" });
  toolbar.append(el("button", { textContent: "Зберегти", onclick: () => {
    tryAction(() => {
      if (node) fs.writeText(node.id, text.value);
      else node = fs.createText(prompt("Ім'я", "Новий текстовий документ") || "Новий текстовий документ", ROOT_ID, text.value);
    });
    persist();
  }}));
  body.append(toolbar, text);
  openWindow(node ? displayName(node, showExtensions) : "Блокнот", body);
}

function openPaint(id) {
  let node = id ? fs.snapshot().nodes[id] : null;
  const canvas = el("canvas", { className: "paint-canvas", width: 800, height: 520 });
  const ctx = canvas.getContext("2d");
  const image = new Image();
  image.onload = () => ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.src = id ? fs.readPaint(id) : blankPaintDataUrl();
  let drawing = false;
  let color = "#111111";
  let width = 5;
  canvas.onpointerdown = event => { drawing = true; ctx.beginPath(); ctx.moveTo(event.offsetX, event.offsetY); };
  canvas.onpointermove = event => {
    if (!drawing) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineTo(event.offsetX, event.offsetY);
    ctx.stroke();
  };
  canvas.onpointerup = () => { drawing = false; };
  const palette = ["#111111", "#d62828", "#1976d2", "#2e7d32", "#ffc107", "#7b1fa2", "#ff7a00", "#ffffff"];
  const body = el("div", { className: "paint" });
  const toolbar = el("div", { className: "window-toolbar paint-toolbar" });
  toolbar.append(el("button", { textContent: "Зберегти", onclick: () => {
    tryAction(() => {
      const dataUrl = canvas.toDataURL("image/png");
      if (node) fs.writePaint(node.id, dataUrl);
      else node = fs.createPaint(prompt("Ім'я", "Новий малюнок") || "Новий малюнок", ROOT_ID, dataUrl);
    });
    persist();
  }}), el("button", { textContent: "Очистити", onclick: () => { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height); } }));
  for (const swatch of palette) toolbar.append(el("button", { className: "swatch", style: `background:${swatch}`, title: swatch, onclick: () => { color = swatch; } }));
  toolbar.append(el("input", { type: "range", min: "2", max: "24", value: String(width), oninput: event => { width = Number(event.target.value); } }));
  body.append(toolbar, canvas);
  openWindow(node ? displayName(node, showExtensions) : "Paint", body);
}

function openTrash() {
  const body = el("div", { className: "explorer-body" });
  const toolbar = el("div", { className: "window-toolbar" });
  toolbar.append(el("button", { textContent: "Очистити кошик", onclick: () => { if (confirm("Назавжди видалити всі об'єкти з Кошика?")) { fs.emptyTrash(); persist(); openTrash(); } } }));
  const list = el("div", { className: "file-list" });
  const rows = fs.trash();
  if (!rows.length) list.append(el("p", { className: "empty", textContent: "Кошик порожній" }));
  for (const node of rows) {
    const row = el("button", { className: "file-row" });
    row.append(el("span", { className: "row-icon", textContent: iconFor(node) }), el("span", { textContent: displayName(node, showExtensions) }), el("span", { textContent: typeLabel(node) }), el("span", { textContent: "У кошику" }));
    row.oncontextmenu = event => {
      event.preventDefault();
      showMenu(event.clientX, event.clientY, [
        ["Відновити", () => { tryAction(() => fs.restore(node.id)); persist(); openTrash(); }],
        ["Видалити назавжди", () => { if (confirm(`Назавжди видалити "${displayName(node)}"?`)) { fs.deletePermanently(node.id); persist(); openTrash(); } }]
      ]);
    };
    list.append(row);
  }
  body.append(toolbar, list);
  openWindow("Кошик", body);
}

function createInFolder(kind, parentId) {
  const name = prompt("Ім'я", kind === FileKind.FOLDER ? "Нова папка" : kind === FileKind.TEXT ? "Новий текстовий документ" : "Новий малюнок");
  if (!name) return;
  tryAction(() => kind === FileKind.FOLDER ? fs.createFolder(name, parentId) : kind === FileKind.TEXT ? fs.createText(name, parentId) : fs.createPaint(name, parentId));
  persist();
  openExplorer(parentId, parentId === ROOT_ID ? "Мої файли" : displayName(fs.snapshot().nodes[parentId], showExtensions));
}

function openWindow(title, body) {
  activeWindow = el("section", { className: "window", dataset: { title } });
  activeWindow.append(el("header", { className: "window-title" }, el("strong", { textContent: title }), el("button", { className: "close-button", textContent: "×", onclick: () => { activeWindow = null; render(); } })), body);
  clearMenu();
  render();
}

function showMenu(x, y, items) {
  contextMenu = el("nav", { className: "context-menu", style: `left:${x}px;top:${Math.min(y, window.innerHeight - 220)}px` });
  for (const [label, action] of items) contextMenu.append(el("button", { textContent: label, onclick: () => { clearMenu(); action(); } }));
  render();
}

function clearMenu() {
  contextMenu = null;
}

function promptRename(node) {
  const name = prompt("Нове ім'я", displayName(node, showExtensions));
  if (!name) return;
  tryAction(() => fs.rename(node.id, name));
  persist();
}

function confirmDelete(node) {
  if (!confirm(`Перемістити "${displayName(node)}" до Кошика?`)) return;
  tryAction(() => fs.moveToTrash(node.id));
  persist();
}

function tryAction(action) {
  try {
    action();
  } catch (error) {
    alert(error.message || "Невідома помилка");
  }
}

function iconFor(node) {
  if (node.kind === FileKind.FOLDER) return icons.folder;
  if (node.kind === FileKind.PAINT) return icons.image;
  return icons.text;
}

function typeLabel(node) {
  if (node.kind === FileKind.FOLDER) return "Папка";
  if (node.kind === FileKind.PAINT) return "Малюнок PNG";
  return "Текстовий документ";
}

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} Б`;
  return `${Math.round(bytes / 1024)} КБ`;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (key === "className") node.className = value;
    else if (key === "textContent") node.textContent = value;
    else if (key === "style") node.setAttribute("style", value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

window.addEventListener("click", event => {
  if (!event.target.closest(".context-menu")) {
    contextMenu = null;
    document.querySelector(".context-menu")?.remove();
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js");
}

render();

