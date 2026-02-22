import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

let db;

// Wrapper for PostgreSQL to mimic SQLite API
class PostgresWrapper {
  constructor(pool) {
    this.pool = pool;
  }

  // Convert SQLite "?" placeholders to Postgres "$1, $2, ..."
  _convertSql(sql) {
    let index = 1;
    return sql.replace(/\?/g, () => `$${index++}`);
  }

  async get(sql, params = []) {
    const res = await this.pool.query(this._convertSql(sql), params);
    return res.rows[0];
  }

  async all(sql, params = []) {
    const res = await this.pool.query(this._convertSql(sql), params);
    return res.rows;
  }

  async run(sql, params = []) {
    const res = await this.pool.query(this._convertSql(sql), params);
    // SQLite returns { lastID, changes }. Postgres returns { rowCount }.
    // We don't have strictly equivalent lastID without "RETURNING id" in INSERTs,
    // but the app doesn't seem to rely on lastID for Critical paths (users uses select, interviews uses manual ID).
    return { changes: res.rowCount };
  }

  async exec(sql) {
    return await this.pool.query(sql);
  }
}

export async function getDb() {
  if (db) return db;

  if (process.env.DATABASE_URL) {
    // --- POSTGRESQL ("PROD" / RENDER) ---
    console.log("Connecting to PostgreSQL...");
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false // Required for Render/some cloud DBs
      }
    });

    // Test connection
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      console.error("PostgreSQL Connection Failed:", err);
      throw err;
    }

    db = new PostgresWrapper(pool);

    // Initialize Schema for Postgres
    // Note: TEXT UNIQUE -> VARCHAR, or just TEXT is fine in PG.
    // AUTOINCREMENT -> SERIAL in PG (but we use explicit CREATE TABLE syntax).
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'user',
        last_login TEXT,
        name TEXT,
        reset_token TEXT,
        reset_token_expiry TEXT
      );
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS interviews (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        role TEXT,
        questions TEXT,
        answers TEXT,
        scores TEXT,
        feedbacks TEXT,
        date TEXT,
        type TEXT DEFAULT 'standard',
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
    `);

    // New: Resume Reviews Table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS resume_reviews (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        role TEXT,
        ats_score INTEGER,
        data TEXT,
        date TEXT,
        file_path TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
    `);

    // Migration for existing Postgres databases
    try {
      await db.exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TEXT");
    } catch (err) { console.log("Migration note (users): " + err.message); }

    try {
      await db.exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT");
    } catch (err) { console.log("Migration note (name): " + err.message); }

    try {
      await db.exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT");
    } catch (err) { console.log("Migration note (reset_token): " + err.message); }

    try {
      await db.exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expiry TEXT");
    } catch (err) { console.log("Migration note (reset_token_expiry): " + err.message); }

    try {
      await db.exec("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'standard'");
    } catch (err) { console.log("Migration note (interviews): " + err.message); }

    try {
      await db.exec("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS feedbacks TEXT DEFAULT '[]'");
    } catch (err) { console.log("Migration note (interviews feedbacks): " + err.message); }

    try {
      await db.exec("ALTER TABLE resume_reviews ADD COLUMN IF NOT EXISTS file_path TEXT");
    } catch (err) { console.log("Migration note (resume_reviews): " + err.message); }

    console.log("PostgreSQL Database initialized");

  } else {
    // --- SQLITE (LOCAL DEV) ---
    console.log("Using SQLite (local)...");
    db = await open({
      filename: './database.db',
      driver: sqlite3.Database
    });

    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'user',
        last_login TEXT,
        name TEXT,
        reset_token TEXT,
        reset_token_expiry TEXT
      );
      CREATE TABLE IF NOT EXISTS interviews (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        role TEXT,
        questions TEXT,
        answers TEXT,
        scores TEXT,
        feedbacks TEXT,
        date TEXT,
        type TEXT DEFAULT 'standard',
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS resume_reviews (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        role TEXT,
        ats_score INTEGER,
        data TEXT,
        date TEXT,
        file_path TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
    `);

    // Migration for existing SQLite databases
    try { await db.run("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'"); } catch (e) { }
    try { await db.run("ALTER TABLE users ADD COLUMN last_login TEXT"); } catch (e) { }
    try { await db.run("ALTER TABLE users ADD COLUMN name TEXT"); } catch (e) { }
    try { await db.run("ALTER TABLE users ADD COLUMN reset_token TEXT"); } catch (e) { }
    try { await db.run("ALTER TABLE users ADD COLUMN reset_token_expiry TEXT"); } catch (e) { }
    try { await db.run("ALTER TABLE interviews ADD COLUMN type TEXT DEFAULT 'standard'"); } catch (e) { }
    try { await db.run("ALTER TABLE interviews ADD COLUMN feedbacks TEXT DEFAULT '[]'"); } catch (e) { }
    try { await db.run("ALTER TABLE resume_reviews ADD COLUMN file_path TEXT"); } catch (e) { }
  }

  return db;
}
