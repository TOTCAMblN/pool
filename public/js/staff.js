import {
  api,
  currentUser,
  showMessage,
  hideMessage,
  formatDateTime,
  el,
} from "./common.js";

const messageEl = document.querySelector("[data-message]");
const userNameEl = document.querySelector("[data-user-name]");

// ---------- Вкладки ----------

const tabs = document.querySelectorAll("[data-tab]");
const panels = document.querySelectorAll("[data-panel]");

const loaders = {
  overview: loadOverview,
  payments: loadPayments,
  schedule: loadSchedule,
  booking: loadBookingPanel,
  news: loadNewsPanel,
};

function switchTab(name) {
  for (const tab of tabs) {
    tab.classList.toggle("tab--active", tab.dataset.tab === name);
  }
  for (const panel of panels) {
    panel.hidden = panel.dataset.panel !== name;
  }
  hideMessage(messageEl);
  loaders[name]?.().catch((err) => showMessage(messageEl, err.message));
}

for (const tab of tabs) {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
}

async function loadOverview() {
  const data = await api("/api/staff/overview");

  const cardsEl = document.querySelector("[data-overview-cards]");
  cardsEl.replaceChildren();

  const stats = [
    [data.pendingPayments, "платежей ждут подтверждения"],
    [data.todaySessions.length, "занятий сегодня"],
    [data.activeMemberships, "активных абонементов"],
  ];

  for (const [value, label] of stats) {
    const card = el("div", "card card--stat");
    card.append(el("span", "stat-value", String(value)));
    card.append(el("span", "muted", label));
    cardsEl.append(card);
  }

  const todayEl = document.querySelector("[data-today]");
  todayEl.replaceChildren();

  if (data.todaySessions.length === 0) {
    todayEl.append(el("p", "muted", "На сегодня занятий не запланировано."));
    return;
  }

  todayEl.append(
    buildTable(
      ["Время", "Занятие", "Тренер", "Записано"],
      data.todaySessions.map((s) => [
        new Date(s.start_time).toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        s.service_name,
        s.trainer_name,
        `${s.booked_count} / ${s.capacity}`,
      ])
    )
  );
}

// ---------- Платежи ----------

async function loadPayments() {
  const { payments } = await api("/api/staff/payments");

  const container = document.querySelector("[data-payments]");
  container.replaceChildren();

  if (payments.length === 0) {
    container.append(el("p", "muted", "Нет платежей, ожидающих подтверждения."));
    return;
  }

  const table = el("table", "table");
  const thead = el("thead");
  const headRow = el("tr");
  for (const t of ["Код", "Клиент", "Абонемент", "Сумма", "Создан", ""]) {
    headRow.append(el("th", null, t));
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");

  for (const p of payments) {
    const row = el("tr");

    const refCell = el("td");
    refCell.append(el("code", "ref", p.reference));
    row.append(refCell);

    const clientCell = el("td");
    clientCell.append(el("div", null, p.client_name));
    clientCell.append(el("small", "muted", p.client_email));
    if (p.client_phone) clientCell.append(el("small", "muted", p.client_phone));
    row.append(clientCell);

    row.append(el("td", null, p.plan_name));
    row.append(el("td", "amount", `${Number(p.amount).toLocaleString("ru-RU")} ₽`));
    row.append(el("td", null, formatDateTime(p.created_at)));

    const actions = el("td", "actions");

    const confirmBtn = el("button", "btn btn--primary", "Подтвердить");
    confirmBtn.addEventListener("click", () => handlePayment(p.id, "confirm", row));
    actions.append(confirmBtn);

    const rejectBtn = el("button", "btn", "Отклонить");
    rejectBtn.addEventListener("click", () => handlePayment(p.id, "reject", row));
    actions.append(rejectBtn);

    row.append(actions);
    tbody.append(row);
  }

  table.append(tbody);
  container.append(table);
}

async function handlePayment(id, action, row) {
  if (action === "confirm" && !confirm("Перевод действительно поступил?")) return;

  for (const btn of row.querySelectorAll("button")) btn.disabled = true;
  hideMessage(messageEl);

  try {
    if (action === "confirm") {
      await api(`/api/staff/payments/${id}/confirm`, { method: "POST" });
      showMessage(messageEl, "Абонемент активирован", "success");
    } else {
      await api(`/api/staff/payments/${id}`, { method: "DELETE" });
      showMessage(messageEl, "Платёж отклонён", "success");
    }
  } catch (err) {
    showMessage(messageEl, err.message);
  }

  await loadPayments();
}

// ---------- Расписание ----------

async function loadSchedule() {
  const [{ services, trainers }, { sessions }] = await Promise.all([
    api("/api/staff/refs"),
    api("/api/sessions"),
  ]);

  const form = document.querySelector("[data-session-form]");
  const serviceSelect = form.elements.serviceId;
  const trainerSelect = form.elements.trainerId;

  serviceSelect.replaceChildren();
  trainerSelect.replaceChildren();

  serviceSelect.append(el("option", null, "Выберите…"));
  for (const s of services) {
    const option = el(
      "option",
      null,
      `${s.name} (${s.duration_minutes} мин, до ${s.capacity} чел.)`
    );
    option.value = s.id;
    serviceSelect.append(option);
  }

  trainerSelect.append(el("option", null, "Выберите…"));
  for (const t of trainers) {
    const option = el(
      "option",
      null,
      t.specialization ? `${t.name} — ${t.specialization}` : t.name
    );
    option.value = t.id;
    trainerSelect.append(option);
  }

  const container = document.querySelector("[data-schedule]");
  container.replaceChildren();

  if (sessions.length === 0) {
    container.append(el("p", "muted", "Расписание пусто."));
    return;
  }

  const table = el("table", "table");
  const thead = el("thead");
  const headRow = el("tr");
  for (const t of ["Занятие", "Тренер", "Время", "Записано", ""]) {
    headRow.append(el("th", null, t));
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");

  for (const s of sessions) {
    const row = el("tr");
    row.append(el("td", null, s.service_name));
    row.append(el("td", null, s.trainer_name ?? "—"));
    row.append(el("td", null, formatDateTime(s.start_time)));
    row.append(el("td", null, `${s.capacity - s.spots_left} / ${s.capacity}`));

    const actionCell = el("td");
    const deleteBtn = el("button", "btn", "Удалить");
    deleteBtn.addEventListener("click", () => deleteSession(s.id, deleteBtn));
    actionCell.append(deleteBtn);
    row.append(actionCell);

    tbody.append(row);
  }

  table.append(tbody);
  container.append(table);
}

document
  .querySelector("[data-session-form]")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideMessage(messageEl);

    const form = event.target;
    const data = Object.fromEntries(new FormData(form));

    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;

    try {
      await api("/api/staff/sessions", {
        method: "POST",
        body: JSON.stringify({
          serviceId: data.serviceId,
          trainerId: data.trainerId,
          startTime: new Date(data.startTime).toISOString(),
        }),
      });

      showMessage(messageEl, "Занятие добавлено", "success");
      form.reset();
      await loadSchedule();
    } catch (err) {
      showMessage(messageEl, err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });

async function deleteSession(id, button) {
  if (!confirm("Удалить занятие из расписания?")) return;

  button.disabled = true;
  try {
    await api(`/api/staff/sessions/${id}`, { method: "DELETE" });
    await loadSchedule();
  } catch (err) {
    showMessage(messageEl, err.message);
    button.disabled = false;
  }
}

// ---------- Запись клиента ----------

let selectedClient = null;
let searchTimer = null;

const searchInput = document.querySelector("[data-client-search]");
const resultsEl = document.querySelector("[data-client-results]");
const selectedEl = document.querySelector("[data-selected-client]");
const membershipSelect = document.querySelector("[data-client-membership]");

async function loadBookingPanel() {
  if (selectedClient) await renderBookingSessions();
}

searchInput?.addEventListener("input", () => {
  clearTimeout(searchTimer);

  const query = searchInput.value.trim();
  if (query.length < 2) {
    resultsEl.hidden = true;
    return;
  }

  searchTimer = setTimeout(async () => {
    try {
      const { clients } = await api(
        `/api/staff/clients?q=${encodeURIComponent(query)}`
      );
      renderResults(clients);
    } catch (err) {
      showMessage(messageEl, err.message);
    }
  }, 300);
});

function renderResults(clients) {
  resultsEl.replaceChildren();

  if (clients.length === 0) {
    resultsEl.append(el("li", "muted result-empty", "Никого не найдено"));
    resultsEl.hidden = false;
    return;
  }

  for (const client of clients) {
    const item = el("li");
    const button = el("button", "result-btn");
    button.append(el("strong", null, client.full_name));
    button.append(el("span", "muted", client.email));
    button.append(
      el(
        "span",
        "muted",
        client.memberships.length > 0
          ? `Активных абонементов: ${client.memberships.length}`
          : "Нет активного абонемента"
      )
    );
    button.addEventListener("click", () => selectClient(client));
    item.append(button);
    resultsEl.append(item);
  }

  resultsEl.hidden = false;
}

async function selectClient(client) {
  selectedClient = client;
  resultsEl.hidden = true;
  searchInput.value = "";

  document.querySelector("[data-client-name]").textContent = client.full_name;
  document.querySelector("[data-client-email]").textContent = client.email;

  membershipSelect.replaceChildren();

  for (const m of client.memberships) {
    const option = el(
      "option",
      null,
      `${m.plan_name} — ${m.visits_left === null ? "безлимит" : m.visits_left + " визитов"}`
    );
    option.value = m.id;
    membershipSelect.append(option);
  }

  selectedEl.hidden = false;
  await renderBookingSessions();
}

async function renderBookingSessions() {
  const container = document.querySelector("[data-booking-sessions]");
  container.replaceChildren();

  if (!selectedClient?.memberships.length) {
    container.append(
      el(
        "p",
        "muted",
        "У клиента нет активного абонемента — записать нельзя. Сначала оформите абонемент и подтвердите оплату."
      )
    );
    return;
  }

  const { sessions } = await api("/api/sessions");

  const table = el("table", "table");
  const thead = el("thead");
  const headRow = el("tr");
  for (const t of ["Занятие", "Тренер", "Время", "Мест", ""]) {
    headRow.append(el("th", null, t));
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");

  for (const s of sessions) {
    const row = el("tr");
    row.append(el("td", null, s.service_name));
    row.append(el("td", null, s.trainer_name ?? "—"));
    row.append(el("td", null, formatDateTime(s.start_time)));
    row.append(el("td", null, String(s.spots_left)));

    const actionCell = el("td");
    const button = el("button", "btn btn--primary", "Записать");
    button.disabled = s.spots_left <= 0;
    button.addEventListener("click", () => bookClient(s.id, button));
    actionCell.append(button);
    row.append(actionCell);

    tbody.append(row);
  }

  table.append(tbody);
  container.append(table);
}

async function bookClient(sessionId, button) {
  hideMessage(messageEl);
  button.disabled = true;

  try {
    await api("/api/staff/bookings", {
      method: "POST",
      body: JSON.stringify({
        clientId: selectedClient.id,
        sessionId,
        membershipId: membershipSelect.value,
      }),
    });

    showMessage(messageEl, `${selectedClient.full_name} записан(а)`, "success");

    const { clients } = await api(
      `/api/staff/clients?q=${encodeURIComponent(selectedClient.email)}`
    );
    if (clients[0]) await selectClient(clients[0]);
  } catch (err) {
    showMessage(messageEl, err.message);
    button.disabled = false;
  }
}

// ---------- Выход ----------

document.querySelector("[data-logout]")?.addEventListener("click", async () => {
  const result = await api("/api/logout", { method: "POST" });
  location.href = result.redirect;
});

// ---------- Старт ----------

function buildTable(headers, rows) {
  const table = el("table", "table");

  const thead = el("thead");
  const headRow = el("tr");
  for (const h of headers) headRow.append(el("th", null, h));
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");
  for (const cells of rows) {
    const row = el("tr");
    for (const cell of cells) row.append(el("td", null, String(cell)));
    tbody.append(row);
  }
  table.append(tbody);

  return table;
}

currentUser().then((user) => {
  if (user) userNameEl.textContent = user.fullName;
});

// ---------- Новости ----------

async function loadNewsPanel() {
  const { news } = await api("/api/staff/news");

  const container = document.querySelector("[data-news-list]");
  container.replaceChildren();

  if (news.length === 0) {
    container.append(el("p", "muted", "Новостей пока нет."));
    return;
  }

  const table = el("table", "table");
  const thead = el("thead");
  const headRow = el("tr");
  for (const t of ["Заголовок", "Автор", "Опубликована", ""]) {
    headRow.append(el("th", null, t));
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");

  for (const item of news) {
    const row = el("tr");
    row.append(el("td", null, item.title));
    row.append(el("td", null, item.author_name ?? "—"));
    row.append(el("td", null, formatDateTime(item.published_at)));

    const actionCell = el("td");
    const deleteBtn = el("button", "btn", "Удалить");
    deleteBtn.addEventListener("click", () => deleteNews(item.id, deleteBtn));
    actionCell.append(deleteBtn);
    row.append(actionCell);

    tbody.append(row);
  }

  table.append(tbody);
  container.append(table);
}

document
  .querySelector("[data-news-form]")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideMessage(messageEl);

    const form = event.target;
    const formData = new FormData(form);

    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;

    try {
      await api("/api/staff/news", { method: "POST", body: formData });
      showMessage(messageEl, "Новость опубликована", "success");
      form.reset();
      await loadNewsPanel();
    } catch (err) {
      showMessage(messageEl, err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });

async function deleteNews(id, button) {
  if (!confirm("Удалить новость?")) return;

  button.disabled = true;
  try {
    await api(`/api/staff/news/${id}`, { method: "DELETE" });
    await loadNewsPanel();
  } catch (err) {
    showMessage(messageEl, err.message);
    button.disabled = false;
  }
}

switchTab("overview");
