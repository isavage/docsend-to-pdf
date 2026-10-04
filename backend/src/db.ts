import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { CONFIG } from './config.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = CONFIG.dbPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                    TEXT PRIMARY KEY,
      email                 TEXT UNIQUE,
      password_hash         TEXT,
      google_id             TEXT UNIQUE,
      name                  TEXT,
      email_verified        INTEGER NOT NULL DEFAULT 0,
      created_at            INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash  TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at  INTEGER NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS tokens (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL,          -- 'verify' | 'reset'
      token_hash  TEXT NOT NULL,
      expires_at  INTEGER NOT NULL,
      used_at     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tokens_hash ON tokens(token_hash);
  `);

  return db;
}

export interface UserRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  google_id: string | null;
  name: string | null;
  email_verified: number;
  created_at: number;
}

export interface PublicUser {
  id: string;
  email: string | null;
  name: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  hasGoogle: boolean;
}

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    emailVerified: u.email_verified === 1,
    hasPassword: !!u.password_hash,
    hasGoogle: !!u.google_id,
  };
}
