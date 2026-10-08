# Kyro Camera Box

Runs on the computer at church that the cameras connect to. It finds USB
cameras as they're plugged in (and network cameras added on the website),
counts people with Kyro's AI (`ai/`), and sends counts and a picture every
20 seconds to the website (`worker/venue.js`).

- **Install:** see the [camera setup guide](https://kyro-help.kharischurch.com/guides/camera-setup)
  (`install/install-windows.ps1`, `install/install.sh`).
- **Auto-start:** Task Scheduler (Windows), LaunchAgent (Mac) or a systemd user service (Linux) runs `launcher.py`.
- **Auto-update:** `kyro_box/updater.py` checks GitHub hourly. When `ai/` or `camera-box/` change on `main`,
  it installs the new version once no one has been seen for 15 minutes (or at 3am). `launcher.py` rolls back if
  the new version fails to start 3 times.
- **Files:** `~/.kyro-box/` (config.json with the device key, app/<version>/, venv/, models/, logs/).

Commands (run with the venv's Python, from an installed version folder):

    python -m kyro_box pair [CODE]
    python -m kyro_box run
    python -m kyro_box status
    python -m kyro_box check
