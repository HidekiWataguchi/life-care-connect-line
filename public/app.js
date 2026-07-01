const STORAGE_KEY = "life-care-connect-v2";

const fallbackState = {
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
  integration: {
    lineConfigured: false,
    liffConfigured: false,
    liffId: "",
    liffUrl: "",
    webhookPath: "/line/webhook",
  },
};

let state = structuredClone(fallbackState);
let apiOnline = false;

const statusLabels = {
  ok: "確認済み",
  pending: "未回答",
  alert: "要対応",
};

const replyStatus = {
  元気: "ok",
  少し不調: "ok",
  連絡希望: "alert",
};

const rolePermissions = {
  office: {
    nav: ["dashboard", "checkins", "records", "schedule", "roles"],
    canSend: true,
    canAddRecord: true,
    residentActions: ["ok", "remind", "call"],
  },
  manager: {
    nav: ["dashboard", "records", "schedule", "roles"],
    canSend: false,
    canAddRecord: false,
    residentActions: ["ok"],
  },
  family: {
    nav: ["dashboard", "schedule", "roles"],
    canSend: false,
    canAddRecord: false,
    residentActions: [],
  },
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  document.querySelector("#todayLabel").textContent = `本日 ${new Date().toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })}`;

  bindEvents();
  await loadState();
  await initLiff();
  render();
}

async function loadState() {
  try {
    const response = await fetch("/api/state");
    if (!response.ok) throw new Error("API unavailable");
    state = await response.json();
    apiOnline = true;
  } catch {
    const saved = localStorage.getItem(STORAGE_KEY);
    state = saved ? JSON.parse(saved) : structuredClone(fallbackState);
    apiOnline = false;
  }
}

async function saveState() {
  if (apiOnline) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function apiPost(path, payload = {}) {
  if (!apiOnline) return null;
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`${path} failed`);
  state = await response.json();
  return state;
}

async function initLiff() {
  const liffId = state.integration?.liffId;
  const liffLabel = document.querySelector("#liffLabel");
  if (!liffId || !window.liff) {
    liffLabel.textContent = state.integration?.liffConfigured ? "設定待ち" : "ローカル表示";
    return;
  }

  try {
    await window.liff.init({ liffId });
    liffLabel.textContent = window.liff.isInClient() ? "LINE内で起動中" : "外部ブラウザで起動中";
  } catch {
    liffLabel.textContent = "LIFF初期化エラー";
  }
}

function bindEvents() {
  document.querySelector("#modeResidentBtn").addEventListener("click", () => setMode("resident"));
  document.querySelector("#modeAdminBtn").addEventListener("click", () => setMode("admin"));
  document.querySelector("#goResidentView")?.addEventListener("click", () => setMode("resident"));

  document.querySelector("#residentSelect").addEventListener("change", renderResidentView);
  document.querySelector("#residentQuickReplies").addEventListener("click", onResidentQuickReply);
  document.querySelector("#goAdminAfterReply").addEventListener("click", () => {
    const residentId = document.querySelector("#residentSelect").value;
    goToAdminAndHighlight(residentId);
  });

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
      button.classList.add("active");
      document.querySelector(`#${button.dataset.view}`).classList.add("active");
    });
  });

  document.querySelector("#residentList").addEventListener("click", onResidentAction);
  document.querySelector("#runEscalation").addEventListener("click", runEscalation);
  document.querySelector("#sendCheckin").addEventListener("click", sendCheckin);
  document.querySelector("#roleFilter").addEventListener("change", () => {
    applyRolePermissions();
    renderResidents();
    showToast("表示範囲を切り替えました。");
  });
  document.querySelector("#recordForm").addEventListener("submit", addRecord);
}

function setMode(mode) {
  const isResident = mode === "resident";
  document.querySelector("#residentView").hidden = !isResident;
  document.querySelector("#adminView").hidden = isResident;
  document.querySelector("#modeResidentBtn").classList.toggle("active", isResident);
  document.querySelector("#modeAdminBtn").classList.toggle("active", !isResident);
  document.querySelector("#modeResidentBtn").setAttribute("aria-selected", String(isResident));
  document.querySelector("#modeAdminBtn").setAttribute("aria-selected", String(!isResident));
}

function goToAdminAndHighlight(residentId) {
  setMode("admin");
  const dashboardNav = document.querySelector('.nav-item[data-view="dashboard"]');
  if (dashboardNav && !dashboardNav.hidden) dashboardNav.click();

  requestAnimationFrame(() => {
    const card = document.querySelector(`.resident-card[data-id="${residentId}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("just-updated");
    window.setTimeout(() => card.classList.remove("just-updated"), 2000);
  });
}

function render() {
  renderIntegration();
  renderKpis();
  applyRolePermissions();
  renderResidents();
  renderEscalation();
  renderRecords();
  renderSchedules();
  renderResidentOptions();
  renderResidentView();
}

function currentPermissions() {
  const role = document.querySelector("#roleFilter").value;
  return rolePermissions[role] || rolePermissions.office;
}

function applyRolePermissions() {
  const permissions = currentPermissions();

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.hidden = !permissions.nav.includes(button.dataset.view);
  });

  const activeNav = document.querySelector(".nav-item.active");
  if (!activeNav || activeNav.hidden) {
    const fallback = document.querySelector(".nav-item:not([hidden])");
    if (fallback) fallback.click();
  }

  document.querySelector("#sendCheckin").hidden = !permissions.canSend;
  document.querySelector("#recordForm").hidden = !permissions.canAddRecord;
  const recordFormNote = document.querySelector("#recordFormNote");
  if (recordFormNote) recordFormNote.hidden = permissions.canAddRecord;
}

function renderIntegration() {
  document.querySelector("#lineModeLabel").textContent = state.integration?.lineConfigured
    ? "送信設定済み"
    : apiOnline
      ? "API接続中・LINE未設定"
      : "ローカル確認モード";
  document.querySelector("#webhookLabel").textContent = state.integration?.webhookPath || "/line/webhook";
}

function renderKpis() {
  document.querySelector("#answeredCount").textContent = state.residents.filter((r) => r.status === "ok").length;
  document.querySelector("#pendingCount").textContent = state.residents.filter((r) => r.status === "pending").length;
  document.querySelector("#alertCount").textContent = state.residents.filter((r) => r.status === "alert").length;
  document.querySelector("#visitCount").textContent = state.schedules.length;
}

function renderResidents() {
  const list = document.querySelector("#residentList");
  const role = document.querySelector("#roleFilter").value;
  const permissions = rolePermissions[role] || rolePermissions.office;
  list.innerHTML = "";

  state.residents.forEach((resident) => {
    const card = document.createElement("article");
    card.className = "resident-card";
    card.dataset.id = resident.id;
    const managerMeta = role === "family" ? "" : `<span class="pill">${resident.careManager}</span>`;
    const lineMeta = role === "office" ? `<span class="pill">${resident.lineUserId ? "LINE連携済み" : "LINE未連携"}</span>` : "";

    const actionButtons = [];
    if (permissions.residentActions.includes("ok")) {
      actionButtons.push(`<button type="button" data-action="ok" data-id="${resident.id}">確認済み</button>`);
    }
    if (permissions.residentActions.includes("remind")) {
      actionButtons.push(`<button type="button" data-action="remind" data-id="${resident.id}">再通知</button>`);
    }
    if (permissions.residentActions.includes("call")) {
      actionButtons.push(`<button type="button" data-action="call" data-id="${resident.id}">電話記録</button>`);
    }
    const actionsMarkup = actionButtons.length ? actionButtons.join("") : '<span class="pill">閲覧のみ</span>';

    card.innerHTML = `
      <div>
        <strong>${resident.name}さん ${resident.age}歳</strong>
        <div class="resident-meta">
          <span class="status ${resident.status}">${statusLabels[resident.status]}</span>
          <span class="pill">${resident.reply}</span>
          <span class="pill">${resident.lastReply}</span>
          <span class="pill">${resident.risk}</span>
          ${managerMeta}
          ${lineMeta}
        </div>
      </div>
      <div class="card-actions">
        ${actionsMarkup}
      </div>
    `;
    list.append(card);
  });
}

function renderEscalation() {
  const list = document.querySelector("#escalationList");
  const pendingNames = state.residents.filter((r) => r.status === "pending").map((r) => r.name);
  const alertNames = state.residents.filter((r) => r.status === "alert").map((r) => r.name);
  list.innerHTML = `
    <li><strong>08:30</strong><br>LINE公式アカウントから本人へボタン付き通知を送信</li>
    <li><strong>09:30</strong><br>未回答者へ自動再通知: ${pendingNames.join("、") || "対象なし"}</li>
    <li><strong>10:30</strong><br>要対応者を家族・ケアマネ・事業所へ通知: ${alertNames.join("、") || "対象なし"}</li>
    <li><strong>必要時</strong><br>LIFF URLからLINE内の管理画面を起動</li>
  `;
}

function renderRecords() {
  const list = document.querySelector("#recordList");
  list.innerHTML = "";
  state.records.forEach((record) => {
    const item = document.createElement("article");
    item.className = "record-item";
    item.innerHTML = `
      <div>
        <strong>${residentName(record.residentId)}さん / ${record.type}</strong>
        <p>${record.body}</p>
      </div>
      <span class="pill">${record.createdAt}</span>
    `;
    list.append(item);
  });
}

function renderSchedules() {
  const list = document.querySelector("#scheduleList");
  list.innerHTML = "";
  state.schedules.forEach((schedule) => {
    const item = document.createElement("article");
    item.className = "schedule-item";
    item.innerHTML = `
      <div>
        <strong>${schedule.time} ${residentName(schedule.residentId)}さん</strong>
        <p>${schedule.staff} / ${schedule.note}</p>
      </div>
      <span class="pill">訪問予定</span>
    `;
    list.append(item);
  });
}

function renderResidentOptions() {
  const select = document.querySelector("#recordResident");
  const selected = select.value;
  select.innerHTML = state.residents.map((resident) => `<option value="${resident.id}">${resident.name}</option>`).join("");
  select.value = selected || state.residents[0]?.id || "";
}

function renderResidentView() {
  const select = document.querySelector("#residentSelect");
  const previousValue = select.value;
  select.innerHTML = state.residents.map((resident) => `<option value="${resident.id}">${resident.name}さん</option>`).join("");
  select.value = state.residents.some((resident) => resident.id === previousValue)
    ? previousValue
    : state.residents[0]?.id || "";

  const resident = state.residents.find((item) => item.id === select.value);
  if (!resident) return;

  const answered = resident.status !== "pending";
  const quickReplies = document.querySelector("#residentQuickReplies");
  const replyBubble = document.querySelector("#residentReplyBubble");
  const replyText = document.querySelector("#residentReplyText");
  const hint = document.querySelector("#residentHint");
  const goAdminBtn = document.querySelector("#goAdminAfterReply");

  quickReplies.hidden = answered;
  quickReplies.querySelectorAll("button").forEach((button) => {
    button.disabled = answered;
  });
  goAdminBtn.hidden = !answered;

  if (answered) {
    replyBubble.hidden = false;
    replyText.textContent = resident.reply;
    hint.textContent = "回答ありがとうございます。ご家族・事業所に共有されました。";
  } else {
    replyBubble.hidden = true;
    hint.textContent = "ボタンをタップするだけで、ご家族と事業所に安否が伝わります。";
  }
}

function residentName(id) {
  return state.residents.find((resident) => resident.id === id)?.name ?? "不明";
}

async function setResidentStatus(id, status, reply) {
  if (apiOnline) {
    await apiPost("/api/reply", { residentId: id, reply, status });
    render();
    return;
  }

  const resident = state.residents.find((item) => item.id === id);
  if (!resident) return;
  resident.status = status;
  resident.reply = reply;
  resident.lastReply = status === "pending" ? "-" : currentTime();
  await saveState();
  render();
}

async function onResidentAction(event) {
  const button = event.target.closest("button");
  if (!button) return;
  const { action, id } = button.dataset;

  if (action === "ok") {
    await setResidentStatus(id, "ok", "確認済み");
    showToast("確認済みとして共有しました。");
  }
  if (action === "remind") {
    await setResidentStatus(id, "pending", "再通知済み");
    showToast("本人へLINE再通知を送信しました。");
  }
  if (action === "call") {
    await setResidentStatus(id, "alert", "電話対応中");
    showToast("事業所の電話対応ログを開始しました。");
  }
}

async function onResidentQuickReply(event) {
  const button = event.target.closest("button[data-reply]");
  if (!button || button.disabled) return;
  const select = document.querySelector("#residentSelect");
  const residentId = select.value || state.residents[0]?.id;
  if (!residentId) return;
  await simulateReply(residentId, button.dataset.reply);
}

async function sendCheckin() {
  try {
    if (apiOnline) {
      await apiPost("/api/checkins/send", { sendTime: document.querySelector("#sendTime").value });
    } else {
      state.residents = state.residents.map((resident) => ({
        ...resident,
        status: "pending",
        reply: "未回答",
        lastReply: "-",
      }));
      await saveState();
    }
    render();
    showToast("LINE公式アカウントから安否確認を送る処理を実行しました。");
  } catch {
    showToast("送信処理に失敗しました。LINE設定を確認してください。");
  }
}

async function runEscalation() {
  if (apiOnline) {
    await apiPost("/api/escalations/run");
  } else {
    state.residents = state.residents.map((resident) =>
      resident.status === "pending" ? { ...resident, status: "alert", reply: "未回答・要確認" } : resident,
    );
    await saveState();
  }
  render();
  showToast("未回答者を要対応へエスカレーションしました。");
}

async function simulateReply(residentId, reply) {
  await setResidentStatus(residentId, replyStatus[reply] || "ok", reply);
  showToast(`${residentName(residentId)}さんから「${reply}」の返信を受信しました。`);
}

async function addRecord(event) {
  event.preventDefault();
  const body = document.querySelector("#recordBody").value.trim();
  if (!body) {
    showToast("記録内容を入力してください。");
    return;
  }

  const record = {
    residentId: document.querySelector("#recordResident").value,
    type: document.querySelector("#recordType").value,
    body,
  };

  if (apiOnline) {
    await apiPost("/api/records", record);
  } else {
    state.records.unshift({
      id: crypto.randomUUID(),
      ...record,
      createdAt: currentTime(),
    });
    await saveState();
  }

  document.querySelector("#recordBody").value = "";
  render();
  showToast("介護記録を追加しました。");
}

function currentTime() {
  return new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2400);
}
