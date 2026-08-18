import { query } from "./db.js";

export async function loadRoles(accountId) {
  const { rows } = await query(
    `SELECT is_client, is_trainer, is_manager, permission_level
       FROM account_roles WHERE id = $1`,
    [accountId]
  );

  const row = rows[0];
  if (!row) return { roles: [], permissionLevel: null };

  const roles = [];
  if (row.is_client) roles.push("client");
  if (row.is_trainer) roles.push("trainer");
  if (row.is_manager) roles.push("manager");

  return { roles, permissionLevel: row.permission_level ?? null };
}


export function requireAuth(req, res, next) {
  if (!req.session?.accountId) {
    return res.status(401).json({ error: "Не авторизован" });
  }
  next();
}


export function requireRole(role) {
  return (req, res, next) => {
    console.log("DEBUG", role, req.session.accountId, req.session.roles);
    if (!req.session?.accountId) {
      return res.status(401).json({ error: "Не авторизован" });
    }
    if (!req.session.roles?.includes(role)) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    next();
  };
}

export function requireAdmin(req, res, next) {
  if (!req.session?.accountId) {
    return res.status(401).json({ error: "Не авторизован" });
  }
  if (!req.session.roles?.includes("manager") ||
      req.session.permissionLevel !== "admin") {
    return res.status(403).json({ error: "Требуются права администратора" });
  }
  next();
}

export function pageGuard(role) {
  return (req, res, next) => {
    if (!req.session?.accountId) {
      return res.redirect("/login.html?next=" + encodeURIComponent(req.path));
    }
    if (role && !req.session.roles?.includes(role)) {
      return res.redirect(homeFor(req.session.roles));
    }
    next();
  };
}

export function homeFor(roles = []) {
  if (roles.includes("manager")) return "/staff.html";
  if (roles.includes("trainer")) return "/trainer.html";
  return "/account.html";
}
