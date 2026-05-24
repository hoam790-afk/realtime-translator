const loginForm = document.querySelector("#login-form");
const emailInput = document.querySelector("#email");
const googleLogin = document.querySelector("#google-login");
const accountBox = document.querySelector("#account-box");
const accountEmail = document.querySelector("#account-email");
const logoutButton = document.querySelector("#logout-button");
const historyCard = document.querySelector("#history-card");
const oneWayHistory = document.querySelector("#one-way-history");
const conversationHistory = document.querySelector("#conversation-history");
const refreshHistory = document.querySelector("#refresh-history");
const historyDetailCard = document.querySelector("#history-detail-card");
const historyDetail = document.querySelector("#history-detail");
const detailTitle = document.querySelector("#detail-title");
const closeDetail = document.querySelector("#close-detail");

const tokenKey = "dml_client_token";
const userKey = "dml_client_user";

function token() {
  return localStorage.getItem(tokenKey);
}

function user() {
  try {
    return JSON.parse(localStorage.getItem(userKey) || "null");
  } catch {
    return null;
  }
}

async function api(path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (token()) headers.authorization = `Bearer ${token()}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function setEmpty(text) {
  oneWayHistory.replaceChildren();
  conversationHistory.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = text;
  oneWayHistory.append(empty.cloneNode(true));
  conversationHistory.append(empty);
}

function updateAccount() {
  const current = user();
  if (!current) {
    loginForm.classList.remove("hidden");
    accountBox.classList.add("hidden");
    historyCard.classList.add("hidden");
    historyDetailCard.classList.add("hidden");
    return;
  }

  loginForm.classList.add("hidden");
  accountBox.classList.remove("hidden");
  historyCard.classList.remove("hidden");
  accountEmail.textContent = current.email;
}

function emptyNode(text) {
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = text;
  return empty;
}

function renderGroup(container, conversations, emptyText) {
  container.replaceChildren();
  if (!conversations.length) {
    container.append(emptyNode(emptyText));
    return;
  }

  conversations.forEach((item) => {
    const row = document.createElement("article");
    row.className = "history-item";
    row.innerHTML = `
      <div>
        <h3>${item.title || "Phiên dịch"}</h3>
        <p>${new Date(item.updatedAt).toLocaleString("vi-VN")} · ${item.messageCount || 0} dòng</p>
        <p class="preview">${item.preview || ""}</p>
      </div>
      <div class="history-actions">
        <button type="button" class="secondary-button" data-action="view">Xem</button>
        <button type="button" class="danger-button" data-action="delete">Xóa</button>
      </div>
    `;
    row.querySelector('[data-action="view"]').addEventListener("click", async () => {
      await openDetail(item.id);
    });
    row.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      await api(`/api/history/${item.id}`, { method: "DELETE" });
      historyDetailCard.classList.add("hidden");
      await loadHistory();
    });
    container.append(row);
  });
}

function renderHistory(conversations) {
  const oneWay = conversations.filter((item) => item.mode === "one-way");
  const twoWay = conversations.filter((item) => item.mode !== "one-way");
  renderGroup(oneWayHistory, oneWay, "Chưa có lịch sử dịch tự động.");
  renderGroup(conversationHistory, twoWay, "Chưa có lịch sử dịch 2 chiều.");
}

function renderMessageGroup(title, messages) {
  const section = document.createElement("section");
  section.className = "detail-group";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);

  if (!messages.length) {
    section.append(emptyNode("Chưa có nội dung."));
    return section;
  }

  messages.forEach((message) => {
    const item = document.createElement("p");
    item.className = "detail-message";
    item.textContent = message.text;
    section.append(item);
  });
  return section;
}

async function openDetail(id) {
  const data = await api(`/api/history/${id}`);
  const conversation = data.conversation;
  const messages = conversation.messages || [];
  const sourceMessages = messages.filter((message) => message.role !== "translation");
  const translationMessages = messages.filter((message) => message.role === "translation");

  detailTitle.textContent = conversation.title || "Chi tiết phiên dịch";
  historyDetail.replaceChildren(
    renderMessageGroup("Âm thanh vào", sourceMessages),
    renderMessageGroup("Bản dịch", translationMessages)
  );
  historyDetailCard.classList.remove("hidden");
  historyDetailCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadHistory() {
  if (!token()) {
    updateAccount();
    return;
  }
  try {
    const data = await api("/api/history");
    renderHistory(data.conversations || []);
  } catch (error) {
    setEmpty(error.message);
  }
}

async function login(provider) {
  const email = emailInput.value.trim();
  const data = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, provider })
  });
  localStorage.setItem(tokenKey, data.token);
  localStorage.setItem(userKey, JSON.stringify(data.user));
  updateAccount();
  await loadHistory();
  const next = new URLSearchParams(window.location.search).get("next");
  if (next && next.startsWith("/") && next !== "/license/") {
    window.location.href = next;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await login("email");
});

googleLogin.addEventListener("click", async () => {
  if (!emailInput.value.trim()) {
    emailInput.focus();
    return;
  }
  await login("google");
});

logoutButton.addEventListener("click", () => {
  localStorage.removeItem(tokenKey);
  localStorage.removeItem(userKey);
  historyCard.classList.add("hidden");
  historyDetailCard.classList.add("hidden");
  updateAccount();
});

refreshHistory.addEventListener("click", loadHistory);
closeDetail.addEventListener("click", () => historyDetailCard.classList.add("hidden"));

updateAccount();
loadHistory();
