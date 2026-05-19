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

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
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
