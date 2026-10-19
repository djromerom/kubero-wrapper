# Migración del laboratorio de Atlas a K3s

K3s es la distribución de Kubernetes de Atlas. En el equipo Windows se ejecuta mediante k3d y Docker Desktop; en los servidores Linux se instala K3s directamente. Kind queda como entorno anterior para recuperación.

## Preparación local

Requisitos: Docker Desktop con contenedores Linux, Node 22 o posterior, kubectl y k3d 5.9.0. El ejecutable de k3d puede estar en PATH o en `.local/tools/k3d.exe`. Obtenerlo de las releases oficiales y comprobar el SHA256 publicado antes de ejecutarlo.

```sh
npm ci --prefix scripts
node scripts/setup-k3s.mjs --without-ingress-ports
```

El instalador utiliza `infra/k3d.yaml`: un nodo K3s, API local en `127.0.0.1:6550`, Traefik y almacenamiento `local-path`. Instala Kubero Operator v0.2.2 con la adaptación del constructor de Atlas. Guarda el kubeconfig en `.local/k3s.kubeconfig` sin cambiar el contexto predeterminado del usuario.

La UI de Kubero recibe una sonda de arranque antes de activar liveness, porque el chart de esa versión comprueba el proceso inmediatamente. Las imágenes de proyectos se construyen en el registro interno y se cargan en la caché de containerd de los nodos locales antes de ejecutarlas.

## Cambio desde Kind

Antes del cambio se deben detener los monitores de despliegue, guardar una copia de PostgreSQL de Atlas y exportar los recursos de las aplicaciones. Si existen volúmenes de proyectos, migrar sus datos antes de cambiar el destino; recrear un PVC no traslada su contenido.

Las imágenes locales verificadas y aprobadas deben importarse al nuevo clúster, conservando sus etiquetas. Restaurar los recursos declarativos de los proyectos sin UID, resourceVersion, status, finalizers ni referencias al operador anterior. Cambiar la clase de ingress a `traefik`; no copiar deployments derivados cuando el operador puede reconstruirlos desde KuberoApp.

Con el nuevo clúster y las aplicaciones comprobados, detener el nodo Kind para liberar 80 y 443, publicar esos puertos y conectar Atlas:

```sh
docker stop kubero-control-plane
node scripts/setup-k3s.mjs
node scripts/start-local-kubero.mjs
node scripts/check-cluster.mjs --context k3d-atlas
```

El dashboard mantiene `http://localhost:5173`; la API mantiene el puerto 3000. Las aplicaciones se publican por Traefik en 80/443. HTTP interno: ingress → service → puerto del contenedor indicado por el proyecto. El puerto 6550 permite administrar el clúster desde el equipo; el backend accede a la API por la red Docker `k3d-atlas`.

El registro y la base de datos de la UI de Kubero se crean nuevos en K3s. El nodo Kind conserva sus volúmenes originales. Los usuarios, vínculos GitHub y proyectos de Atlas siguen en el volumen PostgreSQL de Compose.

Para abrir la UI de Kubero localmente cuando sea necesario:

```sh
kubectl --kubeconfig .local/k3s.kubeconfig --context k3d-atlas -n kubero port-forward service/kubero 2000:2000
```

Abrir `http://localhost:2000` mientras ese comando permanezca activo.

## Comprobación

Verificar los pods, cada dominio de aplicación y un ciclo nuevo de construcción con Dockerfile, adaptación y despliegue aprobado. La presencia de nodos Ready no demuestra por sí sola que los proyectos se hayan migrado.

```sh
npm test --prefix scripts
node scripts/tests/kubero-build.integration.mjs --strategy dockerfile --repository URL --commit SHA_COMPLETO
```

## Recuperación

Detener los monitores y el clúster k3d para liberar los puertos, volver a arrancar Kind y ejecutar en PowerShell:

```powershell
.\.local\tools\k3d.exe cluster stop atlas
$env:ATLAS_IMAGE_DELIVERY = 'kind'
$env:ATLAS_KUBE_CONTEXT = 'kind-kubero'
$env:ATLAS_INGRESS_CLASS = 'nginx'
$env:ATLAS_STORAGE_CLASS = 'standard'
Remove-Item Env:KUBECONFIG -ErrorAction SilentlyContinue
node scripts/start-local-kubero.mjs
```

Esto recupera las aplicaciones originales; no incorpora al clúster anterior cambios realizados después del cambio a K3s. La copia de PostgreSQL permite recuperar el estado de Atlas si es necesario. No eliminar Kind hasta finalizar la verificación.

## Clúster del profesor

Se utiliza `compose.cluster.yaml` y `scripts/cluster.k3s.env.example` con el kubeconfig, arquitectura, registro, dominio, clase de ingress y almacenamiento reales. Ese entorno usa un registro de imágenes accesible por los nodos; la importación local de imágenes mediante Docker/k3d pertenece únicamente al laboratorio. No se necesita instalar k3d en los servidores.

Referencias: [k3d](https://k3d.io/stable/), [K3s](https://docs.k3s.io/).
