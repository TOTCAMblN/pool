import express from "express";

import { query, transaction } from "../db.js";
import { requireRole } from "../auth-middleware.js";

export const router = express.Router();

router.use("/staff", requireRole("manager"));

// ---------- Обзор ----------

router.get("/staff/overview", async (req, res) => {
  const [pending, today, active] = await Promise.all([
    query(`SELECT count(*)::int AS n FROM payment WHERE status = 'pending'`),
    query(
      `SELECT id, start_time, service_name, trainer_name,
              capacity, booked_count
         FROM session_details
        WHERE start_time >= date_trunc('day', now())
          AND start_time <  date_trunc('day', now()) + interval '1 day'
        ORDER BY start_time`
    ),
    query(
      `SELECT count(*)::int AS n FROM membership
        WHERE status = 'active' AND end_date >= now()`
    ),
  ]);

  res.json({
    pendingPayments: pending.rows[0].n,
    activeMemberships: active.rows[0].n,
    todaySessions: today.rows,
  });
});

// ---------- Платежи ----------

router.get("/staff/payments", async (req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.reference, p.amount, p.created_at,
            mp.name AS plan_name,
            a.full_name AS client_name,
            a.email AS client_email,
            cp.phone AS client_phone
       FROM payment p
       JOIN membership_plan mp ON mp.id = p.plan_id
       JOIN client_profile cp  ON cp.account_id = p.client_id
       JOIN account a          ON a.id = cp.account_id
      WHERE p.status = 'pending'
      ORDER BY p.created_at`
  );

  res.json({ payments: rows });
});

router.post("/staff/payments/:id/confirm", async (req, res) => {
  try {
    const result = await transaction(async (client) => {

      const claimed = await client.query(
        `UPDATE payment
            SET status = 'succeeded', staff_id = $2, confirmed_at = now()
          WHERE id = $1 AND status = 'pending'
          RETURNING client_id, plan_id, amount`,
        [req.params.id, req.session.accountId]
      );

      if (claimed.rowCount === 0) {
        const err = new Error("Платёж не найден или уже обработан");
        err.status = 409;
        throw err;
      }

      const payment = claimed.rows[0];

      const { rows: planRows } = await client.query(
        `SELECT name, duration_days, visits_count
           FROM membership_plan WHERE id = $1`,
        [payment.plan_id]
      );
      const plan = planRows[0];

      const { rows: created } = await client.query(
        `INSERT INTO membership (client_id, plan_id, end_date, visits_left)
         VALUES ($1, $2, now() + ($3 || ' days')::interval, $4)
         RETURNING id, end_date`,
        [payment.client_id, payment.plan_id, plan.duration_days, plan.visits_count]
      );

      const membership = created[0];

      await client.query(
        `UPDATE payment SET membership_id = $1 WHERE id = $2`,
        [membership.id, req.params.id]
      );

      await client.query(
        `INSERT INTO notification (account_id, type, message)
         VALUES ($1, 'payment_confirmed', $2)`,
        [payment.client_id, `Абонемент «${plan.name}» активирован`]
      );

      return { membershipId: membership.id, endDate: membership.end_date };
    });

    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("Ошибка подтверждения платежа:", err);
    res.status(500).json({ error: "Внутренняя ошибка" });
  }
});

router.delete("/staff/payments/:id", async (req, res) => {
  const { rowCount } = await query(
    `UPDATE payment
        SET status = 'cancelled', staff_id = $2, confirmed_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [req.params.id, req.session.accountId]
  );

  if (rowCount === 0) {
    return res.status(409).json({ error: "Платёж уже обработан" });
  }
  res.json({ ok: true });
});

// ---------- Справочник ----------

router.get("/staff/refs", async (req, res) => {
  const [services, trainers] = await Promise.all([
    query(
      `SELECT id, name, duration_minutes, capacity
         FROM service ORDER BY name`
    ),
    query(
      `SELECT tp.account_id AS id, a.full_name AS name, tp.specialization
         FROM trainer_profile tp
         JOIN account a ON a.id = tp.account_id
        ORDER BY a.full_name`
    ),
  ]);

  res.json({ services: services.rows, trainers: trainers.rows });
});

// ---------- Создание занятия ----------

router.post("/staff/sessions", async (req, res) => {
  const { serviceId, trainerId, startTime } = req.body;

  if (!serviceId || !trainerId || !startTime) {
    return res.status(400).json({ error: "Заполните все поля" });
  }

  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) {
    return res.status(400).json({ error: "Некорректная дата" });
  }
  if (start <= new Date()) {
    return res.status(400).json({ error: "Занятие нельзя поставить в прошлом" });
  }

  try {
    const { rows: serviceRows } = await query(
      `SELECT duration_minutes, capacity FROM service WHERE id = $1`,
      [serviceId]
    );
    const service = serviceRows[0];
    if (!service) {
      return res.status(404).json({ error: "Услуга не найдена" });
    }

    const end = new Date(start.getTime() + service.duration_minutes * 60000);

    const { rows: conflicts } = await query(
      `SELECT id FROM session
        WHERE trainer_id = $1 AND start_time < $2 AND end_time > $3
        LIMIT 1`,
      [trainerId, end, start]
    );

    if (conflicts.length > 0) {
      return res.status(409).json({ error: "У тренера уже есть занятие в это время" });
    }

    const { rows } = await query(
      `INSERT INTO session (service_id, trainer_id, start_time, end_time, capacity)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [serviceId, trainerId, start, end, service.capacity]
    );

    res.status(201).json({ session: rows[0] });
  } catch (err) {
    if (err.code === "23503") {
      return res.status(400).json({ error: "Тренер не найден" });
    }
    console.error("Ошибка создания занятия:", err);
    res.status(500).json({ error: "Внутренняя ошибка" });
  }
});

// ---------- Удаление ----------

router.delete("/staff/sessions/:id", async (req, res) => {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM booking
      WHERE session_id = $1 AND status = 'booked'`,
    [req.params.id]
  );

  if (rows[0].n > 0) {
    return res.status(409).json({
      error: `Нельзя удалить: записано ${rows[0].n} чел. Сначала отмените записи.`,
    });
  }

  await query(`DELETE FROM session WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// ---------- Поиск клиентов ----------

router.get("/staff/clients", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return res.json({ clients: [] });

  const { rows } = await query(
    `SELECT a.id, a.full_name, a.email, cp.phone,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', m.id,
                  'plan_name', mp.name,
                  'visits_left', m.visits_left
                )
              ) FILTER (WHERE m.id IS NOT NULL),
              '[]'
            ) AS memberships
       FROM client_profile cp
       JOIN account a ON a.id = cp.account_id
       LEFT JOIN membership m
              ON m.client_id = cp.account_id
             AND m.status = 'active'
             AND m.end_date >= now()
             AND (m.visits_left IS NULL OR m.visits_left > 0)
       LEFT JOIN membership_plan mp ON mp.id = m.plan_id
      WHERE a.full_name ILIKE $1 OR a.email ILIKE $1
      GROUP BY a.id, a.full_name, a.email, cp.phone
      LIMIT 10`,
    [`%${q}%`]
  );

  res.json({ clients: rows });
});

// ---------- Ручная запись клиента ----------

router.post("/staff/bookings", async (req, res) => {
  const { clientId, sessionId, membershipId } = req.body;

  if (!clientId || !sessionId || !membershipId) {
    return res.status(400).json({ error: "Некорректный запрос" });
  }

  try {
    const booking = await transaction(async (client) => {
      const seat = await client.query(
        `UPDATE session
            SET booked_count = booked_count + 1
          WHERE id = $1 AND booked_count < capacity AND start_time > now()
          RETURNING id`,
        [sessionId]
      );

      if (seat.rowCount === 0) {
        const err = new Error("На это занятие нельзя записать");
        err.status = 409;
        throw err;
      }

      const visit = await client.query(
        `UPDATE membership
            SET visits_left = CASE
                  WHEN visits_left IS NULL THEN NULL
                  ELSE visits_left - 1
                END
          WHERE id = $1 AND client_id = $2 AND status = 'active'
            AND end_date >= now()
            AND (visits_left IS NULL OR visits_left > 0)
          RETURNING id`,
        [membershipId, clientId]
      );

      if (visit.rowCount === 0) {
        const err = new Error("Абонемент недействителен");
        err.status = 400;
        throw err;
      }

      const { rows } = await client.query(
        `INSERT INTO booking (client_id, session_id, membership_id, staff_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [clientId, sessionId, membershipId, req.session.accountId]
      );

      return rows[0];
    });

    res.status(201).json({ booking });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Клиент уже записан на это занятие" });
    }
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("Ошибка записи:", err);
    res.status(500).json({ error: "Внутренняя ошибка" });
  }
});
