import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { DEMO_USER_EMAIL, DEMO_USER_NAME, DEMO_USER_PASSWORD } from "../config.js";
import { getPool } from "../db/pool.js";

const BCRYPT_ROUNDS = 10;

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

/** A row as stored, including the hash. Never leaves this module. */
interface UserRow extends User {
  passwordHash: string;
}

export class AuthUnavailableError extends Error {
  constructor() {
    super("accounts are unavailable because the database is not connected");
  }
}

export class EmailTakenError extends Error {
  constructor() {
    super("an account with that email already exists");
  }
}

function requirePool() {
  const pool = getPool();
  // Unlike run recording, authentication cannot degrade quietly: letting
  // people in because the account store is missing would defeat the point of
  // having one.
  if (!pool) throw new AuthUnavailableError();
  return pool;
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  name: row.name,
  createdAt: row.createdAt,
});

async function findRowByEmail(email: string): Promise<UserRow | null> {
  const pool = requirePool();
  const { rows } = await pool.query(
    `SELECT id, email, name, password_hash, created_at FROM users WHERE lower(email) = lower($1)`,
    [email.trim()],
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function findUserById(id: string): Promise<User | null> {
  const pool = getPool();
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT id, email, name, created_at FROM users WHERE id = $1`, [id]);
  if (!rows.length) return null;
  return {
    id: rows[0].id,
    email: rows[0].email,
    name: rows[0].name,
    createdAt: new Date(rows[0].created_at).toISOString(),
  };
}

export async function createUser(input: {
  email: string;
  name: string;
  password: string;
}): Promise<User> {
  const pool = requirePool();
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  try {
    const { rows } = await pool.query(
      `INSERT INTO users (id, email, name, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, created_at`,
      [randomUUID(), input.email.trim(), input.name.trim(), passwordHash],
    );
    return {
      id: rows[0].id,
      email: rows[0].email,
      name: rows[0].name,
      createdAt: new Date(rows[0].created_at).toISOString(),
    };
  } catch (error) {
    // 23505 is unique_violation — the case-insensitive email index.
    if ((error as { code?: string }).code === "23505") throw new EmailTakenError();
    throw error;
  }
}

/**
 * Verifies a sign-in.
 *
 * Returns null for both "no such account" and "wrong password" so the
 * response cannot be used to enumerate which addresses are registered. The
 * hash comparison runs against a dummy value when the account is missing, so
 * the two paths take comparable time.
 */
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-constant-time", BCRYPT_ROUNDS);

export async function verifyCredentials(email: string, password: string): Promise<User | null> {
  const row = await findRowByEmail(email);
  const ok = await bcrypt.compare(password, row?.passwordHash ?? DUMMY_HASH);
  return row && ok ? toUser(row) : null;
}

/**
 * Creates the demo account if it is missing, so a fresh database is usable
 * without registering first. Existing rows are left alone — re-seeding would
 * reset a password someone may have changed.
 */
export async function seedDemoUser(): Promise<{ seeded: boolean; email: string }> {
  const existing = await findRowByEmail(DEMO_USER_EMAIL);
  if (existing) return { seeded: false, email: DEMO_USER_EMAIL };

  await createUser({
    email: DEMO_USER_EMAIL,
    name: DEMO_USER_NAME,
    password: DEMO_USER_PASSWORD,
  });
  return { seeded: true, email: DEMO_USER_EMAIL };
}
