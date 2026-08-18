import express from "express";

import { query, transaction } from "../db.js";
import { requireAuth, requireRole } from "../auth-middleware.js";

export const router = express.Router();

const FREE_CANCELLATION_HOURS = 3;

router.get("/sessions", requireAuth, async (req, res) => {
  const from = req.query.from ? new Date(req.query.from) : new Date();
  const to = req.query.to
    ? new Date(req.query.to)
    : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const { rows } = await query(
    `SELECT id, start_time, end_time, capacity, spots_left,
            service_name, trainer_name
       FROM session_details
      WHERE start_time BETWEEN $1 AND $2
      ORDER BY start_time`,
    [from, to]
  );

  res.json({ sessions: rows });
});

// ---------- Абонементы ----------

router.get("/memberships", requireRole("client"), async (req, res) => {
  const { rows } = await query(
    `SELECT m.id, m.visits_left, m.end_date, p.name AS plan_name
       FROM membership m
       JOIN membership_plan p ON p.id = m.plan_id
      WHERE m.client_id = $1
        AND m.status = 'active'
        AND m.end_date >= now()
        AND (m.visits_left IS NULL OR m.visits_left > 0)
      ORDER BY m.end_date`,
    [req.session.accountId]
  );

  res.json({ memberships: rows });
});

// ---------- Создание записи ----------

router.post("/bookings", requireRole("client"), async (req, res) => {
  const sessionId = req.body.sessionId;
  const membershipId = req.body.membershipId;
  const clientId = req.session.accountId;

  if (!sessionId || !membershipId) {
    return res.status(400).json({ error: "Некорректный запрос" });
  }

  try {
    const booking = await transaction(async (client) => {
      const seat = await client.query(
        `UPDATE session
            SET booked_count = booked_count + 1
          WHERE id = $1
            AND booked_count < capacity
            AND start_time > now()
          RETURNING id`,
        [sessionId]
      );

      if (seat.rowCount === 0) {
        const err = new Error("На это занятие нельзя записаться");
        err.status = 409;
        throw err;
      }

      const visit = await client.query(
        `UPDATE membership
            SET visits_left = CASE
                  WHEN visits_left IS NULL THEN NULL
                  ELSE visits_left - 1
                END
          WHERE id = $1
            AND client_id = $2
            AND status = 'active'
            AND end_date >= now()
            AND (visits_left IS NULL OR visits_left > 0)
          RETURNING id`,
        [membershipId, clientId]
      );

      if (visit.rowCount === 0) {
        const err = new Error("Абонемент недействителен или визиты закончились");
        err.status = 400;
        throw err;
      }

      const { rows } = await client.query(
        `INSERT INTO booking (client_id, session_id, membership_id)
         VALUES ($1, $2, $3)
         RETURNING id, created_at`,
        [clientId, sessionId, membershipId]
      );

      return rows[0];
    });

    res.status(201).json({ booking });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Вы уже записаны на это занятие" });
    }
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("Ошибка записи:", err);
    res.status(500).json({ error: "Внутренняя ошибка" });
  }
});

// ---------- Мои записи ----------

router.get("/bookings", requireRole("client"), async (req, res) => {
  const { rows } = await query(
    `SELECT b.id, b.status, b.created_at,
            s.start_time, s.end_time,
            sv.name AS service_name,
            a.full_name AS trainer_name
       FROM booking b
       JOIN session s  ON s.id = b.session_id
       JOIN service sv ON sv.id = s.service_id
       JOIN account a  ON a.id = s.trainer_id
      WHERE b.client_id = $1
      ORDER BY s.start_time DESC
      LIMIT 50`,
    [req.session.accountId]
  );

  res.json({ bookings: rows });
});

// ---------- Отмена записи ----------

router.delete("/bookings/:id", requireRole("client"), async (req, res) => {
  try {
    const result = await transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT b.id, b.membership_id, s.start_time
           FROM booking b
           JOIN session s ON s.id = b.session_id
          WHERE b.id = $1 AND b.client_id = $2 AND b.status = 'booked'`,
        [req.params.id, req.session.accountId]
      );

      const booking = rows[0];
      if (!booking) {
        const err = new Error("Бронь не найдена или уже отменена");
        err.status = 404;
        throw err;
      }

      const hoursLeft =
        (new Date(booking.start_time).getTime() - Date.now()) / 3600000;
      const refund = hoursLeft >= FREE_CANCELLATION_HOURS;

      await client.query(
        `UPDATE booking SET status = 'cancelled', cancelled_at = now()
          WHERE id = $1`,
        [booking.id]
      );

      await client.query(
        `UPDATE session SET booked_count = booked_count - 1
          WHERE id = (SELECT session_id FROM booking WHERE id = $1)`,
        [booking.id]
      );

      if (refund) {
        await client.query(
          `UPDATE membership
              SET visits_left = visits_left + 1
            WHERE id = $1 AND visits_left IS NOT NULL`,
          [booking.membership_id]
        );
      }

      return { refunded: refund };
    });

    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("Ошибка отмены:", err);
    res.status(500).json({ error: "Внутренняя ошибка" });
  }
});
