import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const UPLOAD_DIR = path.join(__dirname, "..", "public", "uploads", "news");

// Папка может отсутствовать на диске — например, если её случайно
// не перенесли при копировании файлов, или на новом сервере при
// деплое (Railway каждый раз собирает контейнер заново). recursive: true
// создаёт все промежуточные папки и не вызывает ошибку, если папка
// уже существует.
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = crypto.randomBytes(16).toString("hex");
    cb(null, `${name}${ext}`);
  },
});

export const uploadNewsImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return cb(new Error("Допустимы только изображения JPEG, PNG или WebP"));
    }
    cb(null, true);
  },
});