-- Roles de usuario: sólo el rol "admin" puede entrar al panel de administración (/admin).
ALTER TABLE usuarios
  ADD COLUMN rol varchar(20) NOT NULL DEFAULT 'cliente' CHECK (rol IN ('admin', 'cliente'));

-- Bases de datos que ya existen: el primer usuario creado era el administrador (en producción es el definido
-- con ADMIN_EMAIL; en dev/QA es admin@gmail.com). Se conserva su acceso al panel.
UPDATE usuarios SET rol = 'admin' WHERE id = (SELECT min(id) FROM usuarios);
