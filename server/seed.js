import "dotenv/config";
import bcrypt from "bcryptjs";

import { pool, transaction } from "./db.js";



async function seed() {
  await transaction(async (client) => {
    const hash = await bcrypt.hash("Test1234", 12);

    // --- Менеджер ---
    const { rows: [manager] } = await client.query(
      `INSERT INTO account (email, password_hash, full_name)
       VALUES ('manager@pool.ru', $1, 'Ирина Соколова')
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`,
      [hash]
    );
    await client.query(
      `INSERT INTO manager_profile (account_id, permission_level)
       VALUES ($1, 'admin') ON CONFLICT DO NOTHING`,
      [manager.id]
    );

    // --- Тренеры ---
    const trainers = [
      ["trainer1@pool.ru", "Алексей Ветров", "Плавание, кроль"],
      ["trainer2@pool.ru", "Марина Гладкова", "Аквааэробика"],
    ];

    const trainerIds = [];
    for (const [email, name, spec] of trainers) {
      const { rows: [account] } = await client.query(
        `INSERT INTO account (email, password_hash, full_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING id`,
        [email, hash, name]
      );
      await client.query(
        `INSERT INTO trainer_profile (account_id, specialization)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [account.id, spec]
      );
      trainerIds.push(account.id);
    }

    // --- Тестовый клиент ---
    const { rows: [client1] } = await client.query(
      `INSERT INTO account (email, password_hash, full_name)
       VALUES ('client@pool.ru', $1, 'Пётр Иванов')
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`,
      [hash]
    );
    await client.query(
      `INSERT INTO client_profile (account_id, phone)
       VALUES ($1, '+7 900 000-00-00') ON CONFLICT DO NOTHING`,
      [client1.id]
    );

    // --- Услуги ---
    const services = [
      ["Свободное плавание", 45, 12],
      ["Аквааэробика", 60, 10],
      ["Индивидуальное занятие", 60, 1],
    ];

    const serviceIds = [];
    for (const [name, duration, capacity] of services) {
      const { rows } = await client.query(
        `INSERT INTO service (name, duration_minutes, capacity)
         VALUES ($1, $2, $3) RETURNING id`,
        [name, duration, capacity]
      );
      serviceIds.push({ id: rows[0].id, duration, capacity });
    }

    // --- Абонементы ---
    const plans = [
      ["Разовое посещение", 450, 1, 1],
      ["Восемь занятий", 3200, 30, 8],
      ["Безлимит на месяц", 4900, 30, null],
      ["Групповые занятия", 6400, 60, 12],
    ];

    for (const [name, price, days, visits] of plans) {
      await client.query(
        `INSERT INTO membership_plan (name, price, duration_days, visits_count)
         VALUES ($1, $2, $3, $4)`,
        [name, price, days, visits]
      );
    }

    const hours = [8, 18, 19.5];
    let created = 0;

    for (let day = 1; day <= 7; day++) {
      for (let i = 0; i < hours.length; i++) {
        const service = serviceIds[i % serviceIds.length];
        const trainerId = trainerIds[i % trainerIds.length];

        const start = new Date();
        start.setDate(start.getDate() + day);
        start.setHours(Math.floor(hours[i]), (hours[i] % 1) * 60, 0, 0);

        const end = new Date(start.getTime() + service.duration * 60000);

        await client.query(
          `INSERT INTO session (service_id, trainer_id, start_time, end_time, capacity)
           VALUES ($1, $2, $3, $4, $5)`,
          [service.id, trainerId, start, end, service.capacity]
        );
        created++;
      }
    }

    const { rows: [plan] } = await client.query(
      `SELECT id, duration_days, visits_count FROM membership_plan
       WHERE name = 'Восемь занятий' LIMIT 1`
    );

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + plan.duration_days);

    await client.query(
      `INSERT INTO membership (client_id, plan_id, end_date, visits_left)
       VALUES ($1, $2, $3, $4)`,
      [client1.id, plan.id, endDate, plan.visits_count]
    );

    console.log(`Готово: ${created} занятий, ${plans.length} тарифов, 4 аккаунта.`);
  });

  console.log("\nТестовые аккаунты (пароль у всех Test1234):");
  console.log("  client@pool.ru   — клиент с абонементом на 8 визитов");
  console.log("  trainer1@pool.ru — тренер");
  console.log("  manager@pool.ru  — менеджер с правами администратора");

  await pool.end();
}

seed().catch((err) => {
  console.error("Ошибка seed:", err);
  process.exit(1);
});
