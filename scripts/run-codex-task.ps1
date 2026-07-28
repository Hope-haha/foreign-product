param([Parameter(Mandatory=$true)][string]$JobDirectory)
$ErrorActionPreference = 'Stop'
$task = Join-Path $JobDirectory 'codex-task.md'
$output = Join-Path $JobDirectory 'output'
New-Item -ItemType Directory -Force -Path $output | Out-Null

$studioRoot = Split-Path -Parent $PSScriptRoot
$localCodex = Join-Path $studioRoot 'node_modules\.bin\codex.cmd'
$userCodex = Join-Path $env:USERPROFILE 'node_modules\.bin\codex.cmd'
$command = if ($env:CODEX_COMMAND) { $env:CODEX_COMMAND } elseif (Test-Path $localCodex) { $localCodex } elseif (Test-Path $userCodex) { $userCodex } else { 'codex' }
$images = @(Get-ChildItem (Join-Path $JobDirectory 'input') -File | Where-Object { $_.Extension -match '^\.(jpg|jpeg|png|webp)$' })
$whiteImage = Join-Path $JobDirectory 'product-white.jpg'
if (Test-Path $whiteImage) { $images += Get-Item $whiteImage }
$prompt = "Read '$task'. The attached source images and product-white.jpg are the only product references. Use the available image generation capability to create the requested scene image. Do not change the product's structure, logo, ports, controls, color, or accessory count. Save only the final PNG or JPG asset in '$output'. If image generation is unavailable, save a concise Chinese handoff note named codex-handoff.md in '$output' explaining the exact prompt and what is missing."
$arguments = @('exec', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '-C', $JobDirectory)
foreach ($image in $images) { $arguments += @('-i', $image.FullName) }
$arguments += $prompt
& $command @arguments
if ($LASTEXITCODE -ne 0) { throw "Codex command exited with code $LASTEXITCODE" }
