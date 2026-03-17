import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET ?? "grants-explorer-secret-key-change-in-prod";

// ── DB bootstrap ─────────────────────────────────────────────────────────────
async function ensureUsersTable() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        org_profile JSONB,
        is_admin BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // Add is_admin column to existing tables that predate this column
    await db.execute(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE
    `);
    // Seed the initial admin account
    await db.execute(`
      UPDATE users SET is_admin = TRUE WHERE email = 'admin@gmail.com'
    `);
  } catch {}
}

ensureUsersTable();

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeToken(userId: number) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}

function safeUser(u: { id: number; email: string; org_profile: any; is_admin: boolean }) {
  return { id: u.id, email: u.email, org_profile: u.org_profile, is_admin: u.is_admin };
}

// ── Middleware ─────────────────────────────────────────────────────────────────
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number };
    (req as any).userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as any).userId as number;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user?.is_admin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

// ── Routes ────────────────────────────────────────────────────────────────────
router.post("/auth/signup", async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body ?? {};
  if (!email || !password) { res.status(400).json({ error: "Email and password are required" }); return; }
  if (typeof password !== "string" || password.length < 8) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }
  try {
    const existing = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim())).limit(1);
    if (existing.length > 0) { res.status(409).json({ error: "An account with this email already exists" }); return; }
    const password_hash = await bcrypt.hash(password, 12);
    const isAdminEmail = email.toLowerCase().trim() === "admin@gmail.com";
    const [user] = await db.insert(usersTable)
      .values({ email: email.toLowerCase().trim(), password_hash, org_profile: null, is_admin: isAdminEmail })
      .returning();
    const token = makeToken(user.id);
    res.json({ token, user: safeUser(user) });
  } catch {
    res.status(500).json({ error: "Server error during signup" });
  }
});

router.post("/auth/login", async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body ?? {};
  if (!email || !password) { res.status(400).json({ error: "Email and password are required" }); return; }
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim())).limit(1);
    if (!user) { res.status(401).json({ error: "Invalid email or password" }); return; }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) { res.status(401).json({ error: "Invalid email or password" }); return; }
    const token = makeToken(user.id);
    res.json({ token, user: safeUser(user) });
  } catch {
    res.status(500).json({ error: "Server error during login" });
  }
});

router.get("/auth/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).userId as number;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json({ user: safeUser(user) });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/auth/profile", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).userId as number;
  const { org_profile } = req.body ?? {};
  if (!org_profile) { res.status(400).json({ error: "org_profile is required" }); return; }
  try {
    const [user] = await db.update(usersTable).set({ org_profile }).where(eq(usersTable.id, userId)).returning();
    res.json({ user: safeUser(user) });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

// ── Admin: add admin by email ─────────────────────────────────────────────────
router.post("/auth/admin/add", requireAuth, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body ?? {};
  if (!email) { res.status(400).json({ error: "Email is required" }); return; }
  try {
    const normalized = email.toLowerCase().trim();
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
    if (!existing) { res.status(404).json({ error: "No account found with that email" }); return; }
    if (existing.is_admin) { res.status(409).json({ error: "That user is already an admin" }); return; }
    await db.update(usersTable).set({ is_admin: true }).where(eq(usersTable.email, normalized));
    res.json({ success: true, message: `${normalized} has been granted admin access` });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

// ── Admin: list all users ─────────────────────────────────────────────────────
router.get("/auth/admin/users", requireAuth, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const users = await db.select({
      id: usersTable.id,
      email: usersTable.email,
      is_admin: usersTable.is_admin,
      created_at: usersTable.created_at,
    }).from(usersTable).orderBy(usersTable.created_at);
    res.json({ users });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
