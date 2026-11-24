// Utilidades comunes del frontend React. React inserta todo el contenido de la API como TEXTO (escapa < > & "), así que
// un nombre o comentario con "<script>" se muestra tal cual y no se ejecuta (anti-XSS). Por eso está prohibida
// la vía de React para insertar HTML sin escapar (regla de ESLint y prueba automática).
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

// ------------------------------------------------------------------ API
let csrf = null;

/** Estado de la sesión ({ usuario, csrfToken }) y guarda el token CSRF. */
export async function cargarSesion() {
  const res = await fetch('/api/sesion', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const d = await res.json();
  csrf = d.csrfToken;
  return d;
}

export function fijarCsrf(token) { csrf = token; }

/**
 * Llama a la API (mismo origen: /api/…). Las peticiones que cambian estado envían el token CSRF en X-CSRF-Token.
 * `cuerpo` puede ser un objeto (JSON) o un FormData (formularios con imagen).
 * Lanza Error con .status y, si la API lo informa, .errores = { campo: mensaje }.
 */
export async function api(metodo, ruta, cuerpo) {
  const opciones = { method: metodo, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (metodo !== 'GET') {
    if (!csrf) await cargarSesion();
    opciones.headers['X-CSRF-Token'] = csrf;
  }
  if (cuerpo instanceof FormData) {
    opciones.body = cuerpo;
  } else if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }
  const res = await fetch('/api' + ruta, opciones);
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(datos.error || 'Error ' + res.status);
    err.status = res.status;
    err.errores = datos.errores;
    throw err;
  }
  return datos;
}

// ------------------------------------------------------------------ formato y validación de URL
/** Sólo se aceptan rutas internas ("/media/…", "/imagenes/…") para src/href que vienen de la API (bloquea javascript:, //otro). */
export function rutaInterna(url, porDefecto) {
  return typeof url === 'string' && /^\/[^/\\]/.test(url) ? url : porDefecto;
}

/** 12500 -> "$ 12.500" (igual que el sitio original). */
export function moneda(n) {
  const v = Number.isFinite(Number(n)) ? Math.trunc(Number(n)) : 0;
  return '$ ' + new Intl.NumberFormat('es-CL').format(v);
}

/** RUT chileno con dígito verificador correcto (módulo 11). La API hace la misma comprobación; aquí sólo es para avisar antes. */
export function rutValido(rut) {
  const m = /^(\d{1,8})-([\dK])$/.exec(String(rut).replace(/\./g, '').toUpperCase());
  if (!m) return false;
  let suma = 0;
  let factor = 2;
  for (const d of m[1].split('').reverse()) {
    suma += Number(d) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  return m[2] === (resto === 11 ? '0' : resto === 10 ? 'K' : String(resto));
}

/** Título de la pestaña del navegador. */
export function useTitulo(titulo) {
  useEffect(() => { if (titulo) document.title = titulo; }, [titulo]);
}

// ------------------------------------------------------------------ componentes
/** Texto con saltos de línea -> líneas separadas por <br> (equivale a nl2br(htmlspecialchars())). */
export function Multilinea({ texto }) {
  return String(texto).split(/\r\n|\r|\n/).map((linea, i) => <span key={i}>{i > 0 && <br />}{linea}</span>);
}

const ICONOS = {
  alarma: { tam: '1em', d: ['M6.5 0a.5.5 0 0 0 0 1H7v1.07a7.001 7.001 0 0 0-3.273 12.474l-.602.602a.5.5 0 0 0 .707.708l.746-.746A6.97 6.97 0 0 0 8 16a6.97 6.97 0 0 0 3.422-.892l.746.746a.5.5 0 0 0 .707-.708l-.601-.602A7.001 7.001 0 0 0 9 2.07V1h.5a.5.5 0 0 0 0-1h-3zm1.038 3.018a6.093 6.093 0 0 1 .924 0 6 6 0 1 1-.924 0zM8.5 5.5a.5.5 0 0 0-1 0v3.362l-1.429 2.38a.5.5 0 1 0 .858.515l1.5-2.5A.5.5 0 0 0 8.5 9V5.5zM0 3.5c0 .753.333 1.429.86 1.887A8.035 8.035 0 0 1 4.387 1.86 2.5 2.5 0 0 0 0 3.5zM13.5 1c-.753 0-1.429.333-1.887.86a8.035 8.035 0 0 1 3.527 3.527A2.5 2.5 0 0 0 13.5 1z'] },
  basurero: { tam: '2em', clase: 'text-danger', d: ['M2.5 1a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1H3v9a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V4h.5a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1H2.5zm3 4a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 .5-.5zM8 5a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7A.5.5 0 0 1 8 5zm3 .5a.5.5 0 0 0-1 0v7a.5.5 0 0 0 1 0v-7z'] },
  carrito: { tam: '2em', d: ['M0 2.5A.5.5 0 0 1 .5 2H2a.5.5 0 0 1 .485.379L2.89 4H14.5a.5.5 0 0 1 .485.621l-1.5 6A.5.5 0 0 1 13 11H4a.5.5 0 0 1-.485-.379L1.61 3H.5a.5.5 0 0 1-.5-.5zM3.14 5l.5 2H5V5H3.14zM6 5v2h2V5H6zm3 0v2h2V5H9zm3 0v2h1.36l.5-2H12zm1.11 3H12v2h.61l.5-2zM11 8H9v2h2V8zM8 8H6v2h2V8zM5 8H3.89l.5 2H5V8zm0 5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm-2 1a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm9-1a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm-2 1a2 2 0 1 1 4 0 2 2 0 0 1-4 0z'] },
  correo: { tam: '1em', d: ['M.05 3.555A2 2 0 0 1 2 2h12a2 2 0 0 1 1.95 1.555L8 8.414.05 3.555zM0 4.697v7.104l5.803-3.558L0 4.697zM6.761 8.83l-6.57 4.027A2 2 0 0 0 2 14h12a2 2 0 0 0 1.808-1.144l-6.57-4.027L8 9.586l-1.239-.757zm3.436-.586L16 11.801V4.697l-5.803 3.546z'] },
  telefono: { tam: '1em', d: ['M2.267.98a1.636 1.636 0 0 1 2.448.152l1.681 2.162c.309.396.418.913.296 1.4l-.513 2.053a.636.636 0 0 0 .167.604L8.65 9.654a.636.636 0 0 0 .604.167l2.052-.513a1.636 1.636 0 0 1 1.401.296l2.162 1.681c.777.604.849 1.753.153 2.448l-.97.97c-.693.693-1.73.998-2.697.658a17.47 17.47 0 0 1-6.571-4.144A17.47 17.47 0 0 1 .639 4.646c-.34-.967-.035-2.004.658-2.698l.97-.969z'] },
  ubicacion: { tam: '1em', d: ['M12.166 8.94C12.696 7.867 13 6.862 13 6A5 5 0 0 0 3 6c0 .862.305 1.867.834 2.94.524 1.062 1.234 2.12 1.96 3.07A31.481 31.481 0 0 0 8 14.58l.208-.22a31.493 31.493 0 0 0 1.998-2.35c.726-.95 1.436-2.008 1.96-3.07zM8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10z', 'M8 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 1a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'] },
};

/** Iconos de Bootstrap Icons como SVG en JSX (sin insertar HTML como texto). */
export function Icono({ nombre }) {
  const i = ICONOS[nombre];
  return (
    <svg width={i.tam} height={i.tam} viewBox="0 0 16 16" className={'bi ' + (i.clase || '')} fill="currentColor" aria-hidden="true">
      {i.d.map((d) => <path key={d} fillRule="evenodd" d={d} />)}
    </svg>
  );
}

/**
 * Ventana de diálogo dentro de la página (clases de Bootstrap, controlada por React): reemplaza a alert()/confirm() del
 * navegador. Se cierra con Escape, con la X o haciendo clic fuera. `pie` son los botones de acción (opcional).
 */
export function Dialogo({ titulo, children, pie, alCerrar }) {
  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape') alCerrar(); };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [alCerrar]);
  return (
    <>
      <div className="modal fade show d-block" tabIndex="-1" role="dialog" aria-modal="true" aria-labelledby="dialogo-titulo"
        onClick={(e) => { if (e.target === e.currentTarget) alCerrar(); }}>
        <div className="modal-dialog modal-dialog-centered" role="document"><div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title" id="dialogo-titulo">{titulo}</h5>
            <button type="button" className="btn-close" aria-label="Cerrar" onClick={alCerrar} autoFocus={!pie} />
          </div>
          <div className="modal-body">{children}</div>
          {pie && <div className="modal-footer">{pie}</div>}
        </div></div>
      </div>
      <div className="modal-backdrop fade show" />
    </>
  );
}

/** Pantalla de error (igual a la del sitio original). */
export function PantallaError({ estado, mensaje }) {
  useTitulo('Error');
  return (
    <section>
      <div className="container contendor"><div className="row">
        <div className="col-lg-12 text-center" style={{ padding: '80px 0' }}>
          <img className="logosintituciones" src="/img/logo.png" width="170" alt="" /><br /><br />
          <h4 className="intro-title" style={{ textAlign: 'center' }}>{estado}</h4>
          <h4>{mensaje}</h4><br />
          <a className="volver" href="/">Volver al inicio</a>
        </div>
      </div></div>
    </section>
  );
}

/** Pie de página de la carta. */
export function Pie({ conLinea }) {
  return (
    <footer className={conLinea ? 'container contendor' : 'footer-area section-gap'}>
      <br />{conLinea && <hr />}
      <div className="container"><div className="footer-bottom row align-items-center text-center">
        <p className="footer-text m-0 col-md-12">
          Copyright 2020, Todos los Derechos reservados PNK, <br />
          Sitio desarrollado para la Explotación de Vulnerabilidades Web, Laboratorio de Programación Segura I<br />
          <b>Área Tecnologías de Información y Ciberseguridad - Inacap Sede La Serena</b><br /><br />
        </p>
      </div></div>
    </footer>
  );
}

/** Monta el componente raíz de una página en <div id="app">. */
export function montar(Raiz) {
  createRoot(document.getElementById('app')).render(<StrictMode><Raiz /></StrictMode>);
}
