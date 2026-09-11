$ErrorActionPreference = 'Stop'
$siteDirectory = $PSScriptRoot
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$previewUrl = 'http://127.0.0.1:4173'
$alreadyRunning = $false
try {
    $page = Invoke-WebRequest -Uri $previewUrl -UseBasicParsing -TimeoutSec 2
    $alreadyRunning = $page.StatusCode -eq 200 -and $page.Content.Contains('FABREVOIE') -and $page.Content.Contains('The pleasure is yours.')
} catch { }
if (-not $alreadyRunning) {
    $serverProcess = Start-Process -FilePath $nodeExecutable -ArgumentList 'server.mjs' -WorkingDirectory $siteDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $siteDirectory 'preview.log') -RedirectStandardError (Join-Path $siteDirectory 'preview-error.log') -PassThru
    $serverProcess.Id | Set-Content -LiteralPath (Join-Path $siteDirectory 'preview.pid')
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 200
        try {
            $page = Invoke-WebRequest -Uri $previewUrl -UseBasicParsing -TimeoutSec 2
            if ($page.StatusCode -eq 200 -and $page.Content.Contains('FABREVOIE')) { $alreadyRunning = $true; break }
        } catch { }
    }
    if (-not $alreadyRunning) { throw 'Preview did not start. See preview-error.log.' }
}
Start-Process $previewUrl
Write-Output "FABREVOIE preview: $previewUrl"
