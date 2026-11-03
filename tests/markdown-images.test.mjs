import test from "node:test";
import assert from "node:assert/strict";
import { assetPath, imageBasePlugin } from "../src/lib/markdown-images.mjs";
test("local image paths retain project Pages base while external URLs remain intact", () => {
  assert.equal(
    assetPath("/assets/images/a.png", "/blog/"),
    "/blog/assets/images/a.png",
  );
  assert.equal(
    assetPath("https://example.test/a.png", "/blog/"),
    "https://example.test/a.png",
  );
  const tree = {
    children: [{ tagName: "img", properties: { src: "/assets/images/a.png" } }],
  };
  imageBasePlugin("/blog/")()(tree);
  assert.equal(tree.children[0].properties.src, "/blog/assets/images/a.png");
});
