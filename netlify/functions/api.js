const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const storePath = path.join(__dirname, "..", "..", "data", "store.json");

let runtimeStore;

const initialStore = {
  residents: [
    {
      id: "r1",
      name: "佐藤 花子",
      age: 84,
      area: "中央町",
      family: "佐藤 健",
      careManager: "山田ケアマネ",
      status: "ok",
      reply: "元気",
      lastReply: "08:42",
      risk: "服薬確認",
      lineUserId: "",
    },
    {
      id: "r2",
      name: "鈴木 一郎",
      age: 79,
      area: "東町",
      family: "鈴木 真由美",
      careManager: "山田ケアマネ",
      status: "pending",
      reply: "未回答",
      lastReply: "-",
      risk: "独居",
      lineUserId: "",
    },
    {
      id: "r3",
      name: "田中 美代",
      age: 91,
      area: "南町",
      family: "田中 亮",
      careManager: "森ケアマネ",
      status: "alert",
      reply: "連絡希望",
      lastReply: "09:03",
      risk: "転倒注意",
      lineUserId: "",
    },
    {
      id: "r4",
      name: "高橋 勇",
      age: 87,
      area: "西町",
      family: "高橋 恵",
      careManager: "森ケアマネ",
      status: "ok",
      reply: "少し不調",
      lastReply: "08:55",
      risk: "血圧観察",
      lineUserId: "",
    },
  ],
  records: [
    {
      id: "rec1",
      residentId: "r4",
      type: "バイタル",
      body: "朝のLINEで少し不調。訪問時に血圧確認予定。",
      createdAt: "09:10",
    },
    {
      id: "rec2",
      residentId: "r1",
      type: "服薬",
      body: "朝薬は本人返信後に家族が確認済み。",
      createdAt: "08:50",
    },
  ],
  schedules: [
    { time: "10:00", residentId: "r3", staff: "訪問介護A", note: "連絡希望のため優先訪問" },
    { time: "11:30", residentId: "r4", staff: "看護師B", note: "血圧・食事量確認" },
    { time: "15:00", residentId: "r2", staff: "訪問介護C", note: "未回答なら家族へ電話後に訪問" },
  ],
};

const replyToStatus = {
  元気: "ok",
  少し不調: "ok",
  連絡希望: "alert",
};

exports.handler = async (event) => {
  try {
    const route = routeFromEvent(event);

    if (event.httpMethod === "GET" && route === "/api/state") {
      return json(await publicState(event));
    }

    if (event.httpMethod === "POST" && route === "/api/checkins/send") {
      const store = readStore();
      store.residents = store.residents.map((resident) => ({
        ...resident,
        status: "pending",
        reply: "未回答",
        lastReply: "-",
      }));
      await sendCheckinMessages(store.residents, event);
      return json(await publicState(event));
    }

    if (event.httpMethod === "POST" && route === "/api/escalations/run") {
      const store = readStore();
      const escalated = [];
      store.residents = store.residents.map((resident) => {
        if (resident.status !== "pending") return resident;
        escalated.push(resident);
        return { ...resident, status: "alert", reply: "未回答・要確認" };
      });
      await notifyEscalations(escalated);
      return json(await publicState(event));
    }

    if (event.httpMethod === "POST" && route === "/api/reply") {
      const body = parseBody(event);
      updateReply(body.residentId, body.reply, body.status);
      return json(await publicState(event));
    }

    if (event.httpMethod === "POST" && route === "/api/records") {
      const body = parseBody(event);
      const store = readStore();
      store.records.unshift({
        id: crypto.randomUUID(),
        residentId: body.residentId,
        type: body.type,
        body: body.body,
        createdAt: currentTime(),
      });
      return json(await publicState(event));
    }

    if (event.httpMethod === "POST" && route === "/line/webhook") {
      const rawBody = rawBodyFromEvent(event);
      if (!verifyLineSignature(event.headers || {}, rawBody)) {
        return json({ error: "Invalid signature" }, 401);
      }

      const body = rawBody ? JSON.parse(rawBody) : {};
      handleLineEvents(body.events || []);
      return json({ ok: true });
    }

    return json({ error: "Not found", route }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: "Internal server error" }, 500);
  }
};

async function publicState(event) {
  const publicBaseUrl = publicBaseUrlFromEvent(event);
  return {
    ...readStore(),
    integration: {
      lineConfigured: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN),
      liffConfigured: Boolean(process.env.LIFF_ID),
      liffId: process.env.LIFF_ID || "",
      liffUrl: publicBaseUrl,
      webhookPath: "/line/webhook",
    },
  };
}

function readStore() {
  if (!runtimeStore) {
    try {
      runtimeStore = JSON.parse(fs.readFileSync(storePath, "utf8"));
    } catch {
      runtimeStore = structuredClone(initialStore);
    }
  }
  return runtimeStore;
}

function routeFromEvent(event) {
  const explicitPath = event.queryStringParameters?.path;
  if (explicitPath) return explicitPath.startsWith("/") ? explicitPath : `/${explicitPath}`;

  const pathName = event.path || "/";
  if (pathName.includes("/.netlify/functions/api")) {
    const stripped = pathName.replace(/^.*\/\.netlify\/functions\/api/, "");
    return stripped || "/api/state";
  }
  return pathName;
}

function parseBody(event) {
  const rawBody = rawBodyFromEvent(event);
  return rawBody ? JSON.parse(rawBody) : {};
}

function rawBodyFromEvent(event) {
  if (!event.body) return "";
  return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
}

function verifyLineSignature(headers, rawBody) {
  const secret = process.env.LINE_CHANNEL_SECRET || "";
  if (!secret) return true;

  const signature = headerValue(headers, "x-line-signature");
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  const signatureBuffer = Buffer.from(signature || "");
  const digestBuffer = Buffer.from(digest);
  return signatureBuffer.length === digestBuffer.length && crypto.timingSafeEqual(signatureBuffer, digestBuffer);
}

function headerValue(headers, key) {
  const found = Object.keys(headers).find((header) => header.toLowerCase() === key.toLowerCase());
  return found ? headers[found] : "";
}

function handleLineEvents(events) {
  for (const event of events) {
    if (event.type === "postback") {
      const params = new URLSearchParams(event.postback?.data || "");
      const residentId = params.get("residentId");
      const reply = params.get("reply");
      if (residentId && reply) {
        updateReply(residentId, reply, replyToStatus[reply] || "ok");
      }
    }

    if (event.type === "follow" && event.source?.userId) {
      console.log(`LINE friend added userId=${event.source.userId}`);
    }
  }
}

function updateReply(residentId, reply, status) {
  const store = readStore();
  store.residents = store.residents.map((resident) => {
    if (resident.id !== residentId) return resident;
    return {
      ...resident,
      status: status || replyToStatus[reply] || "ok",
      reply,
      lastReply: status === "pending" ? "-" : currentTime(),
    };
  });
}

async function sendCheckinMessages(residents, event) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
  const targets = residents.filter((resident) => resident.lineUserId);
  if (!token || targets.length === 0) {
    console.log("LINE push skipped: token or resident lineUserId is not configured.");
    return;
  }

  await Promise.all(targets.map((resident) => pushLineMessage(token, resident.lineUserId, buildCheckinMessage(resident, event))));
}

async function notifyEscalations(residents) {
  if (residents.length === 0) return;
  console.log(`Escalation required: ${residents.map((resident) => resident.name).join(", ")}`);
}

function buildCheckinMessage(resident, event) {
  const manageUrl = publicBaseUrlFromEvent(event);
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
        {
          type: "uri",
          label: "管理画面を開く",
          uri: manageUrl,
        },
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

async function pushLineMessage(token, to, message) {
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages: [message] }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LINE push failed: ${response.status} ${body}`);
  }
}

function publicBaseUrlFromEvent(event) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const proto = headerValue(event.headers || {}, "x-forwarded-proto") || "https";
  const host = headerValue(event.headers || {}, "host") || "localhost";
  return `${proto}://${host}`;
}

function json(payload, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  };
}

function currentTime() {
  return new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}
