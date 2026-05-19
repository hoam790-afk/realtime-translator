import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 3000);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
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
  Vietnamese: "Tiếng Việt",
  Chinese: "Tiếng Trung",
  Japanese: "Tiếng Nhật",
  Korean: "Tiếng Hàn"
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
    model: "gpt-realtime-2",
    instructions: buildConversationInstructions(myLanguage, partnerLanguage),
    output_modalities: speechOutput ? ["audio", "text"] : ["text"],
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
    if (!upstream.ok && /gpt-realtime-2|model/i.test(upstreamMessage)) {
      const fallback = buildConversationSession({ myLanguage, partnerLanguage, speechOutput });
      fallback.session.model = "gpt-realtime";
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

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
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
