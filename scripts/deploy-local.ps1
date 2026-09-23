[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [guid]$ProjectId,
    [ValidateRange(1, 65535)]
    [int]$ContainerPort = 3000
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$kindExe = Join-Path (Split-Path $repoRoot -Parent) 'kubero/tools/kind.exe'
if (-not (Test-Path -LiteralPath $kindExe)) {
    $kindCommand = Get-Command kind -ErrorAction SilentlyContinue
    if (-not $kindCommand) { throw 'No se encontró kind.exe. Instala el laboratorio local de Kubero.' }
    $kindExe = $kindCommand.Source
}

kubectl config use-context kind-kubero | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No existe el contexto kind-kubero.' }
kubectl get crd kuberoapps.application.kubero.dev | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Kubero no está instalado en el clúster.' }

$sql = "SELECT json_build_object('id',p.id,'slug',p.slug,'repo_url',p.repo_url,'branch',p.branch,'access_token',ga.access_token) FROM projects p JOIN github_accounts ga ON ga.user_id=p.user_id WHERE p.id='$ProjectId'::uuid AND p.status!='deleted' LIMIT 1;"
$recordJson = (docker compose -f (Join-Path $repoRoot 'compose.yaml') exec -T postgres psql -U postgres -d kubero_wrapper -t -A -c $sql) -join ''
if ($LASTEXITCODE -ne 0 -or -not $recordJson) { throw 'No se encontró el proyecto o su GitHub no está vinculado.' }
$record = $recordJson | ConvertFrom-Json
if ($record.slug -notmatch '^[a-z0-9][a-z0-9-]*$' -or $record.repo_url -notmatch '^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$') {
    throw 'El nombre o repositorio guardado no tiene el formato esperado.'
}
$owner = $Matches[1]
$repository = $Matches[2]
$slug = $record.slug
$workRoot = Join-Path $repoRoot '.local/work'
$workDir = Join-Path $workRoot "$slug-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $workDir -Force | Out-Null

try {
    $headers = @{ Authorization = "Bearer $($record.access_token)"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
    $branch = [uri]::EscapeDataString($record.branch)
    $commit = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repository/commits/$branch" -Headers $headers
    $sha = [string]$commit.sha
    if ($sha -notmatch '^[a-f0-9]{40}$') { throw 'GitHub no devolvió un commit válido.' }
    $archivePath = Join-Path $workDir 'source.zip'
    Invoke-WebRequest -Uri "https://api.github.com/repos/$owner/$repository/zipball/$sha" -Headers $headers -OutFile $archivePath
    $headers = $null
    $record.access_token = $null

    $extractDir = Join-Path $workDir 'source'
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDir
    $sourceDir = Get-ChildItem -LiteralPath $extractDir -Directory | Select-Object -First 1 -ExpandProperty FullName
    if (-not $sourceDir) { throw 'El ZIP de GitHub no contiene código fuente.' }
    $dockerfile = Join-Path $sourceDir 'Dockerfile'
    $port = $ContainerPort
    if (-not (Test-Path -LiteralPath $dockerfile)) {
        if (-not (Test-Path -LiteralPath (Join-Path $sourceDir 'index.html'))) {
            throw 'Este repositorio no tiene Dockerfile ni index.html. No se puede inferir el contenedor para la demo.'
        }
        $dockerfile = Join-Path $workDir 'Static.Dockerfile'
        @('FROM nginxinc/nginx-unprivileged:alpine', 'COPY . /usr/share/nginx/html', 'EXPOSE 8080') | Set-Content -LiteralPath $dockerfile -Encoding utf8
        $port = 8080
    }

    $shortSha = $sha.Substring(0, 12)
    $image = "atlas/${slug}:$shortSha"
    Write-Host "Construyendo $image desde $owner/$repository@$shortSha..."
    docker build --file $dockerfile --tag $image $sourceDir
    if ($LASTEXITCODE -ne 0) { throw 'Falló docker build.' }
    & $kindExe load docker-image $image --name kubero
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo cargar la imagen en Kind.' }

    $pipeline = @{
        apiVersion = 'application.kubero.dev/v1alpha1'; kind = 'KuberoPipeline'
        metadata = @{ name = 'atlas'; namespace = 'kubero' }
        spec = @{
            name = 'atlas'; deploymentstrategy = 'docker'; buildstrategy = 'plain'; reviewapps = $false
            git = @{ provider = ''; keys = @{ priv = 'Zm9v'; pub = 'YmFy' }; repository = @{ admin = $false; ssh_url = ''; clone_url = '' } }
            registry = @{ createSecret = 'none' }
            phases = @(@{ name = 'production'; context = 'inClusterContext'; enabled = $true })
        }
    }
    $pipeline | ConvertTo-Json -Depth 16 | kubectl apply -f -
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el pipeline de Atlas.' }
    $deadline = (Get-Date).AddMinutes(2)
    do {
        $phase = kubectl get namespace atlas-production -o jsonpath='{.status.phase}' 2>$null
        if ($phase -eq 'Active') { break }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    if ($phase -ne 'Active') { throw 'Kubero no creó el namespace atlas-production.' }

    $domainLabel = if ($slug -match '\d$') { "$slug.app" } else { $slug }
    $domain = "$domainLabel.127.0.0.1.sslip.io"
    $app = @{
        apiVersion = 'application.kubero.dev/v1alpha1'; kind = 'KuberoApp'
        metadata = @{ name = $slug; namespace = 'atlas-production' }
        spec = @{
            name = $slug; pipeline = 'atlas'; phase = 'production'; deploymentstrategy = 'docker'; buildstrategy = 'plain'
            image = @{ repository = "atlas/$slug"; tag = $shortSha; pullPolicy = 'Never'; containerPort = $port }
            service = @{ port = 80; type = 'ClusterIP' }
            web = @{ replicaCount = 1 }; worker = @{ replicaCount = 0 }
            ingress = @{ enabled = $true; className = 'nginx'; annotations = @{}; hosts = @(@{ host = $domain; paths = @(@{ path = '/'; pathType = 'Prefix' }) }); tls = @() }
            envVars = @(@{ name = 'PORT'; value = [string]$port })
        }
    }
    $app | ConvertTo-Json -Depth 16 | kubectl apply -f -
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la aplicación en Kubero.' }
    $deadline = (Get-Date).AddMinutes(2)
    $deploymentName = "deployment/$slug-kuberoapp-web"
    do {
        $deployment = kubectl get $deploymentName -n atlas-production --ignore-not-found -o name
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo comprobar el Deployment de Kubero.' }
        if ($deployment) { break }
        Start-Sleep -Seconds 5
    } while ((Get-Date) -lt $deadline)
    if (-not $deployment) { throw 'El operador de Kubero no creó el Deployment.' }
    kubectl rollout restart $deploymentName -n atlas-production | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo reiniciar el Deployment con la nueva imagen.' }
    kubectl rollout status $deploymentName -n atlas-production --timeout=240s
    if ($LASTEXITCODE -ne 0) { throw 'El contenedor no quedó listo. Revisa kubectl get pods -n atlas-production.' }

    $url = "http://$domain/"
    $reachable = $false
    $deadline = (Get-Date).AddMinutes(2)
    do {
        $httpStatus = curl.exe --noproxy '*' --silent --output NUL --write-out '%{http_code}' --max-time 10 $url
        if ($LASTEXITCODE -eq 0 -and [int]$httpStatus -ge 200 -and [int]$httpStatus -lt 400) { $reachable = $true; break }
        Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $deadline)
    if (-not $reachable) { throw "La aplicación está creada, pero aún no responde en $url. Revisa el Ingress de Kubero." }

    $projectId = [guid]$record.id
    $update = "UPDATE projects SET status='running', domain='$domain', kubero_pipeline='atlas', kubero_app='$slug', updated_at=NOW() WHERE id='$projectId'; INSERT INTO builds(project_id,status,logs,commit_sha,commit_message,started_at,completed_at) SELECT '$projectId','running','Imagen local importada en Kind y publicada por Ingress','$sha','Despliegue local',NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM builds WHERE project_id='$projectId' AND commit_sha='$sha' AND status='running');"
    docker compose -f (Join-Path $repoRoot 'compose.yaml') exec -T postgres psql -U postgres -d kubero_wrapper -v ON_ERROR_STOP=1 -c $update | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Kubero respondió, pero no se pudo actualizar el estado en Atlas.' }
    Write-Host "Aplicación disponible: $url"
} finally {
    $safeRoot = [System.IO.Path]::GetFullPath($workRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    $safeTarget = [System.IO.Path]::GetFullPath($workDir)
    if ($safeTarget.StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $safeTarget)) {
        Remove-Item -LiteralPath $safeTarget -Recurse -Force
    }
}
