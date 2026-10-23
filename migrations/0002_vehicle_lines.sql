-- Linhas em que cada carro apareceu nas consultas ao SIU (sem coordenadas), mantidas por 7 dias.
-- Idempotente: o Worker também cria a tabela sob demanda.
CREATE TABLE IF NOT EXISTS fb_vehicle_lines (
 vehicle_id TEXT NOT NULL,
 line TEXT NOT NULL,
 first_seen INTEGER NOT NULL,
 last_seen INTEGER NOT NULL,
 PRIMARY KEY (vehicle_id, line)
);
CREATE INDEX IF NOT EXISTS fb_vehicle_lines_last_seen ON fb_vehicle_lines(last_seen);
