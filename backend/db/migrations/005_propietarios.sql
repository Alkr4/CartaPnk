-- Autorización por propietario (ASVS V8): cada cuenta "admin" (dueño de restaurante) sólo gestiona SUS restaurantes.
-- El rol "superadmin" administra las cuentas de dueños y todos los restaurantes.
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_rol_check CHECK (rol IN ('superadmin', 'admin', 'cliente'));

-- La cuenta administradora que ya existía pasa a ser superadmin (es quien creó los datos actuales).
UPDATE usuarios SET rol = 'superadmin'
 WHERE id = (SELECT min(id) FROM usuarios WHERE rol = 'admin');

ALTER TABLE restaurantes
  ADD COLUMN propietario_id integer REFERENCES usuarios (id);

-- Los restaurantes existentes quedan a nombre del superadmin.
UPDATE restaurantes
   SET propietario_id = (SELECT min(id) FROM usuarios WHERE rol = 'superadmin')
 WHERE propietario_id IS NULL;

CREATE INDEX restaurantes_propietario_idx ON restaurantes (propietario_id);
