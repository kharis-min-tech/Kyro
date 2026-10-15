"""Live video: while someone on the website is watching a camera, send its
newest picture over and over (about 15 a second) so they see it live.

Always the newest picture, never a queue: on a slow internet connection the
video gets fewer pictures a second instead of falling behind. Nobody watching
→ nothing is sent.
"""
from __future__ import annotations

import json
import logging
import threading
import time

import cv2
import websocket  # websocket-client

from kyro_box import settings

log = logging.getLogger("kyro.box.streaming")

MAX_FPS = 15
# Picture sizes to choose from: the full one on good internet, smaller ones when
# sending is slow (e.g. the camera box is on weak Wi-Fi far across the hall).
WIDTHS = (1280, 960, 640)
JPEG_QUALITY = 72
SLOW_SEND_S = 0.25          # a picture taking longer than this to send = internet is struggling


class Streamer:
    def __init__(self, cameras, stop: threading.Event) -> None:
        self.cameras, self.stop = cameras, stop
        self.watching: set[str] = set()

    def run(self) -> None:
        wait = 2.0
        while not self.stop.is_set():
            cfg = settings.load()
            if not cfg.get("token"):
                self.stop.wait(30)
                continue
            url = cfg["server"].replace("https://", "wss://").replace("http://", "ws://") + "/api/devices/stream"
            try:
                ws = websocket.create_connection(url, header=[f"Authorization: Bearer {cfg['token']}"], timeout=15)
            except Exception as e:  # noqa: BLE001
                log.info("Live video link not available (%s) — retrying", e)
                self.stop.wait(wait)
                wait = min(60.0, wait * 2)
                continue
            log.info("Live video link open")
            wait = 2.0
            try:
                self._serve(ws)
            except Exception as e:  # noqa: BLE001
                log.info("Live video link dropped (%s) — reconnecting", e)
            finally:
                self.watching = set()
                try:
                    ws.close()
                except Exception:  # noqa: BLE001
                    pass
            self.stop.wait(2)

    def _serve(self, ws) -> None:
        last_ping = time.time()
        sent: dict[str, int] = {}
        size = 0                      # index into WIDTHS
        slow = fast = 0
        while not self.stop.is_set():
            started = time.time()
            # Messages from the website: which cameras are being watched.
            ws.settimeout(0.001 if self.watching else 1.0)
            try:
                msg = ws.recv()
                if isinstance(msg, str) and msg.startswith("{"):
                    self.watching = set(json.loads(msg).get("watch", []))
                    log.info("Live video: %s", ", ".join(sorted(self.watching)) or "nobody watching")
            except websocket.WebSocketTimeoutException:
                pass
            if time.time() - last_ping > 30:
                ws.send("ping")
                last_ping = time.time()
            if not self.watching:
                continue
            cams = {c.key: c for c in self.cameras.active()}
            for key in list(self.watching):
                cam = cams.get(key)
                frame = cam.peek() if cam else None
                if frame is None or sent.get(key) == id(frame):
                    continue
                sent[key] = id(frame)
                h, w = frame.shape[:2]
                width = WIDTHS[size]
                if w > width:
                    frame = cv2.resize(frame, (width, round(h * width / w)), interpolation=cv2.INTER_AREA)
                ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
                if not ok:
                    continue
                k = key.encode()[:255]
                t0 = time.time()
                ws.send_binary(bytes([len(k)]) + k + jpg.tobytes())  # waits while the internet is busy
                # Adapt to the connection: smaller pictures when slow, back up when it recovers.
                if time.time() - t0 > SLOW_SEND_S:
                    slow, fast = slow + 1, 0
                    if slow >= 3 and size < len(WIDTHS) - 1:
                        size, slow = size + 1, 0
                        log.info("Live video: slow internet — sending %d-wide pictures", WIDTHS[size])
                else:
                    fast, slow = fast + 1, 0
                    if fast >= 150 and size > 0:
                        size, fast = size - 1, 0
                        log.info("Live video: internet is quicker — sending %d-wide pictures", WIDTHS[size])
            pause = 1 / MAX_FPS - (time.time() - started)
            if pause > 0:
                time.sleep(pause)

