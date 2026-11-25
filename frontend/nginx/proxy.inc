# Opciones comunes de los proxys hacia la API (se incluye con "include" desde default.conf)
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
# Cadena de IPs: se AGREGA la dirección de quien se conectó a Nginx. La API cuenta los proxys de confianza (TRUST_PROXY)
# para tomar la IP real del visitante (límite de intentos de login, registros).
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $proto_original;
proxy_set_header X-Forwarded-Host $host;
proxy_connect_timeout 5s;
proxy_read_timeout 30s;
proxy_send_timeout 30s;
