import "dotenv/config";

import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

import { pool } from "./db.js";
import { pageGuard } from "./auth-middleware.js";
import { router as authRouter } from "./routes/auth.js";
import { router as bookingsRouter } from "./routes/bookings.js";
import { router as paymentsRouter } from "./routes/payments.js";
import { router as staffRouter } from "./routes/staff.js";
import { router as trainerRouter } from "./routes/trainer.js";
import { router as newsRouter } from "./routes/news.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SESSION_SECRET) {
  console.error("Не задан SESSION_SECRET в .env — запуск невозможен");
  process.exit(1);
}


app.set("trust proxy", 1);

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));

const PgSession = connectPgSimple(session);

app.use(
  session({
    store: new PgSession({ pool, tableName: "user_session" }),
    name: "sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);

// ---------- API ----------

app.use("/api", authRouter);
app.use("/api", bookingsRouter);
app.use("/api", paymentsRouter);
app.use("/api", staffRouter);
app.use("/api", trainerRouter);
app.use("/api", newsRouter);

// ---------- Защищенные страницы ----------

app.get("/account.html", pageGuard("client"), (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "account.html"));
});

app.get("/membership.html", pageGuard("client"), (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "membership.html"));
});

app.get("/staff.html", pageGuard("manager"), (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "staff.html"));
});

app.get("/trainer.html", pageGuard("trainer"), (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "trainer.html"));
});

app.use(express.static(PUBLIC_DIR));

// ---------- 404 ----------

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Не найдено" });
  }
  res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html"), (err) => {
    if (err) res.status(404).send("Страница не найдена");
  });
});

// ---------- Обработка ошибок ----------

app.use((err, req, res, _next) => {
  console.error("Необработанная ошибка:", err);
  res.status(500).json({ error: "Внутренняя ошибка" });
});

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
