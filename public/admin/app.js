const form = document.querySelector("#admin-login-form");
const password = document.querySelector("#admin-password");
const adminBox = document.querySelector("#admin-box");
const logout = document.querySelector("#admin-logout");
const refresh = document.querySelector("#admin-refresh");
const usersList = document.querySelector("#users-list");
const historyList = document.querySelector("#admin-history-list");
const tokenKey = "dml_admin_token";

function token() {
  return localStorage.getItem(tokenKey);
}

async function api(path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (token()) headers.authorization = `Bearer ${token()}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function setEmpty(container, text) {
  container.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = text;
  container.append(empty);
}

function renderUsers(users) {
  usersList.replaceChildren();
  if (!users.length) {
    setEmpty(usersList, "Chua co tai khoan khach.");
    return;
  }
  users.forEach((user) => {
    const row = document.createElement("article");
    row.className = "history-item";
    row.innerHTML = `
      <div>
        <h3>${user.email}</h3>
        <p>${user.provider || "email"} · login ${user.loginCount || 0} · phien ${user.conversationCount || 0}</p>
        <p class="preview">Lan cuoi: ${user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("vi-VN") : ""}</p>
      </div>
    `;
    usersList.append(row);
  });
}

function renderHistory(conversations) {
  historyList.replaceChildren();
  if (!conversations.length) {
    setEmpty(historyList, "Chua co lich su noi chuyen.");
    return;
  }
  conversations.forEach((item) => {
    const row = document.createElement("article");
    row.className = "history-item wide";
    const messages = (item.messages || []).slice(-8).map((message) => (
      `<p class="preview"><strong>${message.role === "translation" ? "Dich" : "Goc"}:</strong> ${message.text}</p>`
    )).join("");
    row.innerHTML = `
      <div>
        <h3>${item.title || "Phien dich"}</h3>
        <p>${item.user?.email || "unknown"} · ${new Date(item.updatedAt).toLocaleString("vi-VN")}</p>
        ${messages}
      </div>
    `;
    historyList.append(row);
  });
}

async function loadAdmin() {
  if (!token()) {
    form.classList.remove("hidden");
    adminBox.classList.add("hidden");
    setEmpty(usersList, "Dang nhap admin de xem.");
    setEmpty(historyList, "Dang nhap admin de xem.");
    return;
  }

  form.classList.add("hidden");
  adminBox.classList.remove("hidden");
  try {
    const [usersData, historyData] = await Promise.all([
      api("/api/admin/users"),
      api("/api/admin/history")
    ]);
    renderUsers(usersData.users || []);
    renderHistory(historyData.conversations || []);
  } catch (error) {
    setEmpty(usersList, error.message);
    setEmpty(historyList, error.message);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = await api("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ password: password.value })
  });
  localStorage.setItem(tokenKey, data.token);
  await loadAdmin();
});

logout.addEventListener("click", () => {
  localStorage.removeItem(tokenKey);
  loadAdmin();
});

refresh.addEventListener("click", loadAdmin);
loadAdmin();
