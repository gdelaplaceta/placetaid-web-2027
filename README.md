# PlacetaID v27 · Plan 2027

PlacetaID v27 sirve el catálogo de aplicaciones, la administración de identidades y el flujo real de autenticación desde Supabase. El simulador de políticas sigue usando identidades sintéticas y no debe utilizarse para validar accesos reales.

## Configuración

1. Copia `.env.example` a `.env` o configura las mismas variables en tu proveedor:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY` (solo servidor; nunca uses la `anon key` aquí)
   - `PLACETAID_V27_ADMIN_KEY` (clave fuerte para la consola)
   - `PLID27_SESSION_SECRET` (mínimo 32 caracteres aleatorios)
   - `PLID27_ENCRYPTION_KEY` (mínimo 32 caracteres aleatorios)
   - `PLACETAID_V27_DEVICE_KEY` (clave aleatoria de al menos 32 caracteres, compartida solo con el servidor de registro heredado)
2. Aplica, en orden, `supabase/migrations/20261004_placetaid_v27.sql`, `supabase/migrations/20261005_placetaid_v27_explicit_dip_consent.sql`, `supabase/migrations/20261006_placetaid_v27_repair_missing_tables.sql` y `supabase/migrations/20261007_placetaid_legacy_rsp.sql` en el proyecto Supabase conectado. La primera migración usa la tabla existente `public.solicitantes`; la segunda habilita el consentimiento explícito para compartir el DIP. La última prepara las credenciales legacy y la persistencia compartida de votos, documentos y notificaciones de RSP.
3. Comprueba la conexión en `GET /api/health`. El API responde `ok: true` solo cuando Supabase y todas las tablas v27 están disponibles.

En local, si `SUPABASE_URL` o `SUPABASE_SERVICE_KEY` están vacías, el servidor carga los valores de `PLID27_ENV_FILE` (por defecto `../rsp-web/server/.env`). Las variables ya configuradas con un valor tienen prioridad sobre el archivo.

## Ejecutar

```bash
npm install
npm run dev
```

El cliente Vite se sirve junto al API Express. En producción, `api/index.js` monta las mismas rutas bajo `/api`.

```bash
npm run typecheck
npm run build
```

## Registrar una aplicación y obtener sus credenciales

1. Abre **Administración → Aplicaciones → Nueva integración** e inicia sesión con `PLACETAID_V27_ADMIN_KEY`.
2. Registra el nombre y la URL de callback exacta. Se requiere HTTPS; HTTP solo se admite para `localhost` en desarrollo.
3. PlacetaID crea la aplicación y su servicio `general` en Supabase, y entrega un `client_id` y un `client_secret` una sola vez. Guarda el secreto en el servidor de la aplicación; no lo incluyas en el navegador, repositorios ni URLs.
4. La aplicación aparece como pendiente. Autorízala desde su ficha de administración antes de aceptar inicios de sesión.

En la ficha de cada aplicación, Administración muestra las URLs de inicio v27 ya construidas para cada callback, el endpoint exacto de canje y botones para copiarlos. El `state` del ejemplo es un marcador: cada aplicación debe generar un valor criptográficamente aleatorio y comprobarlo en su callback.

La aplicación inicia la pasarela con una URL de este tipo:

```text
https://placetaid.example/?client_id=plid27_...&redirect_uri=https%3A%2F%2Fapp.example%2Fauth%2Fcallback&service=general&state=<valor-aleatorio>
```

PlacetaID comprueba el `client_id`, el estado autorizado, el servicio activo y la coincidencia exacta del callback antes de autenticar. Al completarse el acceso, el callback recibe un código temporal de un solo uso y el `state` original. El backend de la aplicación lo canjea en el API de PlacetaID mediante `POST /api/public/exchange`, enviando JSON con `client_id`, `client_secret`, `code` y `redirect_uri`. El canje devuelve las claims autorizadas; el secreto solo viaja servidor a servidor.

Los códigos de autorización caducan en 90 segundos y solo pueden canjearse una vez. El DIP solo se devuelve si Administración habilita ese permiso para la aplicación y el titular lo concede expresamente durante el inicio de sesión.

### Nexe

Nexe inicia el flujo con `/api/placetaid-login` y recibe el código en `https://nexe-web-plan2027.vercel.app/auth/callback`. Su backend canjea el código con `PLACETAID_CLIENT_SECRET`; nunca debe canjearlo desde el navegador. Para Nexe, Administración debe habilitar **DIP → Si acepta**. El titular verá una petición expresa antes de que el dato se entregue. Si no lo concede, el acceso de Nexe se rechaza. Nexe solo abre sesión para un perfil ya registrado y activo; la autenticación PlacetaID no marca por sí sola la verificación RSP.

## Métodos de autenticación

La pasarela consulta las identidades y los métodos activos en Supabase. Cada titular debe tener un dispositivo de v27 vigente en `plid_v27_devices` (`mobile`, `desktop` o `authenticator`); para TOTP también debe existir un autenticador habilitado en `plid_v27_authenticators`. PlacetaID no permite iniciar sesión únicamente con el DIP ni sustituye un método de recuperación de cuenta.

La aplicación móvil y PlacetaID Desktop deben aprobar la solicitud temporal en `/api/public/auth-requests/:id/approve` con el `deviceToken` previamente vinculado. El Autentificador envía el código de seis cifras a `/api/public/authenticate`.

El servidor heredado `plid26-main` mantiene la verificación existente de DIP+contraseña. Después de verificarla, sincroniza el alta o la desvinculación del dispositivo con Supabase v27. Configura allí `PLACETAID_V27_API_URL` con el origen de PlacetaID v27 y `PLACETAID_V27_DEVICE_KEY` con el mismo valor de `PLACETAID_V27_DEVICE_KEY` de este servidor. La clave compartida solo se usa servidor a servidor; el API v27 guarda el hash del token, no la contraseña ni el token en claro. Los dispositivos ya vinculados deben volver a registrarse una vez desde móvil/Desktop para aparecer en Supabase.

Si falta esta configuración, el servidor heredado informa que el dispositivo no se sincronizó; PlacetaID v27 no habilita el inicio de sesión hasta que la sincronización haya sido confirmada.

Para recuperar cuentas PL26, ejecuta primero el dry-run y luego `npm run migrate:legacy-v27 -- --apply` desde `plid26-main`, con MongoDB y el puente interno configurados. Solo se transfieren hashes bcrypt; no se leen ni envían contraseñas en claro. La migración enlaza por DIP, crea perfiles que falten en `solicitantes` sin reescribir los existentes, y mantiene el estado bloqueado. Después cada usuario debe volver a vincular su móvil/Desktop para generar un método v27.

### Compatibilidad PL26 y dominio de Vercel

`https://placetaid-web-plan2027.vercel.app` actualmente no tiene un deployment. El deployment v27 comprobado usa `https://placetaid-web-2027.vercel.app`. Configura Nexe con `PLACETAID_URL=https://placetaid-web-2027.vercel.app` y despliega el handler actualizado para que use OAuth v27. El endpoint `/api/auth/fase1` de compatibilidad reenvía las solicitudes antiguas al flujo v27 cuando esta versión esté desplegada.

Configura RSP con `PLACETAID_API_URL=https://placetaid-web-2027.vercel.app/api`. Aplica las migraciones y confirma que `/api/health` responda `ok: true` antes de probar el login. Para transferir el dominio histórico de PL26, asígnalo como alias al deployment v27 desde Vercel; el código por sí solo no crea deployments ni reasigna dominios.

## Qué es persistente

- Catálogo, client IDs, reglas de acceso, identidades consultadas, sesiones, aceptación legal, consentimientos y auditoría: Supabase.
- La vista **Simulador de acceso** y su catálogo de ejemplo: local y sintética; no autentican usuarios.
- La consola de administración utiliza una sesión temporal de servidor. Los secretos de aplicaciones no se guardan en `localStorage`.
