$ErrorActionPreference = 'Stop'

$nasShare = '\\192.168.100.2\home'
$storagePath = '\\192.168.100.2\home\Multimedia-Management-System'
$appPath = 'C:\Users\sshuser\Desktop\Multimedia-Management-System'
$credentialPath = 'C:\MMS\nas-credential.xml'
$startupLog = 'C:\MMS\startup.log'
$applicationLog = 'C:\MMS\MMS.log'

function Write-BootLog {
    param([string]$Message)
    try {
        Add-Content -LiteralPath $startupLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message" -ErrorAction Stop
    } catch {
        # A logging failure must not prevent the supervisor from retrying.
        Write-Warning "Unable to write startup log: $($_.Exception.Message)" -WarningAction Continue
    }
}

Write-BootLog 'MMS startup task started.'

$nasCredential = Import-Clixml -LiteralPath $credentialPath
$connected = $false
$attempt = 0
while (-not $connected) {
    $attempt++
    if (Test-Path -LiteralPath $storagePath) {
        $connected = $true
        break
    }
    try {
        New-SmbMapping -RemotePath $nasShare -UserName $nasCredential.UserName -Password $nasCredential.GetNetworkCredential().Password -Persistent $false -ErrorAction Stop | Out-Null
    } catch {
        Write-BootLog "SMB attempt $attempt failed: $($_.Exception.Message)"
    }
    if (Test-Path -LiteralPath $storagePath) {
        $connected = $true
        break
    }
    Start-Sleep -Seconds 5
}

Write-BootLog 'Synology connected successfully.'
Set-Location -LiteralPath $appPath
$nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
$env:NODE_ENV = 'production'
$env:JOB_CONCURRENCY = '4'

while ($true) {
    Write-BootLog 'Starting MMS.'
    $exitCode = $null
    $savedErrorPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5.1 wraps redirected native stderr as errors.
        # Keep those diagnostics in MMS.log without terminating the supervisor.
        $ErrorActionPreference = 'Continue'
        & $nodeCommand --require "C:\MMS\mms-priority.cjs" --max-old-space-size=1024 server.js *>> $applicationLog
        $exitCode = $LASTEXITCODE
    } catch {
        Write-BootLog "MMS launch exception: $($_.Exception.Message) $($_.ScriptStackTrace)"
    } finally {
        $ErrorActionPreference = $savedErrorPreference
    }
    Write-BootLog "MMS exited with code $exitCode. Restarting in five seconds."
    Start-Sleep -Seconds 5
}
