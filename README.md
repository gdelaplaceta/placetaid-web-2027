# PlacetaID v27.0 · Plan 2027

Consola de gobierno de identidad y maqueta de la nueva pasarela PlacetaID. El proyecto contribuye al **ámbito 25, Fomento de la transformación digital**, con una transición iniciada en 2026.

## Desarrollo

```bash
npm install
npm run dev
```

Comprobaciones:

```bash
npm run typecheck
npm run build
```

## Experiencia incluida

- Inicio público por DIP y detección simulada, en prioridad, de PlacetaID móvil, Autentificador y PlacetaID Desktop.
- Catálogo administrativo con autorización de aplicaciones, restricciones de edad, roles y servicios.
- Datos básicos siempre presentes tras un acceso permitido. Los datos protegidos pueden marcarse como Nunca o Si acepta; cada decisión pertenece al titular y puede revocarse.
- Directorio y ficha de identidad con accesos, servicios, métodos vinculados, sesiones y auditoría local.
- Las vistas de Administración se abren desde el botón **Administración** de la página inicial.

## Límites de esta maqueta

La información es sintética y los cambios se guardan en el navegador. La maqueta no autentica cuentas reales ni está conectada a MongoDB o a PLID26.

El contrato actual de PLID26 no implementa todavía la selección silenciosa de métodos de v27: su flujo web usa DIP y contraseña, más TOTP cuando está configurado; la autenticación móvil se completa mediante una solicitud temporal y polling; PlacetaID Desktop recibe solicitudes por `placetaid-desktop://auth`. La integración real requiere ampliar el backend y validar la autorización OAuth, las políticas y los consentimientos en servidor; la interfaz local no es una barrera de seguridad.
