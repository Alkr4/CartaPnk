// Carrito: lista los productos de la sesión (GET /api/carrito) y permite quitarlos o vaciar el pedido.
import { useCallback, useEffect, useState } from 'react';
import { api, Icono, montar, moneda, PantallaError, Pie, rutaInterna, useTitulo } from './comun.jsx';

export function Carrito() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const restauranteId = new URLSearchParams(window.location.search).get('restaurante');

  const recargar = useCallback(() => {
    api('GET', '/carrito' + (restauranteId ? '?restaurante=' + encodeURIComponent(restauranteId) : ''))
      .then(setDatos)
      .catch((e) => {
        if (e.status === 404) window.location.replace('/'); // sin restaurante en el contexto: vuelve al inicio
        else setError(e);
      });
  }, [restauranteId]);
  useEffect(recargar, [recargar]);
  useTitulo(datos?.restaurante.nombre);

  if (error) return <PantallaError estado={error.status || 500} mensaje={error.message} />;
  if (!datos) return null;

  const accion = (metodo, ruta) => (e) => { e.preventDefault(); api(metodo, ruta).then(recargar).catch(setError); };
  const r = datos.restaurante;
  return (
    <>
      <section><div className="container contendor"><div className="row">
        <div className="col-lg-4"><div className="d-flex justify-content-center">
          <img className="logosintituciones" src="/img/logo.png" width="170" alt="" /></div><br /><br /></div>
        <div className="col-lg-4"><div className="d-flex justify-content-center">
          <img className="logosintituciones" src={rutaInterna(r.fotoUrl, '/img/logo_empresa_comodin.png')} width="170" alt="" /></div></div>
        <div className="col-lg-4"><div className="carro"><div className="d-flex float-end">
          <a className="volver" href={'/restaurantes/' + encodeURIComponent(r.id)}>Volver a la Carta</a>{'  '}
          <a className="limpiar" href="#" onClick={accion('DELETE', '/carrito')}>Eliminar Todo</a>
        </div></div></div>
      </div></div></section>
      <section><div className="container contendor"><div className="row"><div className="col-lg-12">
        <h4 className="intro-title" style={{ textAlign: 'center' }}>Productos Agregados para Solicitar</h4>
      </div></div></div></section>
      <section><div className="container contendor"><div className="row"><div className="col-lg-12">
        <table className="table table-hover table-lg">
          <thead><tr><th scope="col">Código</th><th scope="col">Producto</th><th scope="col">Precios</th><th scope="col">Acción</th></tr></thead>
          <tbody>
            {datos.items.map((p) => (
              <tr key={p.posicion}>
                <th scope="row">{p.id}</th><td>{p.nombre}</td><td>{moneda(p.precio)}</td>
                <td><a className="elim" href="#" aria-label={'Quitar ' + p.nombre}
                  onClick={accion('DELETE', '/carrito/items/' + encodeURIComponent(p.posicion))}><Icono nombre="basurero" /></a></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div><hr /><br /><h3 className="price-tag text-center">¡¡¡Si estas listo con tu pedido, llama al garzón para solicitarlo!!!</h3></div>
      </div></div></div></section>
      <Pie conLinea />
    </>
  );
}

if (document.getElementById('app')) montar(Carrito);
