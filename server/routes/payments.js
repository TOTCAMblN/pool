import crypto from "node:crypto";

import express from "express";
import QRCode from "qrcode";

import { query } from "../db.js";
import { requireRole } from "../auth-middleware.js";

export const router = express.Router();

function generateReference() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(6);
  let code = "";
  for (const byte of bytes) {
    code += alphabet[byte % alphabet.length];
  }
  return `PL-${code}`;
}

function buildPaymentString({ amount, reference }) {
  const parts = [
    "ST00012",
    `Name=${process.env.PAYEE_NAME || "Бассейн Политехник"}`,
    `PersonalAcc=${process.env.PAYEE_ACCOUNT || "00000000000000000000"}`,
    `BankName=${process.env.PAYEE_BANK || "Банк"}`,
    `BIC=${process.env.PAYEE_BIC || "000000000"}`,
    `CorrespAcc=${process.env.PAYEE_CORR_ACC || "00000000000000000000"}`,
    `Sum=${Math.round(Number(amount) * 100)}`,
    `Purpose=Абонемент ${reference}`,
  ];
  return parts.join("|");
}

// ---------- Список тарифов ----------

router.get("/plans", async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, price, duration_days, visits_count
       FROM membership_plan
      WHERE is_active = true
      ORDER BY price`
  );
  res.json({ plans: rows });
});

// ---------- Создание платежа ----------

router.post("/payments", requireRole("client"), async (req, res) => {
  const planId = req.body.planId;
  if (!planId) {
    return res.status(400).json({ error: "Не выбран абонемент" });
  }

  try {
    const { rows } = await query(
      `SELECT id, name, price FROM membership_plan
        WHERE id = $1 AND is_active = true`,
      [planId]
    );

    const plan = rows[0];
    if (!plan) {
      return res.status(404).json({ error: "Тариф не найден" });
    }

    const reference = generateReference();

    const { rows: created } = await query(
      `INSERT INTO payment (client_id, plan_id, amount, reference)
       VALUES ($1, $2, $3, $4)
       RETURNING id, reference, amount, created_at`,
      [req.session.accountId, plan.id, plan.price, reference]
    );

    const payment = created[0];

    const qrDataUrl = await QRCode.toDataURL(
      buildPaymentString({ amount: payment.amount, reference }),
      { width: 320, margin: 1 }
    );

    res.status(201).json({
      payment: {
        id: payment.id,
        reference: payment.reference,
        amount: payment.amount,
        planName: plan.name,
      },
      qr: qrDataUrl,
    });
  } catch (err) {
    console.error("Ошибка создания платежа:", err);
    res.status(500).json({ error: "Внутренняя ошибка" });
  }
});

// ---------- Платежи ----------

router.get("/payments", requireRole("client"), async (req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.reference, p.amount, p.status, p.created_at,
            p.confirmed_at, mp.name AS plan_name
       FROM payment p
       JOIN membership_plan mp ON mp.id = p.plan_id
      WHERE p.client_id = $1
      ORDER BY p.created_at DESC
      LIMIT 20`,
    [req.session.accountId]
  );

  res.json({ payments: rows });
});

// ---------- Отмена платежа ----------

router.delete("/payments/:id", requireRole("client"), async (req, res) => {
  const { rowCount } = await query(
    `UPDATE payment SET status = 'cancelled'
      WHERE id = $1 AND client_id = $2 AND status = 'pending'`,
    [req.params.id, req.session.accountId]
  );

  if (rowCount === 0) {
    return res.status(404).json({ error: "Платёж не найден или уже обработан" });
  }
  res.json({ ok: true });
});
