import {
  api,
  currentUser,
  showMessage,
  hideMessage,
  formatDateTime,
  el,
} from "./common.js";

const membershipsEl = document.querySelector("[data-memberships]");
const membershipSelect = document.querySelector("[data-membership-select]");
const sessionsEl = document.querySelector("[data-sessions]");
const bookingsEl = document.querySelector("[data-bookings]");
const messageEl = document.querySelector("[data-message]");
const userNameEl = document.querySelector("[data-user-name]");

let memberships = [];

// ---------- Загрузка ----------

async function loadUser() {
  const user = await currentUser();
  if (user) userNameEl.textContent = user.fullName;
}

async function loadMemberships() {
  const { memberships: list } = await api("/api/memberships");
  memberships = list;

  membershipsEl.replaceChildren();
  membershipSelect.replaceChildren();

  if (list.length === 0) {
    membershipsEl.append(
      el("p", "muted", "У вас нет активного абонемента. Оформите его на ресепшене или в разделе абонементов.")
    );
    membershipSelect.disabled = true;
    return;
  }

  membershipSelect.disabled = false;

  for (const m of list) {
    const card = el("div", "card");
    card.append(el("strong", null, m.plan_name));
    card.append(
      el(
        "span",
        null,
        m.visits_left === null ? "Безлимит" : `Осталось визитов: ${m.visits_left}`
      )
    );
    card.append(
      el("small", "muted", `Действует до ${new Date(m.end_date).toLocaleDateString("ru-RU")}`)
    );
    membershipsEl.append(card);

    const option = el(
      "option",
      null,
      `${m.plan_name} — ${m.visits_left === null ? "безлимит" : m.visits_left + " визитов"}`
    );
    option.value = m.id;
    membershipSelect.append(option);
  }
}

async function loadSessions() {
  const { sessions } = await api("/api/sessions");

  sessionsEl.replaceChildren();

  if (sessions.length === 0) {
    sessionsEl.append(el("p", "muted", "Расписание пока не заполнено."));
    return;
  }

  const table = el("table", "table");
  const thead = el("thead");
  const headRow = el("tr");
  for (const title of ["Занятие", "Тренер", "Время", "Мест", ""]) {
    headRow.append(el("th", null, title));
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");

  for (const s of sessions) {
    const row = el("tr");
    row.append(el("td", null, s.service_name));
    row.append(el("td", null, s.trainer_name ?? "—"));
    row.append(el("td", null, formatDateTime(s.start_time)));
    row.append(
      el("td", s.spots_left <= 0 ? "danger" : null,
        s.spots_left <= 0 ? "нет мест" : String(s.spots_left))
    );

    const actionCell = el("td");
    const button = el("button", "btn btn--primary", "Записаться");
    button.disabled = s.spots_left <= 0 || memberships.length === 0;
    button.addEventListener("click", () => book(s.id, button));
    actionCell.append(button);
    row.append(actionCell);

    tbody.append(row);
  }

  table.append(tbody);
  sessionsEl.append(table);
}

async function loadBookings() {
  const { bookings } = await api("/api/bookings");

  bookingsEl.replaceChildren();

  const active = bookings.filter((b) => b.status === "booked");

  if (active.length === 0) {
    bookingsEl.append(el("p", "muted", "Активных записей нет."));
    return;
  }

  const list = el("ul", "list");

  for (const b of active) {
    const item = el("li", "list-item");

    const info = el("div", "list-item-info");
    info.append(el("strong", null, b.service_name));
    info.append(el("span", null, formatDateTime(b.start_time)));
    info.append(el("span", "muted", `Тренер: ${b.trainer_name ?? "—"}`));
    item.append(info);

    const cancelBtn = el("button", "btn", "Отменить");
    cancelBtn.addEventListener("click", () => cancel(b.id, cancelBtn));
    item.append(cancelBtn);

    list.append(item);
  }

  bookingsEl.append(list);
}

// ---------- Действия ----------

async function book(sessionId, button) {
  hideMessage(messageEl);

  const membershipId = membershipSelect.value;
  if (!membershipId) {
    return showMessage(messageEl, "Сначала выберите абонемент");
  }

  button.disabled = true;

  try {
    await api("/api/bookings", {
      method: "POST",
      body: JSON.stringify({ sessionId, membershipId }),
    });
    showMessage(messageEl, "Вы записаны на занятие", "success");
    await refresh();
  } catch (err) {
    showMessage(messageEl, err.message);
    if (err.status === 409) await refresh();
    else button.disabled = false;
  }
}

async function cancel(bookingId, button) {
  if (!confirm("Отменить запись на занятие?")) return;

  hideMessage(messageEl);
  button.disabled = true;

  try {
    const result = await api(`/api/bookings/${bookingId}`, { method: "DELETE" });
    showMessage(
      messageEl,
      result.refunded
        ? "Запись отменена, визит возвращён на абонемент"
        : "Запись отменена. Визит не возвращён — до занятия оставалось меньше 3 часов.",
      "success"
    );
    await refresh();
  } catch (err) {
    showMessage(messageEl, err.message);
    button.disabled = false;
  }
}

async function refresh() {
  await loadMemberships();
  await Promise.all([loadSessions(), loadBookings()]);
}

// ---------- Выход ----------

document.querySelector("[data-logout]")?.addEventListener("click", async () => {
  const result = await api("/api/logout", { method: "POST" });
  location.href = result.redirect;
});

// ---------- Старт ----------

loadUser();
refresh().catch((err) => showMessage(messageEl, err.message));
