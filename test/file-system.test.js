import test from "node:test";
import assert from "node:assert/strict";
import { FileKind, ROOT_ID, createFileSystem, createInitialState, displayName } from "../src/file-system.js";

test("creates folders and text files with prepared extensions", () => {
  const fs = createFileSystem(createInitialState(1));
  const folder = fs.createFolder("Урок 1", ROOT_ID);
  const text = fs.createText("Нотатки", folder.id, "Привіт");

  assert.equal(text.name, "Нотатки.txt");
  assert.equal(fs.readText(text.id), "Привіт");
  assert.equal(fs.children(folder.id).length, 1);
});

test("rejects sibling name conflicts", () => {
  const fs = createFileSystem();
  fs.createText("План", ROOT_ID);
  assert.throws(() => fs.createText("план.txt", ROOT_ID), /NAME_CONFLICT/);
});

test("copy and paste clones a subtree", () => {
  const fs = createFileSystem();
  const folder = fs.createFolder("Папка", ROOT_ID);
  fs.createText("Файл", folder.id, "дані");
  fs.copy(folder.id);
  const copy = fs.paste(ROOT_ID);

  assert.equal(copy.kind, FileKind.FOLDER);
  assert.match(copy.name, /копія/);
  assert.equal(fs.children(copy.id).length, 1);
});

test("trash hides files until restore", () => {
  const fs = createFileSystem();
  const node = fs.createText("Чернетка", ROOT_ID, "x");
  fs.moveToTrash(node.id);

  assert.equal(fs.children(ROOT_ID).length, 0);
  assert.equal(fs.trash().length, 1);

  fs.restore(node.id);
  assert.equal(fs.children(ROOT_ID).length, 1);
});

test("permanent delete removes content", () => {
  const fs = createFileSystem();
  const node = fs.createPaint("Малюнок", ROOT_ID);
  fs.moveToTrash(node.id);
  fs.deletePermanently(node.id);

  assert.throws(() => fs.readPaint(node.id), /NOT_FOUND/);
});

test("display name can hide file extensions", () => {
  assert.equal(displayName({ name: "Файл.txt", kind: FileKind.TEXT }, false), "Файл");
  assert.equal(displayName({ name: "Папка", kind: FileKind.FOLDER }, false), "Папка");
});

