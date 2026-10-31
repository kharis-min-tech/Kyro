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
    from kyro_box import cameras, counting, discovery, faces, seatfinder, streaming, updater  # noqa: F401
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
        self._jobs_seen: set[str] = set()
        self.seat_finder = None
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
            elif error is None and stale and s is not None and s.counted_at:
                # Never pass an old number off as live.
                error = f"No new count for {int(time.time() - s.counted_at)} s — the number shown is out of date"
            out.append({
                "key": cam.key, "kind": cam.kind, "label": cam.label,
                "current": s.current if s else 0, "peak": s.peak if s else 0,
                "entries": s.entries if s else 0, "exits": s.exits if s else 0,
                "status": "error" if error or stale else "online", "error": error,
                "fps": cam.fps, "width": w, "height": h,
                **({"seats": s.seats} if s is not None and s.seats is not None else {}),
                **({"questions": [q for q, _ in s.questions]} if s is not None and s.questions else {}),
                **({"faces": s.faces, "faces_age_s": round(time.time() - s.faces_at, 1)}
                   if s is not None and s.faces is not None and self.counter and self.counter.face_matching else {}),
            })
        # Just unplugged (or the capture card's cable came out): say so now, not after a timeout.
        for key, (label, _at) in list(self.cameras.unplugged.items()):
            if key not in {c["key"] for c in out}:
                out.append({"key": key, "kind": "usb", "label": label, "current": 0, "status": "error",
                            "error": "Unplugged — check the camera's (or capture card's) USB cable"})
        # Plugged in but not added on the website yet: the website asks an admin.
        for c in self.cameras.standby:
            out.append({"key": c["key"], "kind": "usb", "label": c["label"], "status": "standby"})
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

    def _after_questions_sent(self, server: str, token: str, sent: dict) -> None:
        """The questions went with the report: send each one's picture, then forget them here."""
        if self.counter is None:
            return
        for key, n in sent.items():
            s = self.counter.stats.get(key)
            if not s or not n:
                continue
            batch, s.questions[:n] = s.questions[:n], []
            for q, jpg in batch:
                if jpg:
                    try:
                        cloud.question_snapshot(server, token, q["review_id"], jpg)
                    except cloud.CloudError as e:
                        log.info("Couldn't send the question's picture: %s", e)

    def _apply_answers(self, answers) -> None:
        if self.counter is None or not isinstance(answers, list):
            return
        for a in answers:
            key, rid, ans = str(a.get("key", "")), str(a.get("review_id", "")), str(a.get("answer", ""))
            if a.get("kind") == "seat_question" and self.seat_finder is not None:
                self.seat_finder.answer(key, rid, ans)
            elif not self.counter.apply_answer(key, rid, ans):
                log.info("An answer arrived for a question that had already expired (%s)", rid)

    def _sync_seats(self, server: str, token: str, versions) -> None:
        """Seat layouts drawn on the website: fetch one only when it changed."""
        if self.counter is None or not isinstance(versions, dict):
            return
        for key in list(self.counter._seats):
            if key not in versions:
                self.counter.set_seats(key, None, [])
        for key, version in versions.items():
            if self.counter.seat_version(key) != version:
                try:
                    lay = cloud.seats(server, token, key)
                    self.counter.set_seats(key, lay.get("version"), lay.get("seats") or [])
                    log.info("Seat layout for %s: %d seats", key, len(lay.get("seats") or []))
                except cloud.CloudError as e:
                    log.info("Couldn't fetch the seat layout for %s: %s", key, e)

    # Requests from the website: "Find cameras" and "Add this camera" ---------
    def _start_jobs(self, server: str, token: str, jobs: list) -> None:
        for job in jobs if isinstance(jobs, list) else []:
            jid = str(job.get("id", ""))
            if not jid or jid in self._jobs_seen:
                continue
            self._jobs_seen.add(jid)
            threading.Thread(target=self._run_job, args=(server, token, job), name=f"job-{jid}", daemon=True).start()

    def _run_job(self, server: str, token: str, job: dict) -> None:
        from kyro_box import discovery
        result: dict = {"id": job["id"]}
        try:
            if job.get("type") == "find":
                result["found"] = discovery.find_cameras()
            elif job.get("type") == "add":
                url = discovery.stream_address(str(job.get("xaddr", "")), str(job.get("username", "")), str(job.get("password", "")))
                discovery.check_picture(url)
                result.update(ok=True, url=url)
                log.info("Camera at %s added from Find cameras", job.get("ip"))
            else:
                return
        except discovery.AddError as e:
            result.update(ok=False, error=str(e))
        except Exception:  # noqa: BLE001
            log.exception("Request %s failed", job.get("type"))
            result.update(ok=False, error="Something went wrong on the camera computer")
        for _ in range(3):
            try:
                cloud.job_result(server, token, result)
                return
            except cloud.CloudError as e:
                log.info("Couldn't send the result: %s", e)
                self.stop.wait(3)

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
                report = self._camera_report()
                sent_questions = {c["key"]: len(c.get("questions", [])) for c in report}
                res = cloud.report(cfg["server"], cfg["token"], report)
                self._after_questions_sent(cfg["server"], cfg["token"], sent_questions)
                self._apply_answers(res.get("answers"))
                if self.counter is not None:
                    for key in {c.key for c in self.cameras.active()}:
                        self.counter.set_policies(key, (res.get("rota") or {}).get(key, []), (res.get("seat_zones") or {}).get(key, []))
                self.cameras.set_allowed(res.get("allowed", []))
                if self.counter is not None and isinstance(res.get("ignore_zones"), dict):
                    self.counter.ignore_zones = res["ignore_zones"]
                self.cameras.sync_network(res.get("streams", []))
                self._start_jobs(cfg["server"], cfg["token"], res.get("jobs", []))
                self._sync_seats(cfg["server"], cfg["token"], res.get("seat_layouts"))
                if self.seat_finder is not None:
                    self.seat_finder.publish(cfg["server"], cfg["token"])
                if self.counter is not None:
                    on = bool(res.get("face_matching"))
                    if on != self.counter.face_matching:
                        log.info("Face matching across cameras %s", "on (service running)" if on else "off — face codes cleared")
                    self.counter.face_matching = on
                    if not on:
                        for st in self.counter.stats.values():
                            st.faces = None     # nothing face-related kept outside a service
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
        from kyro_box.cameras import FROZEN, FROZEN_AFTER_S, NO_SIGNAL, fingerprint, no_signal
        from kyro_box.counting import CameraStats, Counter
        from kyro_box.updater import UPDATE_EXIT_CODE

        threading.Thread(target=self.scanner, name="scanner", daemon=True).start()
        threading.Thread(target=self.reporter, name="reporter", daemon=True).start()
        from kyro_box.streaming import Streamer
        threading.Thread(target=Streamer(self.cameras, self.stop).run, name="live-video", daemon=True).start()
        self.counter = Counter()
        from kyro_box.seatfinder import SeatFinder
        self.seat_finder = self.counter.seat_finder = SeatFinder(self.counter, self.counter._detector)
        log.info("Kyro Camera Box %s running", __version__)
        started = time.time()
        same_since: dict[str, tuple[bytes, float]] = {}   # camera → (picture fingerprint, when it was first seen)

        while not self.stop.is_set():
            cams = self.cameras.active()
            self.counter.forget({c.key for c in cams})
            self.counter.new_day_check()
            counted = False
            for cam in cams:
                frame = cam.latest()
                if frame is None:
                    continue
                if no_signal(frame):
                    # Camera / transmitter off or out of range: say so instead of counting 0.
                    st = self.counter.stats.setdefault(cam.key, CameraStats())
                    st.current, st.error, st.counted_at = 0, NO_SIGNAL, time.time()
                    self.counter.restart_steadying(cam.key)
                    continue
                fp, now = fingerprint(frame), time.time()
                if same_since.get(cam.key, (None,))[0] != fp:
                    same_since[cam.key] = (fp, now)
                elif now - same_since[cam.key][1] > FROZEN_AFTER_S:
                    # Stuck receiver: never pass an old picture's count off as live.
                    st = self.counter.stats.setdefault(cam.key, CameraStats())
                    st.current, st.error, st.counted_at = 0, FROZEN, now
                    self.counter.restart_steadying(cam.key)
                    continue
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
