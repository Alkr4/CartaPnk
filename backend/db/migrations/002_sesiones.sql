-- Tabla de sesiones para connect-pg-simple (las sesiones viven en PostgreSQL, no en memoria del proceso,
-- por lo que sobreviven a reinicios del contenedor y permiten escalar a más de una réplica).
CREATE TABLE sesiones (
  sid    varchar      NOT NULL PRIMARY KEY,
  sess   json         NOT NULL,
  expire timestamptz  NOT NULL
);
CREATE INDEX sesiones_expire_idx ON sesiones (expire);
