import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/lib/editor-store.mjs";
const memory = () => {
  const values = new Map();
  return {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
  };
};
test("new drafts and switching preserve independent contents", () => {
  const store = createStore(memory());
  const a = store.create({ draft: { body: "A" } });
  const b = store.create({ draft: { body: "B" } });
  assert.notEqual(a.id, b.id);
  assert.equal(store.get(a.id).draft.body, "A");
  assert.equal(store.get(b.id).draft.body, "B");
});
test("another tab cannot silently overwrite a newer draft", () => {
  const storage = memory(),
    a = createStore(storage),
    b = createStore(storage);
  const note = a.create({ draft: { body: "first" } });
  a.save({ ...note, draft: { body: "new" } }, note.revision);
  assert.throws(
    () => b.save({ ...note, draft: { body: "stale" } }, note.revision),
    /다른/,
  );
  assert.equal(a.get(note.id).draft.body, "new");
});
test("damaged storage is not overwritten", () => {
  const storage = memory();
  storage.setItem("blog-editor-notes-v2", "broken");
  assert.throws(() => createStore(storage).create({}), /복구/);
  assert.equal(storage.getItem("blog-editor-notes-v2"), "broken");
});
test("discarding a local draft is recoverable", () => {
  const store = createStore(memory());
  const note = store.create({ draft: { body: "keep me" } });
  store.archive?.(note.id);
  assert.equal(store.list().length, 0);
  store.restore?.(note.id);
  assert.equal(store.get(note.id).draft.body, "keep me");
  assert.equal(store.list().length, 1);
});
