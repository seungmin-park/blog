import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTags, matchesRecord } from "../src/lib/note-filters.mjs";
test("tag filter checks assigned tags, not words in the body", () => {
  assert.equal(
    matchesRecord({ tags: ["개발"], search: "HTTP를 공부함" }, { tag: "HTTP" }),
    false,
  );
  assert.equal(
    matchesRecord(
      { tags: ["HTTP"], search: "캐시 기록" },
      { tag: "HTTP", query: "캐시" },
    ),
    true,
  );
  assert.equal(
    matchesRecord(
      { tags: ["HTTP"], search: "캐시 기록" },
      { tag: "HTTP", query: "다른 내용" },
    ),
    false,
  );
});
test("tag entry strips hash marks, whitespace and duplicates", () =>
  assert.deepEqual(normalizeTags(" #HTTP, 캐시, HTTP, , #캐시"), [
    "HTTP",
    "캐시",
  ]));
