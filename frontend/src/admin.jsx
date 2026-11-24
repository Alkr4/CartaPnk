// Panel de administración (aplicación React de una sola página). Rutas con "#/..." para que Nginx sólo tenga que
// entregar admin.html. TODA la autorización se hace en la API (dueño sólo ve sus restaurantes; cuentas sólo superadmin):
// esta pantalla únicamente muestra u oculta cosas.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, cargarSesion, Dialogo, fijarCsrf, montar, moneda, Multilinea, PantallaError, rutaInterna, rutValido } from './comun.jsx';

const ROLES_PANEL = ['admin', 'superadmin'];
const Panel = createContext(null); // { usuario, irA(ruta, aviso), fallo(error) }

const rutaActual = () => window.location.hash.replace(/^#/, '') || '/';

/** GET a la API al montar la pantalla; los errores van al manejador del panel (401 -> login). */
function useDatos(ruta) {
  const { fallo } = useContext(Panel);
  const [datos, setDatos] = useState(null);
  useEffect(() => { api('GET', ruta).then(setDatos).catch(fallo); }, [ruta, fallo]);
  return datos;
}

/** Respuesta de guardado -> volver con aviso (o advertencia si la imagen no se pudo guardar). */
const guardado = (irA, volver, textoOk) => (r) =>
  irA(volver, r?.advertencia ? { tipo: 'warning', texto: r.advertencia } : { tipo: 'success', texto: textoOk });

const conChecks = (o) => ({ ...o, visible: !!o.visible, destacado: !!o.destacado });

// ------------------------------------------------------------------ piezas de interfaz
function Insignia({ texto, clase }) { return <span className={'badge badge-estado ' + clase}>{texto}</span>; }

/** Botón "Eliminar" que pide confirmación en una ventana de la página (no con confirm() del navegador). */
function BotonEliminar({ pregunta, ruta, volver }) {
  const { irA, fallo } = useContext(Panel);
  const [abierto, setAbierto] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const cerrar = useCallback(() => setAbierto(false), []);
  const eliminar = () => {
    setEliminando(true);
    api('DELETE', ruta).then(() => irA(volver, { tipo: 'success', texto: 'Eliminado' }))
      .catch((e) => { setEliminando(false); setAbierto(false); fallo(e); });
  };
  return (
    <>
      <button className="btn btn-sm btn-outline-danger" type="button" onClick={() => setAbierto(true)}>Eliminar</button>
      {abierto && (
        <Dialogo titulo="Confirmar eliminación" alCerrar={cerrar} pie={<>
          <button type="button" className="btn btn-outline-secondary" onClick={cerrar} autoFocus>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={eliminar} disabled={eliminando}>Sí, eliminar</button>
        </>}>{pregunta}</Dialogo>
      )}
    </>
  );
}

function Pantalla({ titulo, children }) {
  return <><h1 className="h3 mb-3">{titulo}</h1>{children}</>;
}

const MAX_IMAGEN = 2 * 1024 * 1024;

/**
 * Un campo de texto/número con validación en el navegador: reglas HTML (required, min, max, pattern, maxlength), una
 * comprobación propia opcional (`c.validar(valor)` -> mensaje) y el error que devuelva la API, todo vía setCustomValidity.
 * Bootstrap pinta el borde rojo/verde (.was-validated) y el resplandor del foco; el mensaje va bajo el campo.
 */
function Campo({ c, valor, errorApi }) {
  const id = 'f-' + c.nombre;
  const ref = useRef(null);
  const [mensaje, setMensaje] = useState('');
  const revisar = useCallback((el, deLaApi) => {
    const propio = !deLaApi && el.value && c.validar ? c.validar(el.value) : '';
    el.setCustomValidity(deLaApi || propio || '');
    setMensaje(el.validity.valid ? '' : (deLaApi || propio || c.ayuda || el.validationMessage));
  }, [c]);
  useEffect(() => { revisar(ref.current, errorApi); }, [errorApi, revisar]);

  const comunes = {
    ref, id, name: c.nombre, className: 'form-control', defaultValue: String(valor), required: c.requerido,
    maxLength: c.max, minLength: c.minimo, min: c.min, max: c.tope, step: c.tipo === 'number' ? 1 : undefined,
    pattern: c.patron, inputMode: c.tipo === 'number' ? 'numeric' : undefined,
    'aria-describedby': id + '-ayuda ' + id + '-error', onInput: (e) => revisar(e.currentTarget),
  };
  return (
    <div className={'mb-3 ' + (c.col || 'col-12')}>
      <label className="form-label" htmlFor={id}>{c.etiqueta}{c.requerido && ' *'}</label>
      {c.tipo === 'textarea' ? <textarea rows={3} {...comunes} />
        : <input type={c.tipo || 'text'} autoComplete={c.tipo === 'password' ? 'new-password' : undefined} {...comunes} />}
      <div className="invalid-feedback" id={id + '-error'}>{mensaje || 'Revisa este campo'}</div>
      {c.ayuda && <div className="form-text" id={id + '-ayuda'}>{c.ayuda}</div>}
    </div>
  );
}

/**
 * Formulario declarativo. campos: [{ nombre, etiqueta, tipo: text|number|email|password|textarea|check|foto, requerido,
 * max (largo), minimo (largo), min / tope (valor numérico), patron (regex HTML), validar(valor) -> mensaje, ayuda, col }]
 * Primero valida el navegador (no se envía nada inválido); la API vuelve a validar todo y, si responde 422 con { errores },
 * esos mensajes se muestran en los mismos campos. `enviar(FormData)` devuelve una promesa.
 */
function Formulario({ campos, valores = {}, fotoUrl, volver, enviar }) {
  const { fallo } = useContext(Panel);
  const [errores, setErrores] = useState(null);
  const [validado, setValidado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const alEnviar = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    setValidado(true);
    if (!form.checkValidity()) {
      form.querySelector(':invalid')?.focus();
      return;
    }
    setEnviando(true);
    enviar(new FormData(form)).catch((err) => {
      setEnviando(false);
      if (err.status === 422 && err.errores) setErrores(err.errores); else fallo(err);
    });
  };
  const revisarImagen = (e) => {
    const f = e.currentTarget.files[0];
    e.currentTarget.setCustomValidity(f && f.size > MAX_IMAGEN ? 'La imagen supera los 2 MB' : '');
  };

  return (
    <form className={'card card-body' + (validado ? ' was-validated' : '')} noValidate onSubmit={alEnviar}>
      {errores && <div className="alert alert-danger py-2" role="alert">Revisa los campos marcados.</div>}
      <div className="row">
        {campos.map((c) => {
          const id = 'f-' + c.nombre;
          const v = valores[c.nombre] ?? '';
          if (c.tipo === 'check') {
            return (
              <div key={c.nombre} className="col-12 form-check form-switch mb-2 ms-2">
                <input className="form-check-input" type="checkbox" role="switch" id={id} name={c.nombre} defaultChecked={v === true || v === 'on'} />
                <label className="form-check-label" htmlFor={id}>{c.etiqueta}</label>
              </div>
            );
          }
          if (c.tipo === 'foto') {
            return (
              <div key={c.nombre} className="col-12 mb-3">
                <label className="form-label" htmlFor={id}>Imagen (JPG, PNG o WEBP, máx. 2 MB)</label>
                {fotoUrl && <div className="mb-2"><img className="thumb-lg" src={rutaInterna(fotoUrl, '')} alt="Imagen actual" /></div>}
                <input className="form-control" type="file" id={id} name="foto" accept="image/jpeg,image/png,image/webp" onChange={revisarImagen} />
                <div className="invalid-feedback">La imagen supera los 2 MB</div>
                {fotoUrl && (
                  <div className="form-check mt-2">
                    <input className="form-check-input" type="checkbox" id="f-quitar" name="quitar_foto" />
                    <label className="form-check-label" htmlFor="f-quitar">Quitar la imagen actual</label>
                  </div>
                )}
              </div>
            );
          }
          return <Campo key={c.nombre} c={c} valor={v} errorApi={errores?.[c.nombre]} />;
        })}
      </div>
      <div className="mt-3">
        <button className="btn btn-dark" type="submit" disabled={enviando}>Guardar</button>{' '}
        <a className="btn btn-outline-secondary" href={'#' + volver}>Cancelar</a>
      </div>
    </form>
  );
}

const CAMPOS_RESTAURANTE = [
  { nombre: 'nombre', etiqueta: 'Nombre', requerido: true, max: 200, col: 'col-md-8' },
  { nombre: 'rut', etiqueta: 'RUT', requerido: true, max: 12, col: 'col-md-4', patron: '[0-9.]{1,10}-[0-9kK]',
    validar: (v) => (rutValido(v) ? '' : 'El dígito verificador no corresponde a este RUT'), ayuda: 'Con guion y dígito verificador, p. ej. 76.123.456-0' },
  { nombre: 'fono', etiqueta: 'Teléfono', requerido: true, max: 45, col: 'col-md-6', patron: String.raw`[0-9+\(\)\-\s]{3,45}`,
    ayuda: 'Sólo números, espacios, +, ( ) y guion' },
  { nombre: 'email', etiqueta: 'Correo', tipo: 'email', max: 100, col: 'col-md-6' },
  { nombre: 'calle', etiqueta: 'Calle', requerido: true, max: 100, col: 'col-md-6' },
  { nombre: 'numero', etiqueta: 'Número', requerido: true, max: 15, col: 'col-md-2', patron: String.raw`[0-9A-Za-z\/#\s\-]{1,15}`, ayuda: 'p. ej. 123 o S/N' },
  { nombre: 'comuna', etiqueta: 'Comuna', requerido: true, max: 100, col: 'col-md-4' },
  { nombre: 'region', etiqueta: 'Región', max: 100, col: 'col-md-6' },
  { nombre: 'foto', tipo: 'foto' },
];
const CAMPOS_SIMPLES = [
  { nombre: 'nombre', etiqueta: 'Nombre', requerido: true, max: 45 },
  { nombre: 'orden', etiqueta: 'Orden (número menor = primero)', tipo: 'number', min: 0, tope: 9999, ayuda: 'Entero entre 0 y 9.999' },
  { nombre: 'visible', etiqueta: 'Visible en el sitio', tipo: 'check' },
];
const CAMPOS_ITEM = [
  { nombre: 'nombre', etiqueta: 'Nombre', requerido: true, max: 100, col: 'col-md-8' },
  { nombre: 'precio', etiqueta: 'Precio ($)', tipo: 'number', col: 'col-md-4', min: 1, tope: 1000000, ayuda: 'Entre $1 y $1.000.000, sin puntos' },
  { nombre: 'descripcion', etiqueta: 'Descripción', tipo: 'textarea', max: 300 },
  { nombre: 'observaciones', etiqueta: 'Observaciones', tipo: 'textarea', max: 300 },
  { nombre: 'tiempo', etiqueta: 'Tiempo de preparación', max: 100, col: 'col-md-6' },
  { nombre: 'puntuacion', etiqueta: 'Puntuación (0 a 5)', tipo: 'number', col: 'col-md-3', min: 0, tope: 5 },
  { nombre: 'orden', etiqueta: 'Orden', tipo: 'number', col: 'col-md-3', min: 0, tope: 9999 },
  { nombre: 'visible', etiqueta: 'Visible en el sitio', tipo: 'check' },
  { nombre: 'destacado', etiqueta: 'Destacado (carrusel de menús destacados)', tipo: 'check' },
  { nombre: 'foto', tipo: 'foto' },
];
const CAMPOS_CUENTA = [
  { nombre: 'nombre', etiqueta: 'Nombre', requerido: true, max: 255 },
  { nombre: 'email', etiqueta: 'Correo', tipo: 'email', requerido: true, max: 255 },
  { nombre: 'password', etiqueta: 'Contraseña inicial', tipo: 'password', requerido: true, max: 128, minimo: 12, ayuda: 'Entre 12 y 128 caracteres' },
];

// ------------------------------------------------------------------ pantallas
function ListaRestaurantes() {
  const d = useDatos('/admin/restaurantes');
  if (!d) return null;
  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h3 m-0">Restaurantes</h1><a className="btn btn-dark" href="#/restaurantes/nuevo">Nuevo restaurante</a>
      </div>
      {d.restaurantes.length === 0 ? <p className="text-muted">Aún no hay restaurantes. Crea el primero.</p> : (
        <div className="table-responsive card card-body p-0"><table className="table align-middle m-0">
          <thead><tr>{['', 'Nombre', 'Dirección', 'Contacto', 'Cartas', 'Comentarios', ''].map((t, i) => <th key={i}>{t}</th>)}</tr></thead>
          <tbody>
            {d.restaurantes.map((r) => (
              <tr key={r.id}>
                <td>{r.fotoUrl && <img className="thumb" src={rutaInterna(r.fotoUrl, '')} alt="" />}</td>
                <td><a href={'#/restaurantes/' + r.id}>{r.nombre}</a></td>
                <td>{r.calle} {r.numero}, {r.comuna}</td>
                <td>{r.fono}<br /><small className="text-muted">{r.email || ''}</small></td>
                <td className="text-end">{r.cartas}</td><td className="text-end">{r.comentarios}</td>
                <td className="text-end text-nowrap">
                  <a className="btn btn-sm btn-outline-dark" href={'#/restaurantes/' + r.id}>Administrar</a>{' '}
                  <a className="btn btn-sm btn-outline-secondary" href={'/restaurantes/' + r.id} target="_blank" rel="noopener noreferrer">Ver</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  );
}

function DetalleRestaurante({ id }) {
  const d = useDatos('/admin/restaurantes/' + id);
  if (!d) return null;
  const r = d.restaurante;
  const volver = '/restaurantes/' + id;
  return (
    <>
      <nav aria-label="breadcrumb"><ol className="breadcrumb">
        <li className="breadcrumb-item"><a href="#/">Restaurantes</a></li><li className="breadcrumb-item active">{r.nombre}</li>
      </ol></nav>
      <div className="card card-body mb-4"><div className="d-flex gap-3 align-items-start flex-wrap">
        {r.fotoUrl && <img className="thumb-lg" src={rutaInterna(r.fotoUrl, '')} alt="" />}
        <div className="flex-grow-1">
          <h1 className="h4">{r.nombre}</h1>
          <div className="text-muted small">RUT {r.rut} · {r.fono} · {r.email || ''}</div>
          <div className="text-muted small">{r.calle} {r.numero}, {r.comuna} {r.region || ''}</div>
        </div>
        <div className="text-nowrap">
          <a className="btn btn-sm btn-outline-dark" href={'#/restaurantes/' + id + '/editar'}>Editar</a>{' '}
          <BotonEliminar pregunta="¿Eliminar el restaurante? Dejará de verse en el sitio." ruta={'/admin/restaurantes/' + id} volver="/" />
        </div>
      </div></div>

      <div className="d-flex justify-content-between align-items-center mb-2">
        <h2 className="h5 m-0">Cartas</h2><a className="btn btn-sm btn-dark" href={'#/restaurantes/' + id + '/cartas/nueva'}>Nueva carta</a>
      </div>
      {d.cartas.length === 0 && <p className="text-muted">Sin cartas todavía.</p>}
      {d.cartas.map((c) => (
        <div className="card card-body" key={c.id}>
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <strong>{c.nombre} {!c.visible && <Insignia texto="oculta" clase="bg-secondary" />}</strong>
            <div>
              <a className="btn btn-sm btn-outline-dark" href={'#/cartas/' + c.id + '/categorias/nueva'}>Nueva categoría</a>{' '}
              <a className="btn btn-sm btn-outline-secondary" href={'#/cartas/' + c.id + '/editar'}>Editar</a>{' '}
              <BotonEliminar pregunta="¿Eliminar la carta?" ruta={'/admin/cartas/' + c.id} volver={volver} />
            </div>
          </div>
          {c.categorias.map((k) => (
            <div className="tree-level-1 mt-3" key={k.id}>
              <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                <span>{k.nombre} {!k.visible && <Insignia texto="oculta" clase="bg-secondary" />}</span>
                <div>
                  <a className="btn btn-sm btn-outline-dark" href={'#/categorias/' + k.id + '/items/nuevo'}>Nuevo platillo</a>{' '}
                  <a className="btn btn-sm btn-outline-secondary" href={'#/categorias/' + k.id + '/editar'}>Editar</a>{' '}
                  <BotonEliminar pregunta="¿Eliminar la categoría?" ruta={'/admin/categorias/' + k.id} volver={volver} />
                </div>
              </div>
              {k.items.map((it) => (
                <div className="tree-level-2 mt-2 d-flex justify-content-between align-items-center flex-wrap gap-2" key={it.id}>
                  <span className="d-flex align-items-center gap-2">
                    {it.fotoUrl && <img className="thumb" src={rutaInterna(it.fotoUrl, '')} alt="" />}
                    <span>{it.nombre}{' '}
                      {it.precio !== null && <small className="text-muted">{moneda(it.precio)}</small>}{' '}
                      {it.destacado && <Insignia texto="destacado" clase="bg-warning text-dark" />}{' '}
                      {!it.visible && <Insignia texto="oculto" clase="bg-secondary" />}
                    </span>
                  </span>
                  <div>
                    <a className="btn btn-sm btn-outline-secondary" href={'#/items/' + it.id + '/editar'}>Editar</a>{' '}
                    <BotonEliminar pregunta="¿Eliminar el platillo?" ruta={'/admin/items/' + it.id} volver={volver} />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}

      <h2 className="h5 mt-4">Comentarios ({d.comentarios.length})</h2>
      {d.comentarios.length === 0 && <p className="text-muted">Sin comentarios.</p>}
      {d.comentarios.map((c) => (
        <div className="card card-body d-flex flex-row justify-content-between align-items-start gap-3" key={c.id}>
          <div><strong>{c.usuario}</strong><div><Multilinea texto={c.comentario} /></div></div>
          <BotonEliminar pregunta="¿Eliminar el comentario?" ruta={'/admin/comentarios/' + c.id} volver={volver} />
        </div>
      ))}
    </>
  );
}

function NuevoRestaurante() {
  const { irA } = useContext(Panel);
  return (
    <Pantalla titulo="Nuevo restaurante">
      <Formulario campos={CAMPOS_RESTAURANTE} volver="/"
        enviar={(fd) => api('POST', '/admin/restaurantes', fd).then((r) => guardado(irA, '/restaurantes/' + r.id, 'Restaurante creado')(r))} />
    </Pantalla>
  );
}

/**
 * Formulario que primero consulta un registro: para editarlo, o (si `nuevo`) sólo para saber a qué restaurante volver.
 * `clave` es el nombre del registro en la respuesta (restaurante, carta, categoria, item); `guardar` la ruta del POST/PUT.
 */
function FormConRegistro({ ruta, clave, titulo, campos, nuevo, guardar, textoOk }) {
  const { irA } = useContext(Panel);
  const d = useDatos(ruta);
  if (!d) return null;
  const reg = d[clave];
  const volver = '/restaurantes/' + (reg.restaurante_id ?? reg.id);
  return (
    <Pantalla titulo={titulo}>
      <Formulario campos={campos} valores={nuevo ? { visible: true } : conChecks(reg)} fotoUrl={nuevo ? null : reg.fotoUrl} volver={volver}
        enviar={(fd) => api(nuevo ? 'POST' : 'PUT', guardar, fd).then(guardado(irA, volver, textoOk))} />
    </Pantalla>
  );
}

/** Cuentas de dueños (sólo superadmin; la API responde 403 a cualquier otro rol). */
function Cuentas() {
  const { irA, fallo } = useContext(Panel);
  const d = useDatos('/admin/usuarios');
  if (!d) return null;
  const cambiar = (u) => api('PATCH', '/admin/usuarios/' + u.id, { activo: !u.activo })
    .then(() => irA('/cuentas', { tipo: 'success', texto: u.activo ? 'Cuenta desactivada' : 'Cuenta activada' })).catch(fallo);
  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h3 m-0">Cuentas</h1><a className="btn btn-dark" href="#/cuentas/nueva">Nueva cuenta de dueño</a>
      </div>
      <div className="table-responsive card card-body p-0"><table className="table align-middle m-0">
        <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th className="text-end">Restaurantes</th><th>Estado</th><th /></tr></thead>
        <tbody>
          {d.usuarios.map((u) => (
            <tr key={u.id}>
              <td>{u.nombre}</td><td>{u.email}</td><td>{u.rol === 'superadmin' ? 'superadmin' : 'dueño'}</td>
              <td className="text-end">{u.restaurantes}</td>
              <td>{u.activo ? <Insignia texto="activa" clase="bg-success" /> : <Insignia texto="desactivada" clase="bg-secondary" />}</td>
              <td className="text-end">
                {u.rol === 'admin' && (
                  <button type="button" className={'btn btn-sm ' + (u.activo ? 'btn-outline-danger' : 'btn-outline-success')} onClick={() => cambiar(u)}>
                    {u.activo ? 'Desactivar' : 'Activar'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}

function NuevaCuenta() {
  const { irA } = useContext(Panel);
  return (
    <Pantalla titulo="Nueva cuenta de dueño">
      <Formulario campos={CAMPOS_CUENTA} volver="/cuentas"
        enviar={(fd) => api('POST', '/admin/usuarios', Object.fromEntries(fd)).then(() => irA('/cuentas', { tipo: 'success', texto: 'Cuenta creada' }))} />
    </Pantalla>
  );
}

// ------------------------------------------------------------------ rutas
const RUTAS = [
  [/^\/$/, () => <ListaRestaurantes />],
  [/^\/restaurantes\/nuevo$/, () => <NuevoRestaurante />],
  [/^\/restaurantes\/(\d+)$/, (id) => <DetalleRestaurante id={id} />],
  [/^\/restaurantes\/(\d+)\/editar$/, (id) => <FormConRegistro ruta={'/admin/restaurantes/' + id} clave="restaurante" titulo="Editar restaurante"
    campos={CAMPOS_RESTAURANTE} guardar={'/admin/restaurantes/' + id} textoOk="Restaurante actualizado" />],
  [/^\/restaurantes\/(\d+)\/cartas\/nueva$/, (id) => <FormConRegistro ruta={'/admin/restaurantes/' + id} clave="restaurante" titulo="Nueva carta" nuevo
    campos={CAMPOS_SIMPLES} guardar={'/admin/restaurantes/' + id + '/cartas'} textoOk="Carta creada" />],
  [/^\/cartas\/(\d+)\/editar$/, (id) => <FormConRegistro ruta={'/admin/cartas/' + id} clave="carta" titulo="Editar carta"
    campos={CAMPOS_SIMPLES} guardar={'/admin/cartas/' + id} textoOk="Carta actualizada" />],
  [/^\/cartas\/(\d+)\/categorias\/nueva$/, (id) => <FormConRegistro ruta={'/admin/cartas/' + id} clave="carta" titulo="Nueva categoría" nuevo
    campos={CAMPOS_SIMPLES} guardar={'/admin/cartas/' + id + '/categorias'} textoOk="Categoría creada" />],
  [/^\/categorias\/(\d+)\/editar$/, (id) => <FormConRegistro ruta={'/admin/categorias/' + id} clave="categoria" titulo="Editar categoría"
    campos={CAMPOS_SIMPLES} guardar={'/admin/categorias/' + id} textoOk="Categoría actualizada" />],
  [/^\/categorias\/(\d+)\/items\/nuevo$/, (id) => <FormConRegistro ruta={'/admin/categorias/' + id} clave="categoria" titulo="Nuevo platillo" nuevo
    campos={CAMPOS_ITEM} guardar={'/admin/categorias/' + id + '/items'} textoOk="Platillo creado" />],
  [/^\/items\/(\d+)\/editar$/, (id) => <FormConRegistro ruta={'/admin/items/' + id} clave="item" titulo="Editar platillo"
    campos={CAMPOS_ITEM} guardar={'/admin/items/' + id} textoOk="Platillo actualizado" />],
  [/^\/cuentas$/, () => <Cuentas />],
  [/^\/cuentas\/nueva$/, () => <NuevaCuenta />],
];

function pantallaDe(ruta) {
  for (const [patron, crear] of RUTAS) {
    const m = ruta.match(patron);
    if (m) return crear(m[1]);
  }
  return <p>Pantalla no encontrada. <a href="#/">Volver al inicio</a></p>;
}

// ------------------------------------------------------------------ acceso
function Login({ alEntrar }) {
  const [error, setError] = useState(null);
  const entrar = (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    // se pide la sesión justo antes: tras "Cerrar sesión" (o si la sesión venció) el token CSRF guardado ya no corresponde
    cargarSesion().then(() => api('POST', '/admin/login', { email: f.get('email'), password: f.get('password') })).then((r) => {
      fijarCsrf(r.csrfToken); // la sesión se renueva al entrar: token CSRF nuevo
      alEntrar(r.usuario);
    }).catch((err) => setError(err.message));
  };
  return (
    <div className="container"><div className="row justify-content-center"><div className="col-sm-8 col-md-5 col-lg-4">
      <div className="card login-card shadow-sm"><div className="card-body p-4">
        <div className="text-center mb-3"><img src="/img/logo.png" width="150" alt="" /></div>
        <h1 className="h5 text-center mb-3">Acceso de administración</h1>
        <form noValidate onSubmit={entrar}>
          {error && <div className="alert alert-danger py-2" role="alert">{error}</div>}
          <div className="mb-3"><label className="form-label" htmlFor="email">Correo</label>
            <input className="form-control" type="email" id="email" name="email" maxLength={255} autoComplete="username" required autoFocus /></div>
          <div className="mb-3"><label className="form-label" htmlFor="password">Contraseña</label>
            <input className="form-control" type="password" id="password" name="password" maxLength={1024} autoComplete="current-password" required /></div>
          <button type="submit" className="btn btn-dark w-100">Ingresar</button>
        </form>
      </div></div>
    </div></div></div>
  );
}

function Barra({ usuario, alSalir }) {
  return (
    <nav className="navbar navbar-dark bg-dark admin-nav"><div className="container-fluid">
      <a className="navbar-brand" href="#/">PNK · Administración</a>
      <div className="d-flex align-items-center gap-3">
        {usuario.rol === 'superadmin' && <a className="text-light small" href="#/cuentas">Cuentas</a>}
        <a className="text-light small" href="/" target="_blank" rel="noopener noreferrer">Ver sitio público</a>
        <span className="text-light small">{usuario.nombre}</span>
        <button className="btn btn-sm btn-outline-light" type="button" onClick={alSalir}>Cerrar sesión</button>
      </div>
    </div></nav>
  );
}

// ------------------------------------------------------------------ raíz
export function Admin() {
  const [usuario, setUsuario] = useState(undefined); // undefined = consultando, null = sin sesión de panel
  const [errorSesion, setErrorSesion] = useState(null);
  // `n` cambia en cada navegación: la pantalla se vuelve a montar (y a consultar la API) aunque la ruta sea la misma
  const [nav, setNav] = useState({ ruta: rutaActual(), aviso: null, n: 0 });
  const avisoPendiente = useRef(null);

  useEffect(() => {
    cargarSesion().then((s) => setUsuario(ROLES_PANEL.includes(s.usuario?.rol) ? s.usuario : null)).catch(setErrorSesion);
    const alCambiar = () => {
      const aviso = avisoPendiente.current;
      avisoPendiente.current = null;
      setNav((p) => ({ ruta: rutaActual(), aviso, n: p.n + 1 }));
    };
    window.addEventListener('hashchange', alCambiar);
    return () => window.removeEventListener('hashchange', alCambiar);
  }, []);

  const irA = useCallback((ruta, aviso = null) => {
    if (rutaActual() === ruta) { setNav((p) => ({ ruta, aviso, n: p.n + 1 })); return; }
    avisoPendiente.current = aviso;
    window.location.hash = ruta;
  }, []);
  const fallo = useCallback((e) => {
    if (e.status === 401) setUsuario(null); // sesión vencida o cuenta desactivada: vuelve al login
    else setNav((p) => ({ ...p, aviso: { tipo: 'danger', texto: e.message } }));
  }, []);
  const salir = () => api('POST', '/admin/logout').catch(() => {}).finally(() => { fijarCsrf(null); setUsuario(null); window.location.hash = '#/'; });

  if (errorSesion) return <PantallaError estado={errorSesion.status || 500} mensaje={errorSesion.message} />;
  if (usuario === undefined) return null;
  if (!usuario) return <Login alEntrar={(u) => { setUsuario(u); irA('/'); }} />;
  return (
    <Panel.Provider value={{ usuario, irA, fallo }}>
      <Barra usuario={usuario} alSalir={salir} />
      <main className="container admin-main">
        {nav.aviso && <div className={'alert mt-3 alert-' + nav.aviso.tipo} role="alert">{nav.aviso.texto}</div>}
        <div key={nav.n}>{pantallaDe(nav.ruta)}</div>
      </main>
    </Panel.Provider>
  );
}

if (document.getElementById('app')) montar(Admin);
