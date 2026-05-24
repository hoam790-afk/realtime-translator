import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const dataDir = join(__dirname, "data");
const dbPath = join(dataDir, "app-db.json");
const port = Number(process.env.PORT || 3000);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png"
};

const languageMap = {
  English: "en",
  Vietnamese: "vi",
  Chinese: "zh",
  Japanese: "ja",
  Korean: "ko",
  en: "en",
  vi: "vi",
  zh: "zh",
  ja: "ja",
  ko: "ko"
};

const languageNames = {
  English: "English",
  Vietnamese: "Vietnamese",
  Chinese: "Chinese",
  Japanese: "Japanese",
  Korean: "Korean",
  en: "English",
  vi: "Vietnamese",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean"
};

const languageDisplayNames = {
  English: "English",
  Vietnamese: "Tieng Viet",
  Chinese: "Tieng Trung",
  Japanese: "Tieng Nhat",
  Korean: "Tieng Han"
};

function buildTranslationSession({
  sourceLanguage,
  targetLanguage,
  includeSourceLanguage = true
}) {
  const transcription = { model: "gpt-realtime-whisper" };
  if (includeSourceLanguage && sourceLanguage) transcription.language = sourceLanguage;

  const output = { language: targetLanguage };

  return {
    session: {
      model: "gpt-realtime-translate",
      audio: {
        input: {
          transcription,
          noise_reduction: { type: "near_field" }
        },
        output
      }
    }
  };
}

function buildConversationInstructions(myLanguage, partnerLanguage) {
  const myDisplay = languageDisplayNames[myLanguage] || myLanguage;
  const partnerDisplay = languageDisplayNames[partnerLanguage] || partnerLanguage;

  return [
    "You are a real-time interpreter for a two-person conversation.",
    `The user's language is ${myLanguage} (${myDisplay}).`,
    `The partner's language is ${partnerLanguage} (${partnerDisplay}).`,
    `If the speaker uses ${myLanguage}, translate the utterance into ${partnerLanguage}.`,
    `If the speaker uses ${partnerLanguage}, translate the utterance into ${myLanguage}.`,
    "If a speaker uses a different language, translate into the other conversation language that best helps the two people understand each other.",
    "Return only the translation. Do not explain, summarize, answer questions, add commentary, or mention what you are doing.",
    "Preserve numbers, names, company names, product names, HS codes, customs declaration numbers, invoice numbers, and logistics terms exactly when possible.",
    "Translate each completed spoken turn as fully as possible. Do not omit clauses."
  ].join("\n");
}

function buildConversationSession({ myLanguage, partnerLanguage, speechOutput }) {
  const session = {
    type: "realtime",
    model: "gpt-realtime",
    instructions: buildConversationInstructions(myLanguage, partnerLanguage),
    output_modalities: speechOutput ? ["audio"] : ["text"],
    audio: {
      input: {
        transcription: { model: "gpt-realtime-whisper" },
        noise_reduction: { type: "near_field" }
      }
    }
  };

  if (speechOutput) {
    session.audio.output = { voice: "marin" };
  }

  return { session };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function nowIso() {
  return new Date().toISOString();
}

function bearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function defaultDb() {
  return {
    users: [],
    sessions: [],
    loginHistory: [],
    conversations: []
  };
}

async function readDb() {
  try {
    return { ...defaultDb(), ...JSON.parse(await readFile(dbPath, "utf8")) };
  } catch {
    return defaultDb();
  }
}

async function writeDb(db) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dbPath, JSON.stringify(db, null, 2), "utf8");
}

async function authUser(req) {
  const token = bearerToken(req);
  if (!token) return null;
  const db = await readDb();
  const session = db.sessions.find((item) => item.token === token && item.role === "client");
  if (!session) return null;
  const user = db.users.find((item) => item.id === session.userId);
  return user ? { db, user, session } : null;
}

async function authAdmin(req) {
  const token = bearerToken(req);
  if (!token) return null;
  const db = await readDb();
  const session = db.sessions.find((item) => item.token === token && item.role === "admin");
  return session ? { db, session } : null;
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    provider: user.provider,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt
  };
}

async function createClientSecret(req, res) {
  if (!process.env.OPENAI_API_KEY) {
    sendJson(res, 500, {
      error: "Missing OPENAI_API_KEY. Set it before starting the server."
    });
    return;
  }

  let requestBody = {};
  try {
    requestBody = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return;
  }

  const sourceLanguage = requestBody.lockSourceLanguage ? languageMap[requestBody.sourceLanguage] : undefined;
  const targetLanguage = languageMap[requestBody.targetLanguage] || "en";
  const sessionConfig = {
    sourceLanguage,
    targetLanguage
  };

  try {
    let upstream = await fetch("https://api.openai.com/v1/realtime/translations/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildTranslationSession(sessionConfig))
    });

    let data = await upstream.json().catch(() => ({}));
    const upstreamMessage = data.error?.message || "";
    if (!upstream.ok && /language|unknown parameter|unsupported/i.test(upstreamMessage)) {
      upstream = await fetch("https://api.openai.com/v1/realtime/translations/client_secrets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(buildTranslationSession({
          ...sessionConfig,
          includeSourceLanguage: false
        }))
      });
      data = await upstream.json().catch(() => ({}));
    }

    if (!upstream.ok) {
      sendJson(res, upstream.status, {
        error: data.error?.message || "OpenAI could not create a translation client secret."
      });
      return;
    }

    sendJson(res, 200, data);
  } catch (error) {
    sendJson(res, 502, {
      error: `Could not reach OpenAI: ${error.message}`
    });
  }
}

async function createConversationClientSecret(req, res) {
  if (!process.env.OPENAI_API_KEY) {
    sendJson(res, 500, {
      error: "Missing OPENAI_API_KEY. Set it before starting the server."
    });
    return;
  }

  let requestBody = {};
  try {
    requestBody = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return;
  }

  const myLanguage = languageNames[requestBody.myLanguage] || "Vietnamese";
  const partnerLanguage = languageNames[requestBody.partnerLanguage] || "Chinese";
  const speechOutput = requestBody.mode !== "captions";

  try {
    let upstream = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildConversationSession({ myLanguage, partnerLanguage, speechOutput }))
    });

    let data = await upstream.json().catch(() => ({}));
    const upstreamMessage = data.error?.message || "";
    if (!upstream.ok && /gpt-realtime|model/i.test(upstreamMessage)) {
      const fallback = buildConversationSession({ myLanguage, partnerLanguage, speechOutput });
      fallback.session.model = "gpt-realtime-2";
      upstream = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(fallback)
      });
      data = await upstream.json().catch(() => ({}));
    }

    if (!upstream.ok && /voice|marin/i.test(data.error?.message || "")) {
      const fallback = buildConversationSession({ myLanguage, partnerLanguage, speechOutput });
      if (fallback.session.audio?.output) fallback.session.audio.output.voice = "alloy";
      upstream = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(fallback)
      });
      data = await upstream.json().catch(() => ({}));
    }

    if (!upstream.ok) {
      sendJson(res, upstream.status, {
        error: data.error?.message || "OpenAI could not create a conversation client secret."
      });
      return;
    }

    sendJson(res, 200, data);
  } catch (error) {
    sendJson(res, 502, {
      error: `Could not reach OpenAI: ${error.message}`
    });
  }
}

async function loginClient(req, res) {
  let requestBody = {};
  try {
    requestBody = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return;
  }

  const email = String(requestBody.email || "").trim().toLowerCase();
  const provider = requestBody.provider === "google" ? "google" : "email";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendJson(res, 400, { error: "Email khong hop le." });
    return;
  }

  const db = await readDb();
  let user = db.users.find((item) => item.email === email);
  if (!user) {
    user = {
      id: randomUUID(),
      email,
      provider,
      createdAt: nowIso(),
      lastLoginAt: nowIso()
    };
    db.users.push(user);
  } else {
    user.provider = provider;
    user.lastLoginAt = nowIso();
  }

  const session = {
    token: randomUUID(),
    role: "client",
    userId: user.id,
    createdAt: nowIso()
  };
  db.sessions.push(session);
  db.loginHistory.push({
    id: randomUUID(),
    userId: user.id,
    email,
    provider,
    at: nowIso(),
    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || ""
  });
  await writeDb(db);

  sendJson(res, 200, { token: session.token, user: publicUser(user) });
}

async function loginAdmin(req, res) {
  let requestBody = {};
  try {
    requestBody = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return;
  }

  if (requestBody.password !== "admin123") {
    sendJson(res, 401, { error: "Sai mat khau admin." });
    return;
  }

  const db = await readDb();
  const session = {
    token: randomUUID(),
    role: "admin",
    createdAt: nowIso()
  };
  db.sessions.push(session);
  await writeDb(db);
  sendJson(res, 200, { token: session.token, admin: true });
}

async function getMe(req, res) {
  const auth = await authUser(req);
  if (!auth) {
    sendJson(res, 401, { error: "Chua dang nhap." });
    return;
  }
  sendJson(res, 200, { user: publicUser(auth.user) });
}

function conversationSummary(conversation) {
  const messages = conversation.messages || [];
  return {
    id: conversation.id,
    title: conversation.title,
    mode: conversation.mode,
    settings: conversation.settings,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: messages.length,
    preview: messages.slice(-1)[0]?.text || ""
  };
}

async function listHistory(req, res) {
  const auth = await authUser(req);
  if (!auth) {
    sendJson(res, 401, { error: "Chua dang nhap." });
    return;
  }

  const conversations = auth.db.conversations
    .filter((item) => item.userId === auth.user.id)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map(conversationSummary);
  sendJson(res, 200, { conversations });
}

async function createHistory(req, res) {
  const auth = await authUser(req);
  if (!auth) {
    sendJson(res, 401, { error: "Chua dang nhap." });
    return;
  }

  const requestBody = await readJsonBody(req).catch(() => ({}));
  const conversation = {
    id: randomUUID(),
    userId: auth.user.id,
    title: String(requestBody.title || "Phien dich moi").slice(0, 120),
    mode: String(requestBody.mode || "conversation").slice(0, 40),
    settings: requestBody.settings || {},
    messages: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  auth.db.conversations.push(conversation);
  await writeDb(auth.db);
  sendJson(res, 200, { conversation: conversationSummary(conversation) });
}

async function addHistoryMessage(req, res, id) {
  const auth = await authUser(req);
  if (!auth) {
    sendJson(res, 401, { error: "Chua dang nhap." });
    return;
  }

  const conversation = auth.db.conversations.find((item) => item.id === id && item.userId === auth.user.id);
  if (!conversation) {
    sendJson(res, 404, { error: "Khong tim thay lich su." });
    return;
  }

  const requestBody = await readJsonBody(req).catch(() => ({}));
  const text = String(requestBody.text || "").trim();
  if (!text) {
    sendJson(res, 400, { error: "Noi dung rong." });
    return;
  }

  conversation.messages.push({
    id: randomUUID(),
    role: requestBody.role === "translation" ? "translation" : "source",
    text,
    at: nowIso()
  });
  if (conversation.messages.length === 1) conversation.title = text.slice(0, 80);
  conversation.updatedAt = nowIso();
  await writeDb(auth.db);
  sendJson(res, 200, { conversation: conversationSummary(conversation) });
}

async function getHistoryDetail(req, res, id) {
  const auth = await authUser(req);
  if (!auth) {
    sendJson(res, 401, { error: "Chua dang nhap." });
    return;
  }

  const conversation = auth.db.conversations.find((item) => item.id === id && item.userId === auth.user.id);
  if (!conversation) {
    sendJson(res, 404, { error: "Khong tim thay lich su." });
    return;
  }
  sendJson(res, 200, { conversation });
}

async function deleteHistory(req, res, id) {
  const auth = await authUser(req);
  if (!auth) {
    sendJson(res, 401, { error: "Chua dang nhap." });
    return;
  }

  auth.db.conversations = auth.db.conversations.filter((item) => !(item.id === id && item.userId === auth.user.id));
  await writeDb(auth.db);
  sendJson(res, 200, { ok: true });
}

async function listAdminUsers(req, res) {
  const auth = await authAdmin(req);
  if (!auth) {
    sendJson(res, 401, { error: "Chua dang nhap admin." });
    return;
  }

  const users = auth.db.users.map((user) => ({
    ...publicUser(user),
    loginCount: auth.db.loginHistory.filter((item) => item.userId === user.id).length,
    conversationCount: auth.db.conversations.filter((item) => item.userId === user.id).length
  }));
  sendJson(res, 200, { users, loginHistory: auth.db.loginHistory });
}

async function listAdminHistory(req, res) {
  const auth = await authAdmin(req);
  if (!auth) {
    sendJson(res, 401, { error: "Chua dang nhap admin." });
    return;
  }

  const conversations = auth.db.conversations
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map((conversation) => ({
      ...conversation,
      user: publicUser(auth.db.users.find((user) => user.id === conversation.userId) || {})
    }));
  sendJson(res, 200, { conversations });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/licent" || url.pathname === "/license") {
    url.pathname = "/license/";
  }

  const requestPath = url.pathname === "/" || url.pathname.endsWith("/")
    ? `${url.pathname}index.html`
    : url.pathname;
  const safePath = normalize(decodeURIComponent(requestPath).replace(/^\/+/, ""));
  const filePath = join(publicDir, safePath);

  if (safePath.startsWith("..") || !filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    const contentType = mimeTypes[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && req.url === "/api/realtime/client-secret") {
    await createClientSecret(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/realtime/conversation-client-secret") {
    await createConversationClientSecret(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/auth/login") {
    await loginClient(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/admin/login") {
    await loginAdmin(req, res);
    return;
  }

  if (req.method === "GET" && req.url === "/api/me") {
    await getMe(req, res);
    return;
  }

  if (req.method === "GET" && req.url === "/api/history") {
    await listHistory(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/history") {
    await createHistory(req, res);
    return;
  }

  const historyMessageMatch = url.pathname.match(/^\/api\/history\/([^/]+)\/messages$/);
  if (req.method === "POST" && historyMessageMatch) {
    await addHistoryMessage(req, res, historyMessageMatch[1]);
    return;
  }

  const historyDetailMatch = url.pathname.match(/^\/api\/history\/([^/]+)$/);
  if (req.method === "GET" && historyDetailMatch) {
    await getHistoryDetail(req, res, historyDetailMatch[1]);
    return;
  }

  if (req.method === "DELETE" && historyDetailMatch) {
    await deleteHistory(req, res, historyDetailMatch[1]);
    return;
  }

  if (req.method === "GET" && req.url === "/api/admin/users") {
    await listAdminUsers(req, res);
    return;
  }

  if (req.method === "GET" && req.url === "/api/admin/history") {
    await listAdminHistory(req, res);
    return;
  }

  if (req.method === "GET") {
    await serveStatic(req, res);
    return;
  }

  res.writeHead(405, { allow: "GET, POST" });
  res.end("Method not allowed");
});

server.listen(port, () => {
  console.log(`Realtime translator running at http://localhost:${port}`);
});
