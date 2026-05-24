const loginForm = document.querySelector("#login-form");
const emailInput = document.querySelector("#email");
const googleLogin = document.querySelector("#google-login");
const accountBox = document.querySelector("#account-box");
const accountEmail = document.querySelector("#account-email");
const logoutButton = document.querySelector("#logout-button");
const historyList = document.querySelector("#history-list");
const refreshHistory = document.querySelector("#refresh-history");

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
  historyList.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = text;
  historyList.append(empty);
}

function updateAccount() {
  const current = user();
  if (!current) {
    loginForm.classList.remove("hidden");
    accountBox.classList.add("hidden");
    setEmpty("Dang nhap de xem lich su.");
    return;
  }

  loginForm.classList.add("hidden");
  accountBox.classList.remove("hidden");
  accountEmail.textContent = current.email;
}

function renderHistory(conversations) {
  historyList.replaceChildren();
  if (!conversations.length) {
    setEmpty("Chua co phien dich nao duoc luu.");
    return;
  }

  conversations.forEach((item) => {
    const row = document.createElement("article");
    row.className = "history-item";
    row.innerHTML = `
      <div>
        <h3>${item.title || "Phien dich"}</h3>
        <p>${new Date(item.updatedAt).toLocaleString("vi-VN")} · ${item.messageCount || 0} dong</p>
        <p class="preview">${item.preview || ""}</p>
      </div>
      <button type="button" class="danger-button">Xoa</button>
    `;
    row.querySelector("button").addEventListener("click", async () => {
      await api(`/api/history/${item.id}`, { method: "DELETE" });
      await loadHistory();
    });
    historyList.append(row);
  });
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
  updateAccount();
});

refreshHistory.addEventListener("click", loadHistory);

updateAccount();
loadHistory();
