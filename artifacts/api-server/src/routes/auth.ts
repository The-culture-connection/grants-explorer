import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET ?? "grants-explorer-secret-key-change-in-prod";

async function ensureUsersTable() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        org_profile JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
  } catch {}
}

ensureUsersTable();

function makeToken(userId: number) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}

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

router.post("/auth/signup", async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  try {
    const existing = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim())).limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }
    const password_hash = await bcrypt.hash(password, 12);
    const [user] = await db
      .insert(usersTable)
      .values({ email: email.toLowerCase().trim(), password_hash, org_profile: null })
      .returning();
    const token = makeToken(user.id);
    res.json({ token, user: { id: user.id, email: user.email, org_profile: user.org_profile } });
  } catch (err: any) {
    res.status(500).json({ error: "Server error during signup" });
  }
});

router.post("/auth/login", async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim())).limit(1);
    if (!user) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    const token = makeToken(user.id);
    res.json({ token, user: { id: user.id, email: user.email, org_profile: user.org_profile } });
  } catch {
    res.status(500).json({ error: "Server error during login" });
  }
});

router.get("/auth/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).userId as number;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ user: { id: user.id, email: user.email, org_profile: user.org_profile } });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/auth/profile", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).userId as number;
  const { org_profile } = req.body ?? {};
  if (!org_profile) {
    res.status(400).json({ error: "org_profile is required" });
    return;
  }
  try {
    const [user] = await db
      .update(usersTable)
      .set({ org_profile })
      .where(eq(usersTable.id, userId))
      .returning();
    res.json({ user: { id: user.id, email: user.email, org_profile: user.org_profile } });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
