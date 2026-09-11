# Client Mode - one-line install for Windows (PowerShell 5.1 or later).
#
#   irm https://raw.githubusercontent.com/jaysonventura/clientmode/main/install.ps1 | iex
#
# What it does, in order:
#   1. uses Node >= 22.17 if you have it, otherwise downloads Node into %USERPROFILE%\.client-mode\runtime
#      (checksum-verified against nodejs.org; no administrator rights, nothing system-wide);
#   2. downloads Client Mode into %USERPROFILE%\.client-mode\src and installs its dependencies there;
#   3. runs `cm install`: the cm plugin for Claude Code, and the same rules and skills for Codex,
#      Gemini CLI and Cursor, with each host set to run without approval prompts;
#   4. puts `cm` on your user PATH.
#
# Options, as environment variables set before running it:
#   $env:CM_HOSTS = 'claude,codex'   configure only these hosts (default: all four)
#   $env:CM_NO_AUTONOMY = '1'        leave every host's permission settings unchanged
#   $env:CM_REF = 'v2.0.0'           install a tag or branch instead of main
#   $env:CM_SOURCE_ZIP = 'C:\x.zip'  install from a local .zip instead of downloading (used by CI)
#
# Remove everything again with: cm uninstall

function Install-ClientMode {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $repo = 'jaysonventura/clientmode'
  $ref = if ($env:CM_REF) { $env:CM_REF } else { 'main' }
  $cmHome = if ($env:CM_HOME) { $env:CM_HOME } else { Join-Path $env:USERPROFILE '.client-mode' }
  $nodeVersion = '22.23.2'
  # SHA256 of each Node download, pinned here and checked against nodejs.org's signed SHASUMS256.txt
  # (gpgv, Node release keys) when this version was chosen. A tampered file on either host fails.
  $nodeSha256 = @{
    'node-v22.23.2-win-x64.zip'   = '1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97'
    'node-v22.23.2-win-arm64.zip' = 'fec025a6da31757e3b6af84c5a1628e9d38442ca99a2161091d78f2fcfa35ef3'
  }
  $bin = Join-Path $env:USERPROFILE '.local\bin'
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("client-mode-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null

  function Test-Node([string]$exe) {
    if (-not $exe -or -not (Test-Path $exe)) { return $false }
    try {
      $version = (& $exe -p 'process.versions.node') 2>$null
      $parts = "$version".Trim().Split('.')
      $major = [int]$parts[0]; $minor = [int]$parts[1]
      return ($major -gt 22) -or ($major -eq 22 -and $minor -ge 17)
    } catch { return $false }
  }

  function Expand-Zip([string]$zip, [string]$destination) {
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (Test-Path $tar) {
      & $tar -xf $zip -C $destination
      if ($LASTEXITCODE -ne 0) { throw "could not extract $zip" }
    } else {
      Expand-Archive -Path $zip -DestinationPath $destination -Force
    }
  }

  try {
    # 1. Node
    $node = $null
    $onPath = Get-Command node -ErrorAction SilentlyContinue
    $privateNode = Join-Path $cmHome 'runtime\node\node.exe'
    if ($onPath -and (Test-Node $onPath.Source)) {
      $node = $onPath.Source
      Write-Host "Using Node $(& $node --version) at $node"
    } elseif (Test-Node $privateNode) {
      $node = $privateNode
      Write-Host "Using Client Mode's Node $(& $node --version)"
    } else {
      $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
      $name = "node-v$nodeVersion-win-$arch"
      Write-Host "Downloading Node v$nodeVersion (no system changes; it lives in $cmHome\runtime)..."
      $zip = Join-Path $tmp "$name.zip"
      Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$nodeVersion/$name.zip" -OutFile $zip
      $expected = $nodeSha256["$name.zip"]
      if (-not $expected) { throw "no pinned checksum for $name.zip" }
      $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
      if (-not $expected -or $expected -ne $actual) { throw "Node checksum mismatch (expected $expected, got $actual)" }
      $runtime = Join-Path $cmHome 'runtime'
      Remove-Item -Recurse -Force (Join-Path $runtime 'node') -ErrorAction SilentlyContinue
      Expand-Zip $zip $runtime
      Move-Item (Join-Path $runtime $name) (Join-Path $runtime 'node')
      $node = $privateNode
    }
    $nodeDir = Split-Path $node
    $env:Path = "$nodeDir;$env:Path"

    # 2. Source and dependencies
    Write-Host "Downloading Client Mode ($ref)..."
    $sourceZip = Join-Path $tmp 'src.zip'
    if ($env:CM_SOURCE_ZIP) { Copy-Item $env:CM_SOURCE_ZIP $sourceZip }
    else { Invoke-WebRequest -UseBasicParsing -Uri "https://codeload.github.com/$repo/zip/$ref" -OutFile $sourceZip }
    $unpacked = Join-Path $tmp 'unpacked'
    Expand-Zip $sourceZip $unpacked
    $top = Get-ChildItem -Directory $unpacked | Select-Object -First 1
    if (-not $top -or -not (Test-Path (Join-Path $top.FullName 'apps\cli\src\cm.ts'))) { throw 'the download does not contain Client Mode' }
    $src = Join-Path $cmHome 'src'
    New-Item -ItemType Directory -Force -Path $cmHome | Out-Null
    Remove-Item -Recurse -Force $src -ErrorAction SilentlyContinue
    Move-Item $top.FullName $src

    Write-Host 'Installing dependencies...'
    Push-Location $src
    try {
      $npm = Join-Path $nodeDir 'npm.cmd'
      if (-not (Test-Path $npm)) { $npm = (Get-Command npm -ErrorAction Stop).Source }
      & $npm ci --omit=dev --no-audit --no-fund --loglevel=error
      if ($LASTEXITCODE -ne 0) { throw "npm ci failed in $src" }

      # 3. cm install
      $arguments = @('--import', 'tsx', 'apps/cli/src/cm.ts', 'install', '--bin-dir', $bin)
      if ($env:CM_HOSTS) { $arguments += @('--host', $env:CM_HOSTS) }
      if (@('1', 'true', 'yes', 'on') -contains "$env:CM_NO_AUTONOMY".ToLower()) { $arguments += '--no-autonomy' }
      Write-Host 'Configuring your hosts...'
      $env:CM_HOME = $cmHome
      $env:NODE_NO_WARNINGS = '1'
      & $node @arguments
      if ($LASTEXITCODE -ne 0) { throw 'cm install did not finish' }
    } finally {
      Pop-Location
    }

    # 4. PATH for new terminals (user scope; no administrator rights needed)
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @()
    if ($userPath) { $entries = $userPath -split ';' | Where-Object { $_ } }
    if (-not ($entries | Where-Object { $_.TrimEnd('\') -ieq $bin })) {
      [Environment]::SetEnvironmentVariable('Path', (@($bin) + $entries) -join ';', 'User')
      Write-Host "Added $bin to your user PATH"
    }
    if (-not (($env:Path -split ';') | Where-Object { $_.TrimEnd('\') -ieq $bin })) { $env:Path = "$bin;$env:Path" }

    # Claude Code runs the plugin's hooks with Git Bash when it is installed, PowerShell otherwise.
    $git = Get-Command git -ErrorAction SilentlyContinue
    $gitBash = $null
    if ($git) {
      # git.exe lives in Git\cmd or Git\mingw64\bin; bash.exe is in Git\bin either way.
      $gitBash = @((Join-Path (Split-Path (Split-Path $git.Source)) 'bin\bash.exe'),
                   (Join-Path (Split-Path (Split-Path (Split-Path $git.Source))) 'bin\bash.exe')) |
        Where-Object { Test-Path $_ } | Select-Object -First 1
    }
    if (-not $gitBash) {
      Write-Host ''
      Write-Host 'Note: Git for Windows was not found. The cm plugin''s Claude Code hooks need Git Bash.' -ForegroundColor Yellow
      Write-Host '      Install it with:  winget install --id Git.Git -e' -ForegroundColor Yellow
    }

    Write-Host ''
    Write-Host 'Client Mode is installed.' -ForegroundColor Green
    $missing = @('claude', 'codex', 'gemini', 'agent') | Where-Object { -not (Get-Command $_ -ErrorAction SilentlyContinue) }
    if ($missing) { Write-Host "Not found on this machine: $($missing -join ', '). Their settings are ready; install any you use, then run: cm install" }
    Write-Host 'Open a new terminal, then:'
    Write-Host '  cm doctor                 check the install'
    Write-Host '  cd your-project; cm       start your preferred host there'
    Write-Host 'Remove it with: cm uninstall'
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}

Install-ClientMode
