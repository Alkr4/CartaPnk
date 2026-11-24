// Vite: compila los componentes React (src/) en archivos estáticos (dist/) que Nginx entrega.
// Tres páginas (carta, carrito, panel), las mismas URL que define nginx/default.conf.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API para `npm run dev`: por defecto la del ambiente de desarrollo de Docker (docker-compose.dev.yml publica 3100)
const api = process.env.PNK_API || 'http://localhost:3100';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: { input: { carta: 'carta.html', carrito: 'carrito.html', admin: 'admin.html' } },
  },
  server: { proxy: { '/api': api, '/media': api, '/salud': api } },
  test: { environment: 'jsdom' },
});
