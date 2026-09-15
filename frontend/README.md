# Frontend de Atlas

React + TypeScript + Vite + Tailwind CSS 3, conservando el stack y lockfile del repositorio remoto.

```sh
npm ci
npm run dev
npm run build
npm run lint
```

El frontend utiliza `/api` y `/ws`, redirigidos por Vite a localhost:3000. Requiere el backend para autenticación y datos reales.

Los tokens de marca están en `tailwind.config.js`, los estilos compartidos en `src/index.css`, el isotipo en `AtlasBrand.tsx` y la composición de acceso en `AuthLayout.tsx`.

Consulta [identidad visual](../docs/atlas-identity.md) y [diferencias funcionales pendientes](../docs/README.md).
