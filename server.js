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

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
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
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return;
  }

  const targetLanguage = requestBody.targetLanguage || "Vietnamese";
  const sourceLanguage = requestBody.sourceLanguage || "auto";
  const voice = requestBody.voice || "marin";
  const mode = requestBody.mode || "speech";

  const instructions = [
    "You are a live interpreter for a browser app.",
    `Source language: ${sourceLanguage}. Target language: ${targetLanguage}.`,
    "Translate the user's speech faithfully and naturally.",
    "Preserve names, numbers, units, dates, customs terms, and business details.",
    "If the input is unclear, translate the audible part and briefly mark uncertainty.",
    mode === "captions"
      ? "Return concise translated text captions. Do not speak unless explicitly asked."
      : "Speak the translation in the target language. Keep responses brief and do not add commentary."
  ].join(" ");

  try {
    const upstream = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: "gpt-realtime",
          instructions,
          audio: {
            input: {
              transcription: {
                model: "gpt-4o-transcribe"
              },
              turn_detection: {
                type: "server_vad",
                create_response: false,
                interrupt_response: true
              }
            },
            output: { voice }
          }
        }
      })
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      sendJson(res, upstream.status, {
        error: data.error?.message || "OpenAI could not create a client secret."
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
