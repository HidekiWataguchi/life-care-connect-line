const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const rootDir = path.join(__dirname, "public");
const storePath = path.join(__dirname, "data", "store.json");
const port = Number(process.env.PORT || 4173);

const lineAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const lineChannelSecret = process.env.LINE_CHANNEL_SECRET || "";
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, "");
const liffId = process.env.LIFF_ID || "";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const replyToStatus = {
  元気: "ok",
  少し不調: "ok",
  連絡希望: "alert",
};

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/state") {
      return sendJson(response, await publicState());
    }

    if (request.method === "POST" && request.url === "/api/checkins/send") {
      const store = await readStore();
      store.residents = store.residents.map((resident) => ({
        ...resident,
        status: "pending",
        reply: "未回答",
        lastReply: "-",
      }));
      await writeStore(store);
      await sendCheckinMessages(store.residents);
      return sendJson(response, await publicState());
    }

    if (request.method === "POST" && request.url === "/api/escalations/run") {
      const store = await readStore();
      const escalated = [];
      store.residents = store.residents.map((resident) => {
        if (resident.status !== "pending") return resident;
        escalated.push(resident);
        return { ...resident, status: "alert", reply: "未回答・要確認" };
      });
      await writeStore(store);
      await notifyEscalations(escalated);
      return sendJson(response, await publicState());
    }

    if (request.method === "POST" && request.url === "/api/reply") {
      const body = await readJson(request);
      await updateReply(body.residentId, body.reply, body.status);
      return sendJson(response, await publicState());
    }

    if (request.method === "POST" && request.url === "/api/records") {
      const body = await readJson(request);
      const store = await readStore();
      store.records.unshift({
        id: crypto.randomUUID(),
        residentId: body.residentId,
        type: body.type,
        body: body.body,
        createdAt: currentTime(),
      });
      await writeStore(store);
      return sendJson(response, await publicState());
    }

    if (request.method === "POST" && request.url === "/line/webhook") {
      const rawBody = await readRawBody(request);
      if (!verifyLineSignature(request, rawBody)) {
        return sendJson(response, { error: "Invalid signature" }, 401);
      }

      const body = JSON.parse(rawBody || "{}");
      await handleLineEvents(body.events || []);
      return sendJson(response, { ok: true });
    }

    if (request.method === "GET") {
      return serveStatic(request, response);
    }

    sendJson(response, { error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    sendJson(response, { error: "Internal server error" }, 500);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`LIFEケアコネクト: http://127.0.0.1:${port}/`);
  console.log(`LINE Webhook: ${publicBaseUrl}/line/webhook`);
});

async function publicState() {
  const store = await readStore();
  return {
    ...store,
    integration: {
      lineConfigured: Boolean(lineAccessToken),
      liffConfigured: Boolean(liffId),
      liffId,
      liffUrl: publicBaseUrl,
      webhookPath: "/line/webhook",
    },
  };
}

async function readStore() {
  const text = await fs.readFile(storePath, "utf8");
  return JSON.parse(text);
}

async function writeStore(store) {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function serveStatic(request, response) {
  const url = new URL(request.url, "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(rootDir, pathname));

  if (!filePath.startsWith(rootDir)) {
    return sendJson(response, { error: "Forbidden" }, 403);
  }

  try {
    const data = await fs.readFile(filePath);
    const contentType = mimeTypes[path.extname(filePath)] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(data);
  } catch {
    sendJson(response, { error: "Not found" }, 404);
  }
}

async function readJson(request) {
  const raw = await readRawBody(request);
  return raw ? JSON.parse(raw) : {};
}

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Body too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function verifyLineSignature(request, rawBody) {
  if (!lineChannelSecret) return true;
  const signature = request.headers["x-line-signature"];
  const digest = crypto.createHmac("sha256", lineChannelSecret).update(rawBody).digest("base64");
  const signatureBuffer = Buffer.from(signature || "");
  const digestBuffer = Buffer.from(digest);
  return signatureBuffer.length === digestBuffer.length && crypto.timingSafeEqual(signatureBuffer, digestBuffer);
}

async function handleLineEvents(events) {
  for (const event of events) {
    if (event.type === "postback") {
      const params = new URLSearchParams(event.postback?.data || "");
      const residentId = params.get("residentId");
      const reply = params.get("reply");
      if (residentId && reply) {
        await updateReply(residentId, reply, replyToStatus[reply] || "ok");
      }
    }

    if (event.type === "follow" && event.source?.userId) {
      console.log(`LINE友だち追加 userId=${event.source.userId}`);
    }
  }
}

async function updateReply(residentId, reply, status) {
  const store = await readStore();
  store.residents = store.residents.map((resident) => {
    if (resident.id !== residentId) return resident;
    return {
      ...resident,
      status: status || replyToStatus[reply] || "ok",
      reply,
      lastReply: status === "pending" ? "-" : currentTime(),
    };
  });
  await writeStore(store);
}

async function sendCheckinMessages(residents) {
  const targets = residents.filter((resident) => resident.lineUserId);
  if (!lineAccessToken || targets.length === 0) {
    console.log("LINE送信はスキップ: LINE_CHANNEL_ACCESS_TOKENまたはlineUserIdが未設定です。");
    return;
  }

  await Promise.all(targets.map((resident) => pushLineMessage(resident.lineUserId, buildCheckinMessage(resident))));
}

async function notifyEscalations(residents) {
  if (residents.length === 0) return;
  console.log(`要対応: ${residents.map((resident) => resident.name).join("、")}`);
}

function buildCheckinMessage(resident) {
  return {
    type: "template",
    altText: "安否確認に返信してください",
    template: {
      type: "buttons",
      title: "本日の安否確認",
      text: `${resident.name}さん、今日の体調を教えてください。`,
      actions: [
        postbackAction(resident.id, "元気"),
        postbackAction(resident.id, "少し不調"),
        postbackAction(resident.id, "連絡希望"),
      ],
    },
  };
}

function postbackAction(residentId, reply) {
  return {
    type: "postback",
    label: reply,
    data: `residentId=${encodeURIComponent(residentId)}&reply=${encodeURIComponent(reply)}`,
    displayText: reply,
  };
}

async function pushLineMessage(to, message) {
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lineAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages: [message] }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LINE push failed: ${response.status} ${body}`);
  }
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function currentTime() {
  return new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}
