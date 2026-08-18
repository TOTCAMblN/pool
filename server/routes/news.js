import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { query } from "../db.js";
import { requireRole } from "../auth-middleware.js";
import { uploadNewsImage } from "../upload.js";

export const router = express.Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "..", "..", "public", "uploads", "news");



router.get("/news", async (req, res) => {
  const { rows } = await query(
    `SELECT id, title, excerpt, image_path, published_at
       FROM news
      ORDER BY published_at DESC
      LIMIT 3`
  );
  res.json({ news: rows });
});

router.get("/news/:id", async (req, res) => {
  const { rows } = await query(
    `SELECT id, title, body, image_path, published_at
       FROM news WHERE id = $1`,
    [req.params.id]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: "Новость не найдена" });
  }
  res.json({ news: rows[0] });
});

// ---------- Управление ----------

router.get("/staff/news", requireRole("manager"), async (req, res) => {
  const { rows } = await query(
    `SELECT n.id, n.title, n.excerpt, n.image_path, n.published_at,
            a.full_name AS author_name
       FROM news n
       LEFT JOIN account a ON a.id = n.author_id
      ORDER BY n.published_at DESC`
  );
  res.json({ news: rows });
});

function handleUpload(req, res, next) {
  uploadNewsImage.single("image")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

router.post(
  "/staff/news",
  requireRole("manager"),
  handleUpload,
  async (req, res) => {

    try {
      const { title, excerpt, body } = req.body;

      if (!title?.trim() || !body?.trim()) {
        if (req.file) await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ error: "Заполните заголовок и текст" });
      }

      const imagePath = req.file ? `/uploads/news/${req.file.filename}` : null;

      const { rows } = await query(
        `INSERT INTO news (title, excerpt, body, image_path, author_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [title.trim(), excerpt?.trim() || null, body.trim(), imagePath, req.session.accountId]
      );

      res.status(201).json({ news: rows[0] });
    } catch (err) {
      console.error("Ошибка создания новости:", err);
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      res.status(500).json({ error: "Внутренняя ошибка" });
    }
  }
);

router.delete("/staff/news/:id", requireRole("manager"), async (req, res) => {
  try {
    const { rows } = await query(
      `DELETE FROM news WHERE id = $1 RETURNING image_path`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Новость не найдена" });
    }

    const imagePath = rows[0].image_path;
    if (imagePath) {
      const filename = path.basename(imagePath);
      await fs.unlink(path.join(UPLOAD_DIR, filename)).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Ошибка удаления новости:", err);
    res.status(500).json({ error: "Внутренняя ошибка" });
  }
});