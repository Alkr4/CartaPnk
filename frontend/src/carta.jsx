// Carta digital: pide los datos a la API (GET /api/restaurantes/:id) y dibuja la página con React.
import { useEffect, useState } from 'react';
import { api, Icono, montar, moneda, Multilinea, PantallaError, Pie, rutaInterna, useTitulo } from './comun.jsx';

/** Datos de la página: { vacio } si aún no hay restaurantes, { d, sesion } o { error }. */
async function cargar() {
  try {
    let id = window.location.pathname.match(/^\/restaurantes\/(\d+)\/?$/)?.[1];
    if (!id) {
      try {
        id = (await api('GET', '/restaurantes/primero')).id;
      } catch (e) {
        if (e.status === 404) return { vacio: true }; // sin restaurantes publicados todavía: no es un error
        throw e;
      }
    }
    const [d, sesion] = await Promise.all([api('GET', '/restaurantes/' + id), api('GET', '/sesion').catch(() => null)]);
    return { d, sesion };
  } catch (error) {
    return { error };
  }
}

function Estrellas({ n }) {
  return <ul className="rating-star">{Array.from({ length: n }, (_, i) => <li key={i}><i className="ti-star" /></li>)}</ul>;
}

function BotonSeleccionar({ id, alSeleccionar, enLinea }) {
  return (
    <a className={'button' + (enLinea ? '' : ' float-right')} href="#" style={enLinea ? { margin: 0 } : undefined}
      onClick={(e) => { e.preventDefault(); alSeleccionar(id); }}>Seleccionar</a>
  );
}

function Encabezado({ r }) {
  return (
    <section><div className="container contendor">
      <div className="row">
        <div className="col-lg-4"><div className="d-flex justify-content-center">
          <img className="logosintituciones" src="/img/logo.png" width="190" alt="" /></div></div>
        <div className="col-lg-4"><div className="d-flex justify-content-center">
          <img className="logosintituciones" src={rutaInterna(r.fotoUrl, '/img/logo_empresa_comodin.png')} width="170" alt="" /></div></div>
        <div className="col-lg-4"><div className="carro"><div className="d-flex float-end">
          <a className="button_carrito" href={'/carrito?restaurante=' + encodeURIComponent(r.id)}>
            <Icono nombre="carrito" /> Productos Seleccionados</a>
        </div></div></div>
      </div>
      <div className="row"><div className="col-lg-12"><div className="text-center">
        <h4>{r.nombre}</h4>
        <h5><Icono nombre="ubicacion" /> {r.calle} #{r.numero}, {r.comuna}</h5>
        <h5>
          {r.fono && <><Icono nombre="telefono" /> {r.fono} </>}
          {r.email && <><Icono nombre="correo" /> {r.email}</>}
        </h5>
      </div></div></div>
    </div></section>
  );
}

/** Menús destacados: fila con desplazamiento horizontal (CSS scroll-snap; reemplaza al carrusel jQuery/Owl). */
function Destacados({ lista, alSeleccionar }) {
  if (lista.length === 0) return null;
  return (
    <section className="destacados"><div className="container contendor">
      <div className="section-intro"><h4 className="intro-title">Menús Destacados</h4></div>
      <div className="featured-carousel">
        {lista.map((d) => (
          <div className="featured-item" key={d.id}>
            <img className="card-img rounded-0" width="350" height="235" alt="" src={rutaInterna(d.fotoUrl, '/img/carta_comodin.png')} />
            <div className="item-body">
              <h3>{d.nombre}</h3>
              <p>{d.descripcion}<br />{d.observaciones}<br />{d.tiempo && <><Icono nombre="alarma" /> {d.tiempo}</>}</p>
              <div className="d-flex justify-content-between"><Estrellas n={d.puntuacion} /><h3 className="price-tag">{moneda(d.precio)}</h3></div>
              <BotonSeleccionar id={d.id} alSeleccionar={alSeleccionar} enLinea />
            </div>
          </div>
        ))}
      </div>
    </div></section>
  );
}

function Tarjeta({ it, ancho, alSeleccionar }) {
  return (
    <div className={ancho}><div className="d-flex align-items-center food-card">
      <img className="me-3 me-sm-4" alt="" width="120" src={rutaInterna(it.fotoUrl, '/img/carta_comodin.png')} />
      <div className="flex-grow-1">
        <div className="d-flex justify-content-between food-card-title"><h4>{it.nombre}</h4><h3 className="price-tag">{moneda(it.precio)}</h3></div>
        <p>{it.descripcion}<br />{it.observaciones}</p>
        {it.tiempo && <p><Icono nombre="alarma" /> {it.tiempo}</p>}
        <Estrellas n={it.puntuacion} />
        <BotonSeleccionar id={it.id} alSeleccionar={alSeleccionar} />
      </div>
    </div></div>
  );
}

function SinInformacion({ titulo }) {
  return <div className="col-lg-12"><div className="text-center"><h4>{titulo}</h4></div></div>;
}

/** Pestañas con las cartas del restaurante (estado de React; no necesita el JavaScript de Bootstrap). */
function Cartas({ lista, alSeleccionar }) {
  const [activa, setActiva] = useState(0);
  return (
    <section><div className="container contendor"><div className="container"><div className="row"><div className="col-lg-12">
      <nav><div className="nav nav-tabs nav-fill" role="tablist">
        {lista.map((c, i) => (
          <a key={c.id} className={'nav-item nav-link' + (i === activa ? ' active' : '')} id={'tab-carta-' + c.id} href={'#carta-' + c.id}
            role="tab" aria-controls={'carta-' + c.id} aria-selected={i === activa}
            onClick={(e) => { e.preventDefault(); setActiva(i); }}>{c.nombre}</a>
        ))}
      </div></nav>
      <div className="tab-content py-3 px-3 px-sm-0">
        {lista.map((c, i) => (
          <div key={c.id} className={'tab-pane' + (i === activa ? ' show active' : '')} id={'carta-' + c.id} role="tabpanel" aria-labelledby={'tab-carta-' + c.id}>
            {c.categorias.length === 0
              ? <div className="row"><SinInformacion titulo="No hay información para Mostrar" /></div>
              : c.categorias.map((k) => (
                <div key={k.id}>
                  <div className="section-intro mb-20px"><h4 className="intro-title">{k.nombre}</h4></div>
                  <div className="row">
                    {k.items.length > 0
                      ? k.items.map((it) => <Tarjeta key={it.id} it={it} ancho={k.items.length > 1 ? 'col-lg-6' : 'col-lg-12'} alSeleccionar={alSeleccionar} />)
                      : <SinInformacion titulo="No Información para Mostrar" />}
                  </div>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div></div></div></div></section>
  );
}

function Comentarios({ lista }) {
  return (
    <section><div className="container contendor"><div className="container"><div className="row"><div className="col-lg-12">
      <div className="section-intro"><h4 className="intro-title">Comentarios</h4></div><br />
      {lista.map((c, i) => (
        <div key={i}><div className="card bg-light"><div className="card-body"><b>{c.usuario}</b><br /><Multilinea texto={c.comentario} /></div></div><br /></div>
      ))}
      <hr />
    </div></div></div></div></section>
  );
}

/** Aviso tras seleccionar un producto (modal con las clases de Bootstrap, controlado por React). */
function Aviso({ mensaje, alCerrar }) {
  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape') alCerrar(); };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [alCerrar]);
  return (
    <>
      <div className="modal fade show d-block" tabIndex="-1" role="dialog" aria-modal="true" aria-labelledby="aviso-titulo"
        onClick={(e) => { if (e.target === e.currentTarget) alCerrar(); }}>
        <div className="modal-dialog" role="document"><div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title text-lg-center" id="aviso-titulo">Selección de Producto</h5>
            <button type="button" className="btn-close" aria-label="Cerrar" onClick={alCerrar} autoFocus />
          </div>
          <div className="modal-body">{mensaje}</div>
        </div></div>
      </div>
      <div className="modal-backdrop fade show" />
    </>
  );
}

function FilaAdmin({ sesion }) {
  if (!sesion?.usuario || !['admin', 'superadmin'].includes(sesion.usuario.rol)) return null;
  return (
    <nav className="navbar navbar-light bg-light">
      <span className="ms-2">Sesión de administrador: <b>{sesion.usuario.nombre}</b> · <a href="/admin">Ir al panel</a></span>
    </nav>
  );
}

/** Portada cuando todavía no hay ningún restaurante creado desde el panel. */
function SinRestaurantes() {
  useTitulo('CartaPnk');
  return (
    <section><div className="container contendor"><div className="row">
      <div className="col-lg-12 text-center" style={{ padding: '80px 0' }}>
        <img className="logosintituciones" src="/img/logo.png" width="190" alt="" /><br /><br />
        <h4 className="intro-title" style={{ textAlign: 'center' }}>Aún no hay restaurantes publicados</h4>
        <h5>Vuelve pronto: estamos preparando la carta.</h5>
      </div>
    </div></div></section>
  );
}

export function Carta() {
  const [estado, setEstado] = useState(null);
  const [aviso, setAviso] = useState(null);
  useEffect(() => { cargar().then(setEstado); }, []);
  useTitulo(estado?.d?.restaurante.nombre);

  if (!estado) return null;
  if (estado.vacio) return <SinRestaurantes />;
  if (estado.error) return <PantallaError estado={estado.error.status || 500} mensaje={estado.error.message} />;

  const seleccionar = (itemId) => api('POST', '/carrito/items', { itemId })
    .then(() => setAviso('El producto seleccionado, ha sido agregado sin problemas!!!'))
    .catch((e) => setAviso(e.message));
  const { d, sesion } = estado;
  return (
    <>
      <FilaAdmin sesion={sesion} />
      <Encabezado r={d.restaurante} />
      <Destacados lista={d.destacados} alSeleccionar={seleccionar} />
      <Cartas lista={d.cartas} alSeleccionar={seleccionar} />
      <Comentarios lista={d.comentarios} />
      <Pie />
      {aviso && <Aviso mensaje={aviso} alCerrar={() => setAviso(null)} />}
    </>
  );
}

if (document.getElementById('app')) montar(Carta);
