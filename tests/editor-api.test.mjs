import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
const source = await readFile(
  new URL("../editor-api/src/index.js", import.meta.url),
  "utf8",
);
const {
  default: worker,
  putFile,
  validatePost,
  encryptSession,
} = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      source + "\nexport {putFile,validatePost,encryptSession};",
    ).toString("base64")
);
test("save uses the version the user loaded, never a newer version", async () => {
  const original = globalThis.fetch;
  let sent;
  let reads = 0;
  globalThis.fetch = async (_url, init = {}) => {
    if (init.method === "PUT") {
      sent = JSON.parse(init.body);
      return Response.json({ content: { sha: "saved" } });
    }
    reads++;
    return Response.json({ sha: "concurrent" });
  };
  try {
    await putFile(
      "token",
      { owner: "owner", name: "repo" },
      "note.md",
      "old edited text",
      "save",
      "loaded",
    );
    assert.equal(sent.sha, "loaded");
    assert.equal(reads, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test("new note creation never adopts an existing file version", async () => {
  const original = globalThis.fetch;
  let sent;
  globalThis.fetch = async (_url, init = {}) => {
    if (init.method === "PUT") {
      sent = JSON.parse(init.body);
      return Response.json({ content: { sha: "saved" } });
    }
    return Response.json({ sha: "someone-elses-file" });
  };
  try {
    await putFile(
      "token",
      { owner: "owner", name: "repo" },
      "note.md",
      "text",
      "save",
      null,
    );
    assert.equal("sha" in sent, false);
  } finally {
    globalThis.fetch = original;
  }
});
test("unfinished drafts can be saved without metadata or body", () => {
  const input = { status: "draft", slug: "draft-123" };
  assert.doesNotThrow(() => validatePost(input));
  assert.equal(input.title, "제목 없는 기록");
  assert.equal(input.body, "");
  assert.match(input.date, /^\d{4}-\d{2}-\d{2}$/);
});
test("publishing still requires title and content", () => {
  assert.throws(() =>
    validatePost({
      status: "public",
      slug: "note",
      date: "2026-11-03",
      title: "",
      body: "",
    }),
  );
});

const env = {
  GITHUB_CLIENT_ID: "test",
  GITHUB_CLIENT_SECRET: "test",
  SESSION_SECRET: "test-session-secret",
  ALLOWED_GITHUB_LOGIN: "owner",
  PUBLIC_REPO_OWNER: "owner",
  PUBLIC_REPO_NAME: "blog",
  PRIVATE_REPO_OWNER: "owner",
  PRIVATE_REPO_NAME: "drafts",
  EDITOR_ORIGIN: "https://blog.test",
  EDITOR_RETURN_URL: "https://blog.test/admin/",
};
const request = async (path, login = "owner", csrf = "correct") => {
  const encrypted = await encryptSession(
    {
      login,
      token: "test",
      csrf: "correct",
      exp: Math.floor(Date.now() / 1000) + 300,
    },
    env.SESSION_SECRET,
  );
  return new Request("https://api.test" + path, {
    method: "POST",
    headers: {
      Cookie: "editor_session=" + encrypted,
      Origin: env.EDITOR_ORIGIN,
      "X-CSRF-Token": csrf,
    },
  });
};
test("anonymous, other accounts and wrong CSRF cannot log out or write", async () => {
  assert.equal(
    (
      await worker.fetch(
        new Request("https://api.test/api/posts", { method: "POST" }),
        env,
      )
    ).status,
    401,
  );
  assert.equal(
    (await worker.fetch(await request("/api/logout", "other"), env)).status,
    403,
  );
  assert.equal(
    (await worker.fetch(await request("/api/logout", "owner", "wrong"), env))
      .status,
    403,
  );
});
test("logout expires the session cookie with matching security flags", async () => {
  const response = await worker.fetch(await request("/api/logout"), env);
  assert.equal(response.status, 200);
  const cookie = response.headers.get("Set-Cookie");
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /HttpOnly; Secure; SameSite=None/);
});
