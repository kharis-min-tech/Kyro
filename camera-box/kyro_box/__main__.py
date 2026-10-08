"""Kyro Camera Box.

    python -m kyro_box pair [CODE]   connect this computer to the Kyro website (once)
    python -m kyro_box run           find cameras, count people, send counts (what auto-start runs)
    python -m kyro_box check         make sure everything needed is installed
    python -m kyro_box status        show whether this computer is paired
    python -m kyro_box install       download the latest version and set it up (used by the installers)
"""
from __future__ import annotations

import logging
import logging.handlers
import signal
import sys
import threading
import time

from kyro_box import __version__, cloud, settings

log = logging.getLogger("kyro.box")

SCAN_EVERY_S = 5


def setup_logging() -> None:
    settings.HOME.mkdir(parents=True, exist_ok=True)
    (settings.HOME / "logs").mkdir(exist_ok=True)
    handlers: list[logging.Handler] = [
        logging.handlers.RotatingFileHandler(settings.HOME / "logs" / "box.log", maxBytes=2_000_000, backupCount=3),
    ]
    if sys.stdout and sys.stdout.isatty():
        handlers.append(logging.StreamHandler())
    logging.basicConfig(level=logging.INFO, handlers=handlers,
                        format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s")


def cmd_pair(code: str | None) -> int:
    cfg = settings.load()
    server = cfg.get("server") or settings.DEFAULT_SERVER
    if not code:
        print("\nOn the Kyro website, go to Cameras → Pair a camera computer.")
        code = input("Type the code it shows (like ABCD-EFGH): ").strip()
    try:
        res = cloud.pair(server, code)
    except cloud.CloudError as e:
        print(f"\nCouldn't pair: {e}")
        return 1
    cfg.update(server=server, device_id=res["device_id"], token=res["token"])
    settings.save(cfg)
    print("\nPaired! Plug in your cameras — they'll appear on the website by themselves.")
    return 0


def cmd_status() -> int:
    cfg = settings.load()
    if cfg.get("token"):
        print(f"Paired with {cfg.get('server')} as {cfg.get('device_id')} (version {__version__})")
        return 0
    print("Not paired yet. Run: python -m kyro_box pair")
    return 1


def cmd_check() -> int:
    import cv2  # noqa: F401
    import numpy  # noqa: F401
    import ultralytics  # noqa: F401
    from ai.pipeline import VisionPipeline  # noqa: F401
    from kyro_box import cameras, counting, updater  # noqa: F401
    print(f"Kyro Camera Box {__version__}: everything needed is installed.")
    return 0


class Box:
    def __init__(self) -> None:
        from kyro_box.cameras import CameraManager
        from kyro_box.updater import AutoUpdater
        self.cameras = CameraManager()
        self.updater = AutoUpdater()
        self.counter = None
        self.stop = threading.Event()
        self.report_every = 5.0
        self.snapshot_every = 20.0
        self._last_snapshot: dict[str, float] = {}
        self.exit_code = 0

    # Background: tell the website what we see -------------------------------
    def _camera_report(self) -> list[dict]:
        out = []
        for cam in self.cameras.active():
            s = self.counter.stats.get(cam.key) if self.counter else None
            w, h = cam.size
            stale = s is None or time.time() - s.counted_at > 60
            error = cam.error or (s.error if s else None)
            if error is None and self.counter is None:
                error = "Starting the counting AI…"
            out.append({
                "key": cam.key, "kind": cam.kind, "label": cam.label,
                "current": s.current if s else 0, "peak": s.peak if s else 0,
                "entries": s.entries if s else 0, "exits": s.exits if s else 0,
                "status": "error" if error or stale else "online", "error": error,
                "fps": cam.fps, "width": w, "height": h,
            })
        return out

    def _send_snapshots(self, server: str, token: str) -> None:
        import cv2
        now = time.time()
        for cam in self.cameras.active():
            if now - self._last_snapshot.get(cam.key, 0) < self.snapshot_every:
                continue
            frame = cam.peek()
            if frame is None:
                continue
            self._last_snapshot[cam.key] = now
            scale = 960 / frame.shape[1]
            small = cv2.resize(frame, (960, int(frame.shape[0] * scale))) if scale < 1 else frame
            ok, jpg = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 70])
            if ok:
                try:
                    cloud.snapshot(server, token, cam.key, jpg.tobytes())
                except cloud.CloudError as e:
                    log.info("Picture upload failed for %s: %s", cam.key, e)

    def reporter(self) -> None:
        unpaired_logged = False
        while not self.stop.is_set():
            cfg = settings.load()
            if not cfg.get("token"):
                if not unpaired_logged:
                    log.warning("Not paired yet — run the installer again, or: python -m kyro_box pair")
                    unpaired_logged = True
                self.stop.wait(30)
                continue
            try:
                res = cloud.report(cfg["server"], cfg["token"], self._camera_report())
                self.cameras.set_disabled(res.get("disabled", []))
                self.cameras.sync_network(res.get("streams", []))
                self.report_every = float(res.get("report_every_s", 5))
                self.snapshot_every = float(res.get("snapshot_every_s", 20))
                self._send_snapshots(cfg["server"], cfg["token"])
            except cloud.CloudError as e:
                log.info("Report failed: %s", e)
                if e.status == 401:
                    log.warning("The website no longer knows this computer — pair it again")
                    self.stop.wait(60)
            except Exception:  # noqa: BLE001
                log.exception("Report failed")
            self.stop.wait(self.report_every)

    def scanner(self) -> None:
        while not self.stop.is_set():
            try:
                self.cameras.scan_usb()
            except Exception:  # noqa: BLE001
                log.exception("Camera scan failed")
            self.stop.wait(SCAN_EVERY_S)

    # Main thread: count ----------------------------------------------------
    def run(self) -> int:
        from kyro_box.counting import Counter
        from kyro_box.updater import UPDATE_EXIT_CODE

        threading.Thread(target=self.scanner, name="scanner", daemon=True).start()
        threading.Thread(target=self.reporter, name="reporter", daemon=True).start()
        self.counter = Counter()
        log.info("Kyro Camera Box %s running", __version__)
        started = time.time()

        while not self.stop.is_set():
            cams = self.cameras.active()
            self.counter.forget({c.key for c in cams})
            self.counter.new_day_check()
            counted = False
            for cam in cams:
                frame = cam.latest()
                if frame is not None:
                    self.counter.count(cam.key, frame)
                    counted = True
            if self.updater.due(self.counter.people_seen_recently(self.updater.QUIET_FOR_S)):
                self.exit_code = UPDATE_EXIT_CODE
                break
            if not counted:
                time.sleep(0.05)
            if time.time() - started > 600:
                (settings.HOME / "trial").unlink(missing_ok=True)   # new version is healthy
        self.stop.set()
        self.cameras.stop_all()
        return self.exit_code


def cmd_install() -> int:
    """Fetch the newest ai/ + camera-box/ from GitHub, install what they need, put the launcher in place."""
    import shutil
    from kyro_box import updater
    print("Downloading the latest Kyro Camera Box…")
    version, commit = updater.latest_version()
    if version != updater.running_version():
        updater.install(version, commit)
        (settings.HOME / "trial").unlink(missing_ok=True)
        (settings.HOME / "bad_version").unlink(missing_ok=True)
    code = settings.HOME / "app" / version
    shutil.copyfile(code / "camera-box" / "launcher.py", settings.HOME / "launcher.py")
    print(f"Installed version {version}.")
    return 0


def main(argv: list[str]) -> int:
    cmd = argv[0] if argv else "run"
    if cmd == "pair":
        return cmd_pair(argv[1] if len(argv) > 1 else None)
    if cmd == "status":
        return cmd_status()
    if cmd == "check":
        return cmd_check()
    if cmd == "install":
        return cmd_install()
    if cmd == "run":
        setup_logging()
        box = Box()
        signal.signal(signal.SIGTERM, lambda *_: box.stop.set())
        try:
            return box.run()
        except KeyboardInterrupt:
            box.stop.set()
            box.cameras.stop_all()
            return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
