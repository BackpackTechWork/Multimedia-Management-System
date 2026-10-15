param([string]$SupervisorPath = (Join-Path $PSScriptRoot '..\scripts\start-mms.ps1'))
$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($SupervisorPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$loops = @($ast.FindAll({ param($item) $item -is [System.Management.Automation.Language.WhileStatementAst] }, $false))
$loopText = $loops[-1].Extent.Text
$launchLine = '& $nodeCommand --require "C:\MMS\mms-priority.cjs" --max-old-space-size=1024 server.js *>> $applicationLog'
if (-not $loopText.Contains($launchLine)) { throw 'Expected supervisor launch line was not found.' }
$loopText = $loopText.Replace($launchLine, '& $nodeCommand @probeArguments *>> $applicationLog')
$nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
$probeArguments = @('-e', "console.error('supervisor-stderr-probe'); process.exit(7)")
$applicationLog = Join-Path ([System.IO.Path]::GetTempPath()) ('mms-supervisor-probe-' + [guid]::NewGuid() + '.log')
$script:bootMessages = [System.Collections.Generic.List[string]]::new()
$script:restartCount = 0
function Write-BootLog { param([string]$Message) $script:bootMessages.Add($Message) }
function Start-Sleep {
    param([int]$Seconds)
    $script:restartCount++
    if ($script:restartCount -eq 2) { throw 'MMS_PROBE_DONE' }
}
try {
    try { & ([scriptblock]::Create($loopText)) } catch {
        if ($_.Exception.Message -ne 'MMS_PROBE_DONE') { throw }
    }
    $restarts = @($script:bootMessages | Where-Object { $_ -eq 'MMS exited with code 7. Restarting in five seconds.' })
    if ($restarts.Count -ne 2) { throw "Expected two recorded exits with code 7: $($script:bootMessages -join '; ')" }
    $diagnostics = Get-Content -LiteralPath $applicationLog -Raw
    if ([regex]::Matches($diagnostics, 'supervisor-stderr-probe').Count -lt 2) { throw 'Native stderr was not retained for both launches.' }
    if ($ErrorActionPreference -ne 'Stop') { throw 'Error preference was not restored.' }
    Write-Output "PASS: PowerShell $($PSVersionTable.PSVersion); stderr retained, exit code 7 recorded, supervisor relaunched twice."
} finally {
    if (Test-Path -LiteralPath $applicationLog) { Remove-Item -LiteralPath $applicationLog }
}
