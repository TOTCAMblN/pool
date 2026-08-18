import {
  api,
  currentUser,
  showMessage,
  hideMessage,
  formatDateTime,
  el,
} from "./common.js";

const plansEl = document.querySelector("[data-plans]");
const paymentsEl = document.querySelector("[data-payments]");
const messageEl = document.querySelector("[data-message]");
const userNameEl = document.querySelector("[data-user-name]");

const qrSection = document.querySelector("[data-qr-section]");
const qrImage = document.querySelector("[data-qr-image]");
const qrPlan = document.querySelector("[data-qr-plan]");
const qrAmount = document.querySelector("[data-qr-amount]");
const qrReference = document.querySelector("[data-qr-reference]");

const STATUS_LABEL = {
  pending: "Ожидает подтверждения",
  succeeded: "Оплачен",
  cancelled: "Отменён",
};

async function loadUser() {
  const user = await currentUser();
  if (user) userNameEl.textContent = user.fullName;
}

async function loadPlans() {
  const { plans } = await api("/api/plans");

  plansEl.replaceChildren();

  for (const plan of plans) {
    const card = el("div", "card");
    card.append(el("strong", null, plan.name));
    card.append(el("span", "plan-price", `${Number(plan.price).toLocaleString("ru-RU")} ₽`));
    card.append(
      el(
        "span",
        "muted",
        plan.visits_count === null
          ? "Безлимитные посещения"
          : `${plan.visits_count} посещений`
      )
    );
    card.append(el("small", "muted", `Действует ${plan.duration_days} дней`));

    const button = el("button", "btn btn--primary", "Оформить");
    button.addEventListener("click", () => buy(plan.id, button));
    card.append(button);

    plansEl.append(card);
  }
}

async function loadPayments() {
  const { payments } = await api("/api/payments");

  paymentsEl.replaceChildren();

  if (payments.length === 0) {
    paymentsEl.append(el("p", "muted", "Платежей пока нет."));
    return;
  }

  const table = el("table", "table");

  const thead = el("thead");
  const headRow = el("tr");
  for (const title of ["Код", "Абонемент", "Сумма", "Статус", "Создан", ""]) {
    headRow.append(el("th", null, title));
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");

  for (const p of payments) {
    const row = el("tr");

    const refCell = el("td");
    refCell.append(el("code", "ref", p.reference));
    row.append(refCell);

    row.append(el("td", null, p.plan_name));
    row.append(el("td", null, `${Number(p.amount).toLocaleString("ru-RU")} ₽`));

    const statusCell = el("td");
    statusCell.append(
      el("span", `status status--${p.status}`, STATUS_LABEL[p.status] ?? p.status)
    );
    row.append(statusCell);

    row.append(el("td", null, formatDateTime(p.created_at)));

    const actionCell = el("td");
    if (p.status === "pending") {
      const cancelBtn = el("button", "btn", "Отменить");
      cancelBtn.addEventListener("click", () => cancelPayment(p.id, cancelBtn));
      actionCell.append(cancelBtn);
    }
    row.append(actionCell);

    tbody.append(row);
  }

  table.append(tbody);
  paymentsEl.append(table);
}

async function buy(planId, button) {
  hideMessage(messageEl);
  button.disabled = true;

  try {
    const result = await api("/api/payments", {
      method: "POST",
      body: JSON.stringify({ planId }),
    });

    qrImage.src = result.qr;
    qrPlan.textContent = result.payment.planName;
    qrAmount.textContent = `${Number(result.payment.amount).toLocaleString("ru-RU")} ₽`;
    qrReference.textContent = result.payment.reference;
    qrSection.hidden = false;
    qrSection.scrollIntoView({ behavior: "smooth", block: "start" });

    await loadPayments();
  } catch (err) {
    showMessage(messageEl, err.message);
  } finally {
    button.disabled = false;
  }
}

async function cancelPayment(paymentId, button) {
  if (!confirm("Отменить платёж?")) return;

  button.disabled = true;
  try {
    await api(`/api/payments/${paymentId}`, { method: "DELETE" });
    await loadPayments();
  } catch (err) {
    showMessage(messageEl, err.message);
    button.disabled = false;
  }
}

document.querySelector("[data-qr-close]")?.addEventListener("click", () => {
  qrSection.hidden = true;
});

document.querySelector("[data-logout]")?.addEventListener("click", async () => {
  const result = await api("/api/logout", { method: "POST" });
  location.href = result.redirect;
});

loadUser();
Promise.all([loadPlans(), loadPayments()]).catch((err) =>
  showMessage(messageEl, err.message)
);
