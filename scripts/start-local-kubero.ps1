[CmdletBinding()]
param([switch]$BuildBackend)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$localDir = Join-Path $repoRoot '.local'

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop no está listo. Inícialo antes de continuar.' }
$kindContainer = (docker ps -a --filter 'name=^/kubero-control-plane$' --format '{{.Names}}') -join ''
if ($kindContainer -ne 'kubero-control-plane') {
    throw 'No existe el contenedor kubero-control-plane. Instala primero el laboratorio local de ../kubero.'
}
$kindRunning = (docker ps --filter 'name=^/kubero-control-plane$' --format '{{.Names}}') -join ''
if ($kindRunning -ne 'kubero-control-plane') {
    docker start kubero-control-plane | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo arrancar el clúster Kind.' }
}
kubectl config use-context kind-kubero | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No existe el contexto kind-kubero. Instala primero el laboratorio local de Kubero.' }
kubectl wait --for=condition=Ready node --all --timeout=120s | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'El clúster kind-kubero no quedó listo.' }
kubectl get crd kuberoapps.application.kubero.dev | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Falta el operador de Kubero en el clúster.' }

$server = (kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.server}').Trim()
if ($server -notmatch '^https://127\.0\.0\.1:\d+$') {
    throw "Se esperaba un API local de Kind; se encontró $server"
}
$containerServer = 'https://kubero-control-plane:6443'
$config = (kubectl config view --raw --minify) -join "`n"
$needle = "server: $server"
if (-not $config.Contains($needle)) { throw 'No se pudo adaptar el kubeconfig para Docker.' }
$config = $config.Replace($needle, "server: $containerServer`n    tls-server-name: 127.0.0.1")
New-Item -ItemType Directory -Path $localDir -Force | Out-Null
[System.IO.File]::WriteAllText((Join-Path $localDir 'kubeconfig'), $config, [System.Text.UTF8Encoding]::new($false))

$composeArgs = @('-f', (Join-Path $repoRoot 'compose.yaml'), '-f', (Join-Path $repoRoot 'compose.kubero.yaml'), 'up', '-d')
if ($BuildBackend) { $composeArgs += '--build' }
$composeArgs += 'backend'
docker compose @composeArgs
if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar el backend con Kubero.' }

$backendReady = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $backendReady = (Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 3).status -eq 'ok'
        if ($backendReady) { break }
    } catch {}
    Start-Sleep -Seconds 1
}
if (-not $backendReady) { throw 'El backend no respondió en http://127.0.0.1:3000/api/health. Revisa docker compose logs backend.' }

$frontendReady = $false
try { $frontendReady = (Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch {}
if (-not $frontendReady) {
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    Start-Process -FilePath $npm -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1') `
        -WorkingDirectory (Join-Path $repoRoot 'frontend') -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $localDir 'vite.out.log') `
        -RedirectStandardError (Join-Path $localDir 'vite.err.log') | Out-Null
}
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $frontendReady = (Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200
        if ($frontendReady) { break }
    } catch {}
    Start-Sleep -Seconds 1
}
if (-not $frontendReady) { throw 'El frontend no respondió en http://127.0.0.1:5173/. Revisa .local/vite.err.log.' }

$workerPath = Join-Path $PSScriptRoot 'watch-local-deployments.ps1'
$workerPidFile = Join-Path $localDir 'deploy-worker.pid'
$workerRunning = $false
if (Test-Path -LiteralPath $workerPidFile) {
    try {
        $workerProcessId = [int](Get-Content -LiteralPath $workerPidFile -Raw)
        $workerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$workerProcessId" -ErrorAction Stop
        $workerRunning = $workerProcess -and $workerProcess.CommandLine -like '*watch-local-deployments.ps1*'
    } catch {}
}
if (-not $workerRunning) {
    $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
    $worker = Start-Process -FilePath $powershell `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$workerPath`"") `
        -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
    $worker.Id | Set-Content -LiteralPath $workerPidFile
    Start-Sleep -Seconds 1
    $worker.Refresh()
    if ($worker.HasExited) { throw 'No se pudo iniciar el monitor de despliegues. Revisa .local/deployments/worker.log.' }
}
Write-Host 'Demo lista: http://127.0.0.1:5173/. Los proyectos pendientes se despliegan automáticamente.'
