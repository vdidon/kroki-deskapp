# Opens a document in the installed Kroki Desk (MSI), at an optional reference.
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File open.ps1 "C:/…/doc.tex#eq:x"
# Output: one `STATUS: detail` line. Codes:
#   0 OPENED       opened, fragment passed
#   3 OPENED_PLAIN opened WITHOUT the fragment (version < 3.20.0) — name the passage in the reply
#   2 NOT_INSTALLED no MSI installation found
#   4 NOT_FOUND    file not found
param([Parameter(Mandatory = $true)][string]$Target)
$ErrorActionPreference = "Stop"
$MinFragment = [version]"3.20.0"

# 1. The installation: the App Paths key set by the MSI carries the real install
#    folder, wherever it is. HKCU first (per-user override).
$exe = $null
foreach ($root in "HKCU:", "HKLM:") {
    $key = "$root\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\kroki_deskapp.exe"
    $val = (Get-ItemProperty -Path $key -ErrorAction SilentlyContinue).'(default)'
    if ($val) {
        $val = $val.Trim('"')
        if (Test-Path -LiteralPath $val -PathType Leaf) { $exe = $val; break }
    }
}
if (-not $exe) {
    Write-Output "NOT_INSTALLED: no valid App Paths\kroki_deskapp.exe key (Kroki Desk must be installed by MSI >= 3.20.0)"
    exit 2
}
$version = [version]((Get-Item -LiteralPath $exe).VersionInfo.ProductVersion -replace '[^0-9.].*$', '')

# 2. The file and its fragment — same rule as the application: the whole
#    argument is tried as a path first, otherwise split at the LAST '#'.
$file = $Target; $fragment = ""
if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    $i = $Target.LastIndexOf('#')
    if ($i -gt 0) { $file = $Target.Substring(0, $i); $fragment = $Target.Substring($i + 1) }
}
if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    Write-Output "NOT_FOUND: $file"
    exit 4
}
$file = (Resolve-Path -LiteralPath $file).ProviderPath

# 3. Detached launch (Start-Process returns immediately, whether or not the
#    application was already open). Full path to the exe: no lookup by name.
$plain = $fragment -and $version -lt $MinFragment
$arg = if ($fragment -and -not $plain) { "$file#$fragment" } else { $file }
Start-Process -FilePath $exe -ArgumentList ('"' + $arg + '"')
if ($plain) {
    Write-Output "OPENED_PLAIN: $file (Kroki Desk $version < $MinFragment, fragment '$fragment' dropped)"
    exit 3
}
Write-Output "OPENED: $arg (Kroki Desk $version, $exe)"
exit 0
