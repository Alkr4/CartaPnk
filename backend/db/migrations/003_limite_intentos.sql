-- Contadores del límite de intentos de login, compartidos por todas las instancias de la aplicación.
-- (Con Auto Scaling hay varias instancias detrás del balanceador: un contador en memoria de cada proceso
--  permitiría N intentos POR instancia. En PostgreSQL el límite es global.)
CREATE TABLE limite_intentos (
  clave  text        PRIMARY KEY,
  hits   integer     NOT NULL,
  expira timestamptz NOT NULL
);
CREATE INDEX limite_intentos_expira_idx ON limite_intentos (expira);
