param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$venv = Join-Path $root '.venv'

if (-not (Get-Command $Python -ErrorAction SilentlyContinue)) {
  throw 'Python was not found. Install Python 3.10 or 3.11 and select Add Python to PATH.'
}
if (-not (Test-Path -LiteralPath $venv)) { & $Python -m venv $venv }

$py = Join-Path $venv 'Scripts\python.exe'
& $py -m pip install --upgrade pip
& $py -m pip install torch torchvision
& $py -m pip install opencv-python 'git+https://github.com/PramaLLC/BEN2.git'
& $py -c "from ben2 import AutoModel; AutoModel.from_pretrained('PramaLLC/BEN2'); print('BEN2 is ready.')"

Write-Host 'BEN2 setup completed. The model is stored in this Windows user cache.'
