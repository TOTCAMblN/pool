import express from "express";
import bcrypt from "bcryptjs";

import { query, transaction } from "../db.js";
import { loadRoles, homeFor } from "../auth-middleware.js";

export const router = express.Router();

const attempts = new Map();

function tooManyAttempts(key, limit = 5, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

function validateRegistration({ email, fullName, password }) {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return "Введите корректный email";
  }
  if (!fullName || fullName.trim().length < 2) {
    return "Введите имя";
  }
  if (!password || password.length < 8) {
    return "Пароль должен быть не короче 8 символов";
  }
  if (password.length > 72) {
    return "Пароль не длиннее 72 символов";
  }
  if (!/[0-9]/.test(password) || !/[a-zA-Zа-яА-Я]/.test(password)) {
    return "Пароль должен содержать буквы и хотя бы одну цифру";
  }
  return null;
}

// ---------- Регистрация ----------

router.post("/register", async (req, res) => {
  const ip = req.ip;
  if (tooManyAttempts(`register:${ip}`)) {
    return res.status(429).json({ error: "Слишком много попыток. Попробуйте позже." });
  }

  const email = String(req.body.email ?? "").trim().toLowerCase();
  const fullName = String(req.body.fullName ?? "").trim();
  const password = String(req.body.password ?? "");

  const error = validateRegistration({ email, fullName, password });
  if (error) return res.status(400).json({ error });

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const accountId = await transaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO account (email, password_hash, full_name)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [email, passwordHash, fullName]
      );

      const id = rows[0].id;

      // Регистрация через сайт всегда создаёт лишь клиента
      await client.query(
        `INSERT INTO client_profile (account_id) VALUES ($1)`,
        [id]
      );

      return id;
    });

    // Сразу входим
    req.session.accountId = accountId;
    req.session.roles = ["client"];
    req.session.permissionLevel = null;

    res.status(201).json({ ok: true, redirect: "/account.html" });
  } catch (err) {
    
    if (err.code === "23505") {
      return res.status(409).json({ error: "Не удалось зарегистрировать этот адрес" });
    }
    console.error("Ошибка регистрации:", err);
    res.status(500).json({ error: "Внутренняя ошибка" });
  }
});

// ---------- Вход ----------

router.post("/login", async (req, res) => {
  const email = String(req.body.email ?? "").trim().toLowerCase();
  const password = String(req.body.password ?? "");

  if (tooManyAttempts(`login:${req.ip}:${email}`)) {
    return res.status(429).json({ error: "Слишком много попыток. Попробуйте позже." });
  }

  if (!email || !password) {
    return res.status(400).json({ error: "Введите email и пароль" });
  }

  try {
    const { rows } = await query(
      `SELECT id, password_hash FROM account WHERE lower(email) = $1`,
      [email]
    );

    const account = rows[0];

    if (!account) {
      await bcrypt.compare(password, "$2a$12$" + "x".repeat(53));
      return res.status(401).json({ error: "Неверный email или пароль" });
    }

    const valid = await bcrypt.compare(password, account.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Неверный email или пароль" });
    }

    const { roles, permissionLevel } = await loadRoles(account.id);

    req.session.regenerate((err) => {
      if (err) {
        console.error("Ошибка сессии:", err);
        return res.status(500).json({ error: "Внутренняя ошибка" });
      }

      req.session.accountId = account.id;
      req.session.roles = roles;
      req.session.permissionLevel = permissionLevel;

      res.json({ ok: true, redirect: homeFor(roles) });
    });
  } catch (err) {
    console.error("Ошибка входа:", err);
    res.status(500).json({ error: "Внутренняя ошибка" });
  }
});

// ---------- Выход ----------

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("sid");
    res.json({ ok: true, redirect: "/" });
  });
});

// ---------- Текущий пользователь ----------

router.get("/me", async (req, res) => {
  if (!req.session?.accountId) {
    return res.json({ authenticated: false });
  }

  const { rows } = await query(
    `SELECT id, email, full_name FROM account WHERE id = $1`,
    [req.session.accountId]
  );

  const account = rows[0];
  if (!account) {
    return req.session.destroy(() => res.json({ authenticated: false }));
  }

  res.json({
    authenticated: true,
    id: account.id,
    email: account.email,
    fullName: account.full_name,
    roles: req.session.roles ?? [],
    permissionLevel: req.session.permissionLevel ?? null,
  });
});
