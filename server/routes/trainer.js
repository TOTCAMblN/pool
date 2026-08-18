import express from "express";

import { query } from "../db.js";
import { requireRole } from "../auth-middleware.js";

export const router = express.Router();

router.use("/trainer", requireRole("trainer"));

// ---------- Занятия ----------

router.get("/trainer/sessions", async (req, res) => {
  const { rows } = await query(
    `SELECT s.id, s.start_time, s.end_time, s.capacity,
            sv.name AS service_name,
            count(b.id) FILTER (WHERE b.status <> 'cancelled')::int AS booked
       FROM session s
       JOIN service sv ON sv.id = s.service_id
       LEFT JOIN booking b ON b.session_id = s.id
      WHERE s.trainer_id = $1
        AND s.start_time >= date_trunc('day', now()) - interval '7 days'
        AND s.start_time <= now() + interval '14 days'
      GROUP BY s.id, sv.name
      ORDER BY s.start_time`,
    [req.session.accountId]
  );

  res.json({ sessions: rows });
});

// ---------- Список записанных ----------

router.get("/trainer/sessions/:id/roster", async (req, res) => {
  const { rows: sessionRows } = await query(
    `SELECT s.id, s.start_time, s.end_time, s.capacity, sv.name AS service_name
       FROM session s
       JOIN service sv ON sv.id = s.service_id
      WHERE s.id = $1 AND s.trainer_id = $2`,
    [req.params.id, req.session.accountId]
  );

  const session = sessionRows[0];
  if (!session) {
    return res.status(404).json({ error: "Занятие не найдено" });
  }

  const { rows: participants } = await query(
    `SELECT b.id AS booking_id, b.status,
            a.full_name, cp.phone
       FROM booking b
       JOIN client_profile cp ON cp.account_id = b.client_id
       JOIN account a         ON a.id = cp.account_id
      WHERE b.session_id = $1 AND b.status <> 'cancelled'
      ORDER BY a.full_name`,
    [req.params.id]
  );

  res.json({ session, participants });
});

// ---------- Отметка посещения ----------


router.post("/trainer/attendance", async (req, res) => {
  const { bookingId, attended } = req.body;

  if (!bookingId || typeof attended !== "boolean") {
    return res.status(400).json({ error: "Некорректный запрос" });
  }

  const { rowCount } = await query(
    `UPDATE booking
        SET status = $2
      WHERE id = $1
        AND status <> 'cancelled'
        AND session_id IN (SELECT id FROM session WHERE trainer_id = $3)`,
    [bookingId, attended ? "attended" : "no_show", req.session.accountId]
  );

  if (rowCount === 0) {
    return res.status(404).json({ error: "Бронь не найдена" });
  }

  res.json({ ok: true });
});
