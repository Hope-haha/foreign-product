$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root
$node = Get-Command node -ErrorAction Stop
& $node.Source .\server.js
