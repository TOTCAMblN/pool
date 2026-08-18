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

const sessionsView = document.querySelector("[data-sessions-view]");
const rosterView = document.querySelector("[data-roster-view]");

const STATUS_LABEL = {
  booked: "Записан",
  attended: "Был",
  no_show: "Не пришёл",
};

let currentSessionId = null;

// ---------- Список занятий ----------

async function loadSessions() {
  const { sessions } = await api("/api/trainer/sessions");

  const now = Date.now();
  const upcoming = sessions.filter((s) => new Date(s.end_time).getTime() >= now);
  const past = sessions.filter((s) => new Date(s.end_time).getTime() < now);

  renderSessionList(document.querySelector("[data-upcoming]"), upcoming, false);
  renderSessionList(document.querySelector("[data-past]"), past, true);
}

function renderSessionList(container, sessions, isPast) {
  container.replaceChildren();

  if (sessions.length === 0) {
    container.append(
      el("p", "muted", isPast ? "Прошедших занятий нет." : "Предстоящих занятий нет.")
    );
    return;
  }

  const list = el("ul", "list");

  for (const s of sessions) {
    const item = el("li", `list-item${isPast ? " list-item--muted" : ""}`);

    const info = el("div", "list-item-info");
    info.append(el("strong", null, s.service_name));
    info.append(el("span", null, formatDateTime(s.start_time)));
    info.append(
      el("span", "muted", `${isPast ? "Было записано" : "Записано"}: ${s.booked} / ${s.capacity}`)
    );
    item.append(info);

    const button = el("button", "btn", "Открыть");
    button.addEventListener("click", () => openRoster(s.id));
    item.append(button);

    list.append(item);
  }

  container.append(list);
}

// ---------- Список записанных ----------

async function openRoster(sessionId) {
  hideMessage(messageEl);

  try {
    const { session, participants } = await api(
      `/api/trainer/sessions/${sessionId}/roster`
    );

    currentSessionId = sessionId;

    document.querySelector("[data-roster-title]").textContent = session.service_name;
    document.querySelector("[data-roster-meta]").textContent =
      `${formatDateTime(session.start_time)} · записано ${participants.length} из ${session.capacity}`;

    renderRoster(session, participants);

    sessionsView.hidden = true;
    rosterView.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    showMessage(messageEl, err.message);
  }
}

function renderRoster(session, participants) {
  const container = document.querySelector("[data-roster]");
  container.replaceChildren();

  if (participants.length === 0) {
    container.append(el("p", "muted", "На это занятие пока никто не записан."));
    return;
  }

  const started = new Date(session.start_time) <= new Date();

  const table = el("table", "table");

  const thead = el("thead");
  const headRow = el("tr");
  for (const t of ["Клиент", "Телефон", "Статус", ""]) {
    headRow.append(el("th", null, t));
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");

  for (const p of participants) {
    const row = el("tr");
    row.append(el("td", null, p.full_name));
    row.append(el("td", null, p.phone ?? "—"));

    const statusCell = el("td");
    statusCell.append(
      el("span", `status status--${p.status}`, STATUS_LABEL[p.status] ?? p.status)
    );
    row.append(statusCell);

    const actions = el("td", "actions");

    const wasBtn = el("button", "btn btn--primary", "Был");
    wasBtn.disabled = !started || p.status === "attended";
    wasBtn.addEventListener("click", () => mark(p.booking_id, true));
    actions.append(wasBtn);

    const noShowBtn = el("button", "btn", "Не пришёл");
    noShowBtn.disabled = !started || p.status === "no_show";
    noShowBtn.addEventListener("click", () => mark(p.booking_id, false));
    actions.append(noShowBtn);

    row.append(actions);
    tbody.append(row);
  }

  table.append(tbody);
  container.append(table);

  if (!started) {
    container.append(
      el("p", "muted", "Отметить посещаемость можно будет после начала занятия.")
    );
  }
}

async function mark(bookingId, attended) {
  hideMessage(messageEl);

  try {
    await api("/api/trainer/attendance", {
      method: "POST",
      body: JSON.stringify({ bookingId, attended }),
    });
    await openRoster(currentSessionId);
  } catch (err) {
    showMessage(messageEl, err.message);
  }
}

// ---------- Навигация ----------

document.querySelector("[data-back]")?.addEventListener("click", () => {
  rosterView.hidden = true;
  sessionsView.hidden = false;
  loadSessions().catch((err) => showMessage(messageEl, err.message));
});

document.querySelector("[data-logout]")?.addEventListener("click", async () => {
  const result = await api("/api/logout", { method: "POST" });
  location.href = result.redirect;
});

// ---------- Старт ----------

currentUser().then((user) => {
  if (user) userNameEl.textContent = user.fullName;
});

loadSessions().catch((err) => showMessage(messageEl, err.message));
