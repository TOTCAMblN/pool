import { api, showMessage, hideMessage } from "./common.js";

const form = document.querySelector("[data-auth-form]");
const messageEl = document.querySelector("[data-message]");
const submitBtn = form?.querySelector("button[type=submit]");

const mode = form?.dataset.authForm;

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideMessage(messageEl);

  const data = Object.fromEntries(new FormData(form));


  if (mode === "register") {
    if (data.password !== data.passwordConfirm) {
      return showMessage(messageEl, "Пароли не совпадают");
    }
    if (data.password.length < 8) {
      return showMessage(messageEl, "Пароль должен быть не короче 8 символов");
    }
  }

  submitBtn.disabled = true;
  submitBtn.dataset.originalText = submitBtn.textContent;
  submitBtn.textContent = mode === "login" ? "Входим…" : "Создаём аккаунт…";

  try {
    const payload =
      mode === "login"
        ? { email: data.email, password: data.password }
        : {
            email: data.email,
            fullName: data.fullName,
            password: data.password,
          };

    const result = await api(`/api/${mode}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const next = new URLSearchParams(location.search).get("next");
    location.href = next || result.redirect;
  } catch (err) {
    showMessage(messageEl, err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = submitBtn.dataset.originalText;
  }
});
