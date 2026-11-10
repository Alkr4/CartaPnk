-- Esquema PostgreSQL de PNK Security (migrado desde el script MySQL original `pnk_security.sql`).
-- Cambios respecto al original:
--   * bit(1) -> boolean, datetime -> timestamptz, AUTO_INCREMENT -> GENERATED ... AS IDENTITY
--   * claves foráneas, restricciones CHECK e índices que el esquema MySQL no definía
--   * `restautantes` (typo) -> `restaurantes`; columnas *_id en singular y en minúsculas
--   * contraseñas: la columna guarda un hash bcrypt, nunca texto plano

CREATE TABLE direcciones (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  calle       varchar(100) NOT NULL,
  numero      varchar(15)  NOT NULL,
  comuna      varchar(100) NOT NULL,
  region      varchar(100),
  creado      timestamptz  NOT NULL DEFAULT now(),
  actualizado timestamptz,
  eliminado   timestamptz
);

CREATE TABLE restaurantes (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rut          varchar(11)  NOT NULL,
  nombre       varchar(200) NOT NULL,
  fono         varchar(45)  NOT NULL,
  mapa         varchar(200),
  foto         varchar(200),
  email        varchar(100),
  creado       timestamptz  NOT NULL DEFAULT now(),
  actualizado  timestamptz,
  eliminado    timestamptz,
  direccion_id integer      NOT NULL REFERENCES direcciones (id)
);

CREATE TABLE cartas (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre         varchar(45),
  orden          integer,
  visible        boolean     NOT NULL DEFAULT true,
  foto           varchar(200),
  creada         timestamptz NOT NULL DEFAULT now(),
  actualizada    timestamptz,
  eliminada      timestamptz,
  restaurante_id integer     NOT NULL REFERENCES restaurantes (id)
);

CREATE TABLE categorias (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre      varchar(100) NOT NULL,
  visible     boolean      NOT NULL DEFAULT false,
  foto        varchar(200),
  orden       integer,
  creado      timestamptz  NOT NULL DEFAULT now(),
  actualizado timestamptz,
  eliminado   timestamptz,
  carta_id    integer      NOT NULL REFERENCES cartas (id)
);

CREATE TABLE items (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre        varchar(100) NOT NULL,
  descripcion   varchar(300),
  tiempo        varchar(100),
  observaciones varchar(300),
  precio        integer CHECK (precio IS NULL OR precio >= 0),
  visible       boolean      NOT NULL DEFAULT false,
  destacado     boolean      NOT NULL DEFAULT false,
  puntuacion    integer      NOT NULL DEFAULT 0 CHECK (puntuacion BETWEEN 0 AND 5),
  foto          varchar(200),
  orden         integer,
  creado        timestamptz  NOT NULL DEFAULT now(),
  actualizado   timestamptz,
  eliminado     timestamptz,
  categoria_id  integer      NOT NULL REFERENCES categorias (id)
);

CREATE TABLE usuarios (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre        varchar(255) NOT NULL,
  email         varchar(255) NOT NULL,
  password_hash varchar(255) NOT NULL,
  activo        boolean      NOT NULL DEFAULT true,
  creado        timestamptz  NOT NULL DEFAULT now()
);
-- el correo es el identificador de acceso: único sin distinguir mayúsculas
CREATE UNIQUE INDEX usuarios_email_uq ON usuarios (lower(email));

CREATE TABLE comentarios (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id     integer       NOT NULL REFERENCES usuarios (id),
  restaurante_id integer       NOT NULL REFERENCES restaurantes (id),
  comentario     varchar(1000) NOT NULL,
  creado         timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX cartas_restaurante_idx      ON cartas (restaurante_id);
CREATE INDEX categorias_carta_idx        ON categorias (carta_id);
CREATE INDEX items_categoria_idx         ON items (categoria_id);
CREATE INDEX items_destacado_idx         ON items (destacado) WHERE destacado;
CREATE INDEX comentarios_restaurante_idx ON comentarios (restaurante_id, id);
