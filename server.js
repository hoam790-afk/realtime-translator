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

const domainPrompts = {
  logistics: [
    "Translate in the context of logistics, customs, import-export, manufacturing, bonded/export-processing enterprises, machinery, and customs documentation.",
    "Act as a professional Vietnamese, English, Chinese, Korean, and Japanese interpreter with 20 years of logistics and customs experience.",
    "Only return the translated meaning. Do not explain.",
    "Prioritize these terms when applicable:",
    "Thanh pho Ho Chi Minh / TPHCM = Ho Chi Minh City = 胡志明市",
    "TNHH = limited liability company = 责任有限公司",
    "DNCX = export processing enterprise / bonded enterprise = 保税企业",
    "XNK = import-export = 进出口; NK = import = 进口; XK = export = 出口",
    "HQ = customs = 海关; Chi cuc Hai quan = customs sub-department = 海关分局",
    "TKHQ / to khai hai quan / to khai = customs declaration = 报关单",
    "HS code = customs HS code = 海关编码",
    "NLVT = raw materials and supplies = 原材料",
    "BCQT = finalization report / settlement report = 结算报告",
    "HTK = inventory = 库存; nhap xuat ton = inventory in-out-balance = 进销存",
    "Dinh muc = bill of materials / usage norm = 用量表; hao hut = wastage rate = 损耗率",
    "Ton dau ky = opening stock = 期初库存; ton cuoi ky = closing stock = 期末库存",
    "Nhap trong ky = receipts during period = 本期进库; xuat trong ky = issues during period = 本期出库",
    "Sau thong quan = post-clearance = 通关后; kiem tra sau thong quan = post-clearance audit = 通关后检查",
    "Gia cong xuat khau = export processing = 加工出口; gia cong chuyen tiep = transfer processing = 转厂加工",
    "Xuat nhap khau tai cho = on-spot import-export = 转厂进出口",
    "Giay chung nhan dang ky kinh doanh = business registration certificate = 营业执照",
    "Giay phep dau tu / chung nhan dau tu = investment license/certificate = 投资执照",
    "BVMT = environmental protection = 环境保护; GTGT = VAT = 增值税; TTDB = special consumption tax = 特别消费税",
    "Chung tu = documents = 文件; phe lieu = scrap = 废料; phe thai = waste = 废弃物; phe pham = defective products = 废品"
  ].join("\n"),
  technical: [
    "Translate in the context of engineering, production, machinery, electronics, garment manufacturing, MSDS, COA, specifications, process control, and factory operations.",
    "Act as a professional technical interpreter with 20 years of manufacturing experience.",
    "Use accurate industry terminology and only return the translated result."
  ].join("\n"),
  legal: [
    "Translate in the context of legal, contracts, compliance, customs law, administrative violations, and regulatory documents.",
    "Act as a professional legal interpreter with 20 years of experience.",
    "Use precise legal terminology and only return the translated result."
  ].join("\n"),
  trade: [
    "Translate in the context of international trade, purchasing, sales, invoices, Incoterms, payments, banking, shipping, and customer negotiation.",
    "Act as a professional trade interpreter with 20 years of experience.",
    "Use natural business terminology and only return the translated result."
  ].join("\n"),
  general_specialist: [
    "Detect the topic and translate as a 20-year expert in that field, such as doctor, engineer, lawyer, technician, manufacturer, electronics specialist, garment specialist, logistics specialist, or customs specialist.",
    "Use the correct specialist terminology for the detected industry and only return the translated result."
  ].join("\n")
};

function buildTranscriptionPrompt(domainMode) {
  return domainPrompts[domainMode] || domainPrompts.logistics;
}

function buildTranslationSession(targetLanguage, transcriptionPrompt, includePrompt = true) {
  const transcription = { model: "gpt-realtime-whisper" };
  if (includePrompt) transcription.prompt = transcriptionPrompt;

  return {
    session: {
      model: "gpt-realtime-translate",
      audio: {
        input: {
          transcription,
          noise_reduction: { type: "near_field" }
        },
        output: { language: targetLanguage }
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

  const targetLanguage = languageMap[requestBody.targetLanguage] || "en";
  const transcriptionPrompt = buildTranscriptionPrompt(requestBody.domainMode);

  try {
    let upstream = await fetch("https://api.openai.com/v1/realtime/translations/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildTranslationSession(targetLanguage, transcriptionPrompt))
    });

    let data = await upstream.json().catch(() => ({}));
    const upstreamMessage = data.error?.message || "";
    if (!upstream.ok && /prompt|unknown parameter|unsupported/i.test(upstreamMessage)) {
      upstream = await fetch("https://api.openai.com/v1/realtime/translations/client_secrets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(buildTranslationSession(targetLanguage, transcriptionPrompt, false))
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
