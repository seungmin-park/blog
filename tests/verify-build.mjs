import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const root = new URL("../src/content/posts/", import.meta.url);
const name = "verification-public";
const draft = "verification-private";
await mkdir(root, { recursive: true });
const markdown = (slug, status) =>
  `---\ntitle: "검증용 기록"\nslug: ${slug}\ndate: 2026-11-03\nstatus: ${status}\ntags: [HTTP, 캐시]\ncategory: 배운 것\nsummary: "검증용 요약"\ncommit: abcdef\n---\n\n## 기록\n\n![이미지](/assets/images/check.png)\n\n| 항목 | 값 |\n| --- | --- |\n| 캐시 | 재사용 |\n`;
try {
  await writeFile(new URL(name + ".md", root), markdown(name, "public"));
  await writeFile(new URL(draft + ".md", root), markdown(draft, "draft"));
  const result = spawnSync("npm", ["run", "build"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, BASE_PATH: "/blog/" },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(
      (result.stdout + result.stderr)
        .split("\n")
        .filter((l) => l.length < 400)
        .join("\n"),
    );
    process.exitCode = 1;
  } else {
    const home = await readFile(
      new URL("../dist/index.html", import.meta.url),
      "utf8",
    );
    assert.ok(home.includes("도토리 창고"));
    assert.ok(home.includes("/blog/posts/" + name + "/"));
    assert.ok(!home.includes(draft));
    const article = await readFile(
      new URL("../dist/posts/" + name + "/index.html", import.meta.url),
      "utf8",
    );
    assert.ok(article.includes('src="/blog/assets/images/check.png"'));
    assert.ok(article.includes("<table>"));
    assert.ok(article.includes("Pretendard") || home.includes("stylesheet"));
    console.log(
      "Built public list, private exclusion, project links, image base and GFM table verified.",
    );
  }
} finally {
  await unlink(new URL(name + ".md", root));
  await unlink(new URL(draft + ".md", root));
}
