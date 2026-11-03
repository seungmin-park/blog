const GITHUB_API = 'https://api.github.com';
const SESSION_SECONDS = 60 * 60 * 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return corsResponse(request, env, new Response(null, { status: 204 }));

    try {
      if (url.pathname.startsWith('/api/') && request.headers.get('Origin') && request.headers.get('Origin') !== env.EDITOR_ORIGIN) throw new HttpError(403, 'Origin not allowed');
      let response;
      if (url.pathname === '/auth/login' && request.method === 'GET') response = await startLogin(request, env);
      else if (url.pathname === '/auth/callback' && request.method === 'GET') response = await finishLogin(request, env);
      else if (url.pathname === '/api/logout' && request.method === 'POST') { const session = await requireSession(request, env); verifyCsrf(request, session); response = json({ ok: true }); response.headers.set('Set-Cookie', cookie('editor_session', '', { maxAge: 0, sameSite: 'None', path: '/' })); }
      else if (url.pathname === '/api/session' && request.method === 'GET') response = await sessionInfo(request, env);
      else if (url.pathname === '/api/posts' && request.method === 'GET') response = await listPosts(request, env);
      else if (/^\/api\/posts\/(draft|public)\/[^/]+$/.test(url.pathname) && request.method === 'GET') response = await loadPost(request, env);
      else if (/^\/api\/posts\/(draft|public)\/[^/]+$/.test(url.pathname) && request.method === 'DELETE') response = await deletePost(request, env);
      else if (url.pathname === '/api/posts' && request.method === 'POST') response = await savePost(request, env);
      else if (url.pathname.startsWith('/api/images/') && request.method === 'GET') response = await readImage(request, env);
      else if (url.pathname === '/api/images' && request.method === 'POST') response = await saveImage(request, env);
      else response = json({ error: 'Not found' }, 404);
      return url.pathname.startsWith('/api/') ? corsResponse(request, env, response) : response;
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : 'Unexpected error';
      const response = json({ error: status === 500 ? 'Internal server error' : message }, status);
      return url.pathname.startsWith('/api/') ? corsResponse(request, env, response) : response;
    }
  },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function assertEnv(env) {
  const required = [
    'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET', 'ALLOWED_GITHUB_LOGIN',
    'PUBLIC_REPO_OWNER', 'PUBLIC_REPO_NAME', 'PRIVATE_REPO_OWNER', 'PRIVATE_REPO_NAME',
    'EDITOR_ORIGIN', 'EDITOR_RETURN_URL',
  ];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new HttpError(500, `Missing environment: ${missing.join(', ')}`);
}

async function startLogin(request, env) {
  assertEnv(env);
  const state = randomToken(24);
  const callback = new URL('/auth/callback', request.url);
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', callback.toString());
  authorize.searchParams.set('scope', 'repo read:user');
  authorize.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      'Set-Cookie': cookie('oauth_state', state, { maxAge: 600, sameSite: 'Lax', path: '/auth' }),
      'Cache-Control': 'no-store',
    },
  });
}

async function finishLogin(request, env) {
  assertEnv(env);
  const url = new URL(request.url);
  const expectedState = readCookie(request, 'oauth_state');
  const receivedState = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!code || !expectedState || !receivedState || !timingSafeEqual(expectedState, receivedState)) {
    throw new HttpError(400, 'Invalid OAuth state');
  }

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: new URL('/auth/callback', request.url).toString(),
    }),
  });
  const tokenResult = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenResult.access_token) throw new HttpError(401, 'GitHub login failed');

  const user = await githubRequest(tokenResult.access_token, '/user');
  if (user.login.toLocaleLowerCase() !== env.ALLOWED_GITHUB_LOGIN.toLocaleLowerCase()) {
    throw new HttpError(403, 'This GitHub account is not allowed');
  }

  const payload = {
    token: tokenResult.access_token,
    login: user.login,
    csrf: randomToken(24),
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  };
  const session = await encryptSession(payload, env.SESSION_SECRET);
  return new Response(null, {
    status: 302,
    headers: {
      Location: env.EDITOR_RETURN_URL,
      'Set-Cookie': cookie('editor_session', session, { maxAge: SESSION_SECONDS, sameSite: 'None', path: '/' }),
      'Cache-Control': 'no-store',
    },
  });
}

async function sessionInfo(request, env) {
  const session = await requireSession(request, env);
  return json({ login: session.login, csrf: session.csrf });
}

async function listPosts(request, env) {
  const session = await requireSession(request, env);
  const sources = [
    ['public', publicRepo(env), 'src/content/posts'],
    ['draft', privateRepo(env), 'draft'],
  ];
  const groups = await Promise.all(sources.map(async ([status, repo, path]) => {
    const entries = await getFile(session.token, repo, path);
    if (!Array.isArray(entries)) return [];
    return entries
      .filter((entry) => entry.type === 'file' && entry.name.endsWith('.md'))
      .map((entry) => ({ status, slug: entry.name.slice(0, -3), name: entry.name }));
  }));
  return json({ posts: groups.flat() });
}

async function loadPost(request, env) {
  const session = await requireSession(request, env);
  const match = new URL(request.url).pathname.match(/^\/api\/posts\/(draft|public)\/([^/]+)$/);
  if (!match) throw new HttpError(400, 'Invalid post path');
  const status = match[1];
  const slug = decodeURIComponent(match[2]);
  if (!/^[a-z0-9가-힣][a-z0-9가-힣-]{0,99}$/u.test(slug)) throw new HttpError(400, 'Invalid slug');
  const repo = status === 'public' ? publicRepo(env) : privateRepo(env);
  const path = status === 'public' ? `src/content/posts/${slug}.md` : `${status}/${slug}.md`;
  const file = await getFile(session.token, repo, path);
  if (!file?.content) throw new HttpError(404, 'Post not found');
  return json({
    post: parseMarkdown(base64ToString(file.content)),
    source: { status, slug, sha: file.sha },
  });
}

async function savePost(request, env) {
  const session = await requireSession(request, env);
  verifyCsrf(request, session);
  const input = await request.json();
  validatePost(input);
  const source = validateSource(input.source);
  const sourceRecord = source ? await loadSourceRecord(session.token, env, source) : null;
  const sourcePost = sourceRecord?.post;
  const publishedSlug = source?.status === 'public' ? source.slug : sourcePost?.publishedSlug || null;
  const publishedSha = source?.status === 'public' ? source.sha : sourcePost?.publishedSha || null;
  const aliases = Array.isArray(sourcePost?.aliases) ? sourcePost.aliases : [];

  await assertDestinationAvailable(session.token, env, input, source, publishedSlug);
  const publishedRecord = await assertPublishedVersion(session.token, env, publishedSlug, publishedSha);
  const aliasOwner = await findAliasOwner(session.token, env, input.slug);
  if (aliasOwner && aliasOwner !== publishedSlug && aliasOwner !== source?.slug) {
    throw new HttpError(409, `Slug is already used as a redirect by ${aliasOwner}`);
  }

  const nextAliases = input.status === 'public'
    ? [...new Set([...aliases, ...(publishedSlug && publishedSlug !== input.slug ? [publishedSlug] : [])])]
      .filter((slug) => slug !== input.slug)
    : aliases;
  nextAliases.forEach(validateSlug);

  const markdown = buildMarkdown(input, {
    aliases: nextAliases,
    publishedSlug: input.status === 'draft' ? publishedSlug : null,
    publishedSha: input.status === 'draft' ? publishedSha : null,
  });
  if (new TextEncoder().encode(markdown).byteLength > 1_000_000) throw new HttpError(413, 'Post is too large');

  let saved;
  const warnings = [];
  const cleanup = async (operation) => { try { await operation(); } catch { warnings.push('본문은 저장됐지만 이전 파일 정리가 끝나지 않았습니다. 목록에서 상태를 확인해 주세요.'); } };
  if (input.status === 'public') {
    await copyPrivateImagesToPublic(markdown, session.token, env);
    saved = await putFile(session.token, publicRepo(env), `src/content/posts/${input.slug}.md`, markdown, `publish: ${input.title}`, publishedSlug === input.slug ? publishedRecord?.sha ?? null : null);
    if (publishedSlug && publishedSlug !== input.slug && publishedRecord?.sha) {
      await cleanup(() => deleteFile(session.token, publicRepo(env), `src/content/posts/${publishedSlug}.md`, publishedRecord.sha, `rename: ${publishedSlug} -> ${input.slug}`));
    }
    if (source?.status === 'draft') {
      await cleanup(() => deleteFile(session.token, privateRepo(env), `draft/${source.slug}.md`, source.sha, `cleanup draft: ${input.title}`));
    }
  } else {
    saved = await putFile(session.token, privateRepo(env), `draft/${input.slug}.md`, markdown, `draft: ${input.title}`, source?.status === 'draft' && source.slug === input.slug ? source.sha : null);
    if (source?.status === 'draft' && source.slug !== input.slug) {
      await cleanup(() => deleteFile(session.token, privateRepo(env), `draft/${source.slug}.md`, source.sha, `rename draft: ${source.slug} -> ${input.slug}`));
    }
  }

  const sha = saved?.content?.sha;
  if (!sha) throw new HttpError(502, 'GitHub did not return the saved file SHA');
  return json({
    ok: true,
    warnings,
    source: { status: input.status, slug: input.slug, sha },
    publishedSlug: input.status === 'public' ? input.slug : publishedSlug,
  });
}

async function deletePost(request, env) {
  const session = await requireSession(request, env);
  verifyCsrf(request, session);
  const match = new URL(request.url).pathname.match(/^\/api\/posts\/(draft|public)\/([^/]+)$/);
  if (!match) throw new HttpError(400, 'Invalid post path');
  const status = match[1];
  const slug = decodeURIComponent(match[2]);
  validateSlug(slug);
  const input = await request.json().catch(() => ({}));
  const source = validateSource({ status, slug, sha: input.sha });
  const repo = status === 'public' ? publicRepo(env) : privateRepo(env);
  const path = status === 'public' ? `src/content/posts/${slug}.md` : `draft/${slug}.md`;
  const current = await getFile(session.token, repo, path);
  if (!current?.sha) throw new HttpError(404, 'Post not found');
  if (current.sha !== source.sha) throw new HttpError(409, 'Post changed after it was loaded. Reload before deleting.');
  await deleteFile(session.token, repo, path, current.sha, `delete ${status}: ${slug}`);
  return json({ ok: true, status, slug });
}

async function readImage(request, env) {
  const session = await requireSession(request, env);
  const name = decodeURIComponent(new URL(request.url).pathname.slice('/api/images/'.length));
  if (!/^[a-z0-9._-]+$/.test(name)) throw new HttpError(400, 'Invalid image name');
  const file = await getFile(session.token, privateRepo(env), `assets/images/${name}`);
  if (!file?.content) throw new HttpError(404, 'Image not found');
  const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, '')), c => c.charCodeAt(0));
  const ext = name.split('.').pop();
  const mime = {png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif'}[ext];
  if (!mime) throw new HttpError(415, 'Unsupported image preview');
  return new Response(bytes, {headers:{'Content-Type':mime,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});
}

async function saveImage(request, env) {
  const session = await requireSession(request, env);
  verifyCsrf(request, session);
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'Image file is required');
  if (!file.type.startsWith('image/')) throw new HttpError(415, 'Only images are allowed');
  if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image must be 5 MB or smaller');

  const safeName = file.name.toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const datedName = `${new Date().toISOString().slice(0, 10)}-${randomToken(4)}-${safeName || 'image'}`;
  const markdownPath = `/assets/images/${datedName}`;
  const content = arrayBufferToBase64(await file.arrayBuffer());
  await putBase64File(session.token, privateRepo(env), `assets/images/${datedName}`, content, `draft image: ${datedName}`);
  return json({ path: markdownPath });
}

function validatePost(input) {
  if (!input || typeof input !== 'object') throw new HttpError(400, 'Invalid post');
  if (!['draft', 'public'].includes(input.status)) throw new HttpError(400, 'Invalid status');
  validateSlug(input.slug);
  if (input.status === 'draft') {
    input.title = typeof input.title === 'string' && input.title.trim() ? input.title : '제목 없는 기록';
    input.body = typeof input.body === 'string' ? input.body : '';
    input.date ||= new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  input.category = typeof input.category === 'string' && input.category.trim() ? input.category : '미분류';
  input.summary = typeof input.summary === 'string' ? input.summary : '';
  for (const key of input.status === 'draft' ? ['title', 'date'] : ['title', 'date', 'body']) {
    if (typeof input[key] !== 'string' || !input[key].trim()) throw new HttpError(400, `${key} is required`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new HttpError(400, 'Invalid date');
}

function validateSlug(slug) {
  if (!/^[a-z0-9가-힣][a-z0-9가-힣-]{0,99}$/u.test(slug ?? '')) throw new HttpError(400, 'Invalid slug');
}

function validateSource(source) {
  if (!source || typeof source !== 'object') return null;
  if (!['draft', 'public'].includes(source.status)) throw new HttpError(400, 'Invalid source status');
  validateSlug(source.slug);
  if (!/^[a-f0-9]{40}$/i.test(source.sha ?? '')) throw new HttpError(400, 'Invalid source SHA');
  return { status: source.status, slug: source.slug, sha: source.sha };
}

function buildMarkdown(input, { aliases = [], publishedSlug = null, publishedSha = null } = {}) {
  const tags = String(input.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20);
  const lines = [
    '---',
    `title: ${JSON.stringify(input.title.trim())}`,
    `slug: ${JSON.stringify(input.slug)}`,
    `date: ${input.date}`,
    `updated: ${new Date().toISOString().slice(0, 10)}`,
    `status: ${input.status}`,
    ...(aliases.length ? [`aliases: ${JSON.stringify(aliases)}`] : []),
    ...(publishedSlug ? [`publishedSlug: ${JSON.stringify(publishedSlug)}`] : []),
    ...(publishedSha ? [`publishedSha: ${JSON.stringify(publishedSha)}`] : []),
    `tags: ${JSON.stringify(tags)}`,
    `category: ${JSON.stringify(input.category.trim())}`,
    ...(input.thumbnail ? [`thumbnail: ${JSON.stringify(String(input.thumbnail).trim())}`] : []),
    `summary: ${JSON.stringify(input.summary.trim())}`,
    'author: "박승민"',
    `commit: "${stableHash(`${input.slug}-${input.date}`)}"`,
    'featured: false',
    '---',
    '',
    input.body.trim(),
    '',
  ];
  return lines.join('\n');
}

function parseMarkdown(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new HttpError(422, 'Invalid front matter');
  const values = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    try { values[key] = JSON.parse(raw); }
    catch { values[key] = raw; }
  }
  return {
    title: String(values.title ?? ''),
    slug: String(values.slug ?? ''),
    date: String(values.date ?? ''),
    status: values.status === 'public' ? 'public' : 'draft',
    aliases: Array.isArray(values.aliases) ? values.aliases.filter((value) => typeof value === 'string') : [],
    publishedSlug: typeof values.publishedSlug === 'string' ? values.publishedSlug : '',
    publishedSha: typeof values.publishedSha === 'string' ? values.publishedSha : '',
    category: String(values.category ?? ''),
    tags: Array.isArray(values.tags) ? values.tags.join(', ') : String(values.tags ?? ''),
    summary: String(values.summary ?? ''),
    thumbnail: String(values.thumbnail ?? ''),
    body: match[2].trim(),
  };
}

async function loadSourceRecord(token, env, source) {
  const repo = source.status === 'public' ? publicRepo(env) : privateRepo(env);
  const path = source.status === 'public' ? `src/content/posts/${source.slug}.md` : `draft/${source.slug}.md`;
  const file = await getFile(token, repo, path);
  if (!file?.content) throw new HttpError(409, 'The loaded post no longer exists. Reload the post list.');
  if (file.sha !== source.sha) throw new HttpError(409, 'The post changed after it was loaded. Reload before saving.');
  return { file, post: parseMarkdown(base64ToString(file.content)) };
}

async function assertDestinationAvailable(token, env, input, source, publishedSlug) {
  const draftTarget = await getFile(token, privateRepo(env), `draft/${input.slug}.md`);
  const publicTarget = await getFile(token, publicRepo(env), `src/content/posts/${input.slug}.md`);

  if (input.status === 'draft') {
    const updatesLoadedDraft = source?.status === 'draft' && source.slug === input.slug && draftTarget?.sha === source.sha;
    if (draftTarget && !updatesLoadedDraft) throw new HttpError(409, 'Another draft already uses this slug.');
    if (publicTarget && publishedSlug !== input.slug) throw new HttpError(409, 'A published post already uses this slug.');
    return;
  }

  const updatesLoadedPublic = source?.status === 'public' && source.slug === input.slug && publicTarget?.sha === source.sha;
  const updatesDraftsPublicPost = source?.status === 'draft' && publishedSlug === input.slug;
  if (publicTarget && !updatesLoadedPublic && !updatesDraftsPublicPost) {
    throw new HttpError(409, 'A published post already uses this slug.');
  }
  const usesLoadedDraft = source?.status === 'draft' && source.slug === input.slug && draftTarget?.sha === source.sha;
  if (draftTarget && !usesLoadedDraft) throw new HttpError(409, 'Another draft already uses this slug. Load that draft before publishing.');
}

async function assertPublishedVersion(token, env, slug, expectedSha) {
  if (!slug) return null;
  const current = await getFile(token, publicRepo(env), `src/content/posts/${slug}.md`);
  if (!current?.sha) throw new HttpError(409, 'The published source no longer exists. Reload before saving.');
  if (expectedSha && current.sha !== expectedSha) {
    throw new HttpError(409, 'The published post changed after this draft was created. Reload before publishing.');
  }
  return current;
}

async function findAliasOwner(token, env, slug) {
  const entries = await getFile(token, publicRepo(env), 'src/content/posts');
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    if (entry.type !== 'file' || !entry.name.endsWith('.md')) continue;
    const file = await getFile(token, publicRepo(env), `src/content/posts/${entry.name}`);
    if (!file?.content) continue;
    const post = parseMarkdown(base64ToString(file.content));
    if (post.aliases.includes(slug)) return post.slug;
  }
  return null;
}

async function copyPrivateImagesToPublic(markdown, token, env) {
  const matches = [...markdown.matchAll(/\/assets\/images\/([a-z0-9][a-z0-9._-]*)/gi)].map((match) => match[1]);
  for (const name of [...new Set(matches)]) {
    const source = await getFile(token, privateRepo(env), `assets/images/${name}`);
    if (source?.content) {
      await putBase64File(token, publicRepo(env), `public/assets/images/${name}`, source.content.replace(/\n/g, ''), `publish image: ${name}`);
    }
  }
}

async function requireSession(request, env) {
  assertEnv(env);
  const encrypted = readCookie(request, 'editor_session');
  if (!encrypted) throw new HttpError(401, 'GitHub login required');
  const session = await decryptSession(encrypted, env.SESSION_SECRET).catch(() => null);
  if (!session || session.exp < Math.floor(Date.now() / 1000)) throw new HttpError(401, 'Session expired');
  if (session.login.toLocaleLowerCase() !== env.ALLOWED_GITHUB_LOGIN.toLocaleLowerCase()) throw new HttpError(403, 'Account not allowed');
  return session;
}

function verifyCsrf(request, session) {
  const received = request.headers.get('X-CSRF-Token') ?? '';
  if (!received || !timingSafeEqual(received, session.csrf)) throw new HttpError(403, 'Invalid CSRF token');
}

async function githubRequest(token, path, init = {}) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'seungmin-park-editor',
      ...(init.headers ?? {}),
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new HttpError(response.status, `GitHub API error (${response.status})`);
  return response.status === 204 ? null : response.json();
}

async function getFile(token, repo, path) {
  return githubRequest(token, `/repos/${repo.owner}/${repo.name}/contents/${encodePath(path)}`);
}

async function putFile(token, repo, path, value, message, expectedSha) {
  return putBase64File(token, repo, path, stringToBase64(value), message, expectedSha);
}

async function putBase64File(token, repo, path, content, message, expectedSha) {
  const sha = expectedSha === undefined ? (await getFile(token, repo, path))?.sha : expectedSha;
  return githubRequest(token, `/repos/${repo.owner}/${repo.name}/contents/${encodePath(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content, ...(sha ? { sha } : {}) }),
  });
}

async function deleteFile(token, repo, path, sha, message) {
  await githubRequest(token, `/repos/${repo.owner}/${repo.name}/contents/${encodePath(path)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha }),
  });
}

const publicRepo = (env) => ({ owner: env.PUBLIC_REPO_OWNER, name: env.PUBLIC_REPO_NAME });
const privateRepo = (env) => ({ owner: env.PRIVATE_REPO_OWNER, name: env.PRIVATE_REPO_NAME });
const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

async function encryptSession(value, secret) {
  const key = await sessionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return `${base64Url(iv)}.${base64Url(new Uint8Array(encrypted))}`;
}

async function decryptSession(value, secret) {
  const [ivValue, encryptedValue] = value.split('.');
  if (!ivValue || !encryptedValue) throw new Error('Invalid session');
  const key = await sessionKey(secret);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(ivValue) },
    key,
    fromBase64Url(encryptedValue),
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}

async function sessionKey(secret) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function corsResponse(request, env, response) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== env.EDITOR_ORIGIN) return json({ error: 'Origin not allowed' }, 403);
  const headers = new Headers(response.headers);
  if (origin === env.EDITOR_ORIGIN) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  headers.set('Vary', 'Origin');
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function cookie(name, value, { maxAge, sameSite, path }) {
  return `${name}=${value}; Max-Age=${maxAge}; Path=${path}; HttpOnly; Secure; SameSite=${sameSite}`;
}

function readCookie(request, name) {
  const cookies = request.headers.get('Cookie') ?? '';
  const match = cookies.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : '';
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function stableHash(value) {
  let hash = 0;
  for (const character of value) hash = (Math.imul(31, hash) + character.charCodeAt(0)) | 0;
  return Math.abs(hash).toString(16).slice(0, 6).padStart(6, '0');
}

function randomToken(bytes) {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function base64Url(bytes) {
  return arrayBufferToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function arrayBufferToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function stringToBase64(value) {
  return arrayBufferToBase64(new TextEncoder().encode(value));
}

function base64ToString(value) {
  const binary = atob(value.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}
