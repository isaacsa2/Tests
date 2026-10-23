-- FeiraBus: dados agregados de transporte, sem perfis pessoais ou rastros históricos por veículo.
-- Seguro para aplicação idempotente: nunca elimina tabelas preexistentes.
CREATE TABLE IF NOT EXISTS fb_lines (
 id TEXT PRIMARY KEY NOT NULL,
 number TEXT NOT NULL DEFAULT '',
 name TEXT NOT NULL DEFAULT '',
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS fb_routes (
 id TEXT PRIMARY KEY NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS fb_vehicles (
 id TEXT PRIMARY KEY NOT NULL,
 line TEXT NOT NULL DEFAULT '',
 lat REAL NOT NULL,
 lon REAL NOT NULL,
 heading REAL,
 itinerary TEXT,
 observed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fb_vehicles_last_seen ON fb_vehicles(observed_at);
CREATE TABLE IF NOT EXISTS fb_schedules (
 line_id TEXT PRIMARY KEY NOT NULL,
 payload TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
