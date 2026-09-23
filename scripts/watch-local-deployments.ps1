[CmdletBinding()]
param([switch]$Once)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$composePath = Join-Path $repoRoot 'compose.yaml'
$deployScript = Join-Path $PSScriptRoot 'deploy-local.ps1'
$logDir = Join-Path $repoRoot '.local/deployments'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Write-WorkerLog([string]$Message) {
    Add-Content -LiteralPath (Join-Path $logDir 'worker.log') -Value "$(Get-Date -Format s) $Message"
}

function Invoke-Database([string]$Sql) {
    $output = docker compose -f $composePath exec -T postgres psql -U postgres -d kubero_wrapper -q -t -A -v ON_ERROR_STOP=1 -c $Sql
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo consultar la base de datos local.' }
    return (($output | Out-String).Trim())
}

$mutex = [System.Threading.Mutex]::new($false, 'Local\AtlasKuberoAutoDeploy')
if (-not $mutex.WaitOne(0)) {
    $mutex.Dispose()
    exit 0
}

try {
    Write-WorkerLog 'Monitor de despliegues iniciado.'
    while ($true) {
        try {
            $claimSql = @"
WITH next_project AS (
    SELECT id FROM projects WHERE status='pending'
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
), claimed AS (
    UPDATE projects p SET status='building', updated_at=NOW()
    FROM next_project WHERE p.id=next_project.id RETURNING p.id
)
SELECT id FROM claimed;
"@
            $projectIdText = Invoke-Database $claimSql
            if ($projectIdText) {
                $projectGuid = [guid]::Empty
                if (-not [guid]::TryParse($projectIdText, [ref]$projectGuid)) {
                    throw "La base de datos devolvió un identificador inválido: $projectIdText"
                }
                $projectLog = Join-Path $logDir "$projectGuid.log"
                $errorLog = Join-Path $logDir "$projectGuid.stderr.log"
                Write-WorkerLog "Desplegando proyecto $projectGuid."
                try {
                    $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
                    $deployment = Start-Process -FilePath $powershell `
                        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$deployScript`"", '-ProjectId', [string]$projectGuid) `
                        -WorkingDirectory $repoRoot -WindowStyle Hidden -Wait -PassThru `
                        -RedirectStandardOutput $projectLog -RedirectStandardError $errorLog
                    if (Test-Path -LiteralPath $errorLog) {
                        Get-Content -LiteralPath $errorLog | Add-Content -LiteralPath $projectLog
                    }
                    if ($deployment.ExitCode -ne 0) {
                        $details = (Get-Content -LiteralPath $errorLog -Tail 5 | Out-String).Trim()
                        throw "El proceso de despliegue terminó con código $($deployment.ExitCode). $details"
                    }
                    Write-WorkerLog "Proyecto $projectGuid desplegado."
                } catch {
                    $failure = $_.Exception.Message
                    Add-Content -LiteralPath $projectLog -Value $failure
                    Write-WorkerLog "Falló el proyecto $projectGuid. Revisa $projectLog"
                    $escapedFailure = $failure.Replace("'", "''")
                    Invoke-Database "UPDATE projects SET status='failed', updated_at=NOW() WHERE id='$projectGuid' AND status='building'; INSERT INTO builds(project_id,status,logs,started_at,completed_at) VALUES ('$projectGuid','failed','$escapedFailure',NOW(),NOW());" | Out-Null
                }
            }
        } catch {
            Write-WorkerLog "Error del monitor: $($_.Exception.Message)"
        }
        if ($Once) { break }
        Start-Sleep -Seconds 5
    }
} finally {
    Write-WorkerLog 'Monitor de despliegues detenido.'
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
