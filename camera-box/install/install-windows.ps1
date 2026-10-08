# Kyro Camera Box installer for Windows.
#
# Run in PowerShell (no admin needed):
#   powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/kharis-min-tech/Kyro/main/camera-box/install/install-windows.ps1 | iex"
#
# Installs Python if needed, downloads Kyro, asks for the pairing code from the
# website, and sets Kyro to start by itself whenever this computer signs in.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Home2 = Join-Path $env:USERPROFILE ".kyro-box"
$Repo = "kharis-min-tech/Kyro"

function Say($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# 1. Python 3.12
Say "Checking for Python"
$py = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
if (-not (Test-Path $py)) {
    Say "Installing Python 3.12 (one time, a few minutes)"
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements | Out-Null
    }
    if (-not (Test-Path $py)) {
        $setup = Join-Path $env:TEMP "python-3.12-setup.exe"
        Invoke-WebRequest "https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe" -OutFile $setup
        Start-Process $setup -ArgumentList "/quiet InstallAllUsers=0 Include_launcher=0 PrependPath=0" -Wait
    }
    if (-not (Test-Path $py)) { throw "Python couldn't be installed. Install Python 3.12 from python.org, then run this again." }
}

# 2. Kyro's own Python environment
New-Item -ItemType Directory -Force -Path $Home2 | Out-Null
$venvPy = Join-Path $Home2 "venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    Say "Setting up Kyro's Python environment"
    & $py -m venv (Join-Path $Home2 "venv")
}
& $venvPy -m pip install --disable-pip-version-check -q --upgrade pip

# 3. Download the latest Kyro Camera Box + counting AI, install what it needs
Say "Downloading Kyro (the first time takes 10-20 minutes)"
$tmp = Join-Path $env:TEMP "kyro-box-bootstrap"
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Invoke-WebRequest "https://codeload.github.com/$Repo/zip/refs/heads/main" -OutFile (Join-Path $tmp "kyro.zip")
Expand-Archive (Join-Path $tmp "kyro.zip") -DestinationPath $tmp
$src = Get-ChildItem $tmp -Directory | Select-Object -First 1
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    # NVIDIA graphics card: the standard Windows download of the AI library
    # can't use it, so get the graphics-card version first (much faster counting).
    Say "NVIDIA graphics card found - installing the fast version of the AI"
    & $venvPy -m pip install --disable-pip-version-check -q torch torchvision --index-url https://download.pytorch.org/whl/cu124
}
& $venvPy -m pip install --disable-pip-version-check -q -r (Join-Path $src.FullName "camera-box\requirements.txt")
$env:PYTHONPATH = "$($src.FullName);$($src.FullName)\camera-box"
& $venvPy -m kyro_box install
if ($LASTEXITCODE -ne 0) { throw "Kyro couldn't be installed (see the messages above)." }

# 4. Pair with the website
$current = (Get-Content (Join-Path $Home2 "current")).Trim()
$code = Join-Path $Home2 "app\$current"
$env:PYTHONPATH = "$code;$code\camera-box"
& $venvPy -m kyro_box status | Out-Null
if ($LASTEXITCODE -ne 0) {
    Say "Pair this computer with your Kyro website"
    do { & $venvPy -m kyro_box pair } while ($LASTEXITCODE -ne 0)
}
Remove-Item Env:PYTHONPATH

# 5. Start by itself at sign-in, restart if it ever stops
Say "Setting Kyro to start automatically"
$pyw = Join-Path $Home2 "venv\Scripts\pythonw.exe"
$launcher = Join-Path $Home2 "launcher.py"
$action = New-ScheduledTaskAction -Execute $pyw -Argument "`"$launcher`"" -WorkingDirectory $Home2
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
Unregister-ScheduledTask -TaskName "Kyro Camera Box" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "Kyro Camera Box" -Action $action -Trigger $trigger -Settings $settings -Description "Counts people with Kyro's AI and sends counts to the Kyro website" | Out-Null
Start-ScheduledTask -TaskName "Kyro Camera Box"

# Keep the computer awake so counting never pauses
powercfg /change standby-timeout-ac 0 2>$null

Say "All done!"
Write-Host "Kyro is running and will start by itself whenever this computer is on."
Write-Host "Plug in your cameras - they appear on the website's Cameras page within a few seconds."
Write-Host "The first start downloads the counting AI, so the first counts can take a few minutes."
