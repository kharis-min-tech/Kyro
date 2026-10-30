"""Find cameras (camera-box/kyro_box/discovery.py), against a pretend ONVIF camera on this computer."""
import base64
import hashlib
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "camera-box"))
from kyro_box import discovery  # noqa: E402

MATCH = b"""<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
 xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"><s:Body><d:ProbeMatches><d:ProbeMatch>
<d:Scopes>onvif://www.onvif.org/name/Reolink_Balcony onvif://www.onvif.org/hardware/RLC-510A onvif://www.onvif.org/type/video_encoder</d:Scopes>
<d:XAddrs>http://192.168.1.23:8000/onvif/device_service http://[fe80::1]/onvif/device_service</d:XAddrs>
</d:ProbeMatch></d:ProbeMatches></s:Body></s:Envelope>"""


def test_probe_reply_is_read():
    cam = discovery._parse_match(MATCH, "192.168.1.23")
    assert cam == {"ip": "192.168.1.23", "xaddr": "http://192.168.1.23:8000/onvif/device_service",
                   "name": "Reolink Balcony", "model": "RLC-510A"}


def test_reply_pointing_outside_the_network_is_ignored():
    bad = MATCH.replace(b"192.168.1.23", b"8.8.8.8")
    assert discovery._parse_match(bad, "8.8.8.8") is None
    assert discovery._parse_match(b"<not xml", "192.168.1.23") is None


def test_only_local_addresses():
    assert discovery._local("192.168.0.5") and discovery._local("10.1.2.3") and discovery._local("169.254.1.1")
    assert not discovery._local("8.8.8.8") and not discovery._local("example.com")
    with pytest.raises(discovery.AddError):
        discovery.stream_address("http://8.8.8.8/onvif/device_service", "admin", "pw")


class FakeCamera(BaseHTTPRequestHandler):
    """Answers like an ONVIF camera whose login is admin / s3cret&pw."""
    user, password = "admin", "s3cret&pw"
    calls: list = []

    def log_message(self, *a):
        pass

    def _authorised(self, body: str) -> bool:
        import re
        m = {k: re.search(f"<{k}[^>]*>([^<]+)</{k}>", body) for k in ("Username", "Password", "Nonce", "Created")}
        if not all(m.values()):
            return False
        nonce = base64.b64decode(m["Nonce"].group(1))
        want = base64.b64encode(hashlib.sha1(nonce + m["Created"].group(1).encode() + self.password.encode()).digest()).decode()
        return m["Username"].group(1) == self.user and m["Password"].group(1) == want

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"])).decode()
        op = next(o for o in ("GetSystemDateAndTime", "GetCapabilities", "GetProfiles", "GetStreamUri") if o in body)
        FakeCamera.calls.append(op)
        port = self.server.server_address[1]
        if op == "GetSystemDateAndTime":
            out = ("<tt:UTCDateTime xmlns:tt='x'><tt:Date><tt:Year>2030</tt:Year><tt:Month>1</tt:Month><tt:Day>1</tt:Day></tt:Date>"
                   "<tt:Time><tt:Hour>0</tt:Hour><tt:Minute>0</tt:Minute><tt:Second>0</tt:Second></tt:Time></tt:UTCDateTime>")
        elif not self._authorised(body):
            self.send_response(400); self.end_headers()
            self.wfile.write(b"<s:Envelope><s:Body><s:Fault><s:Code><s:Subcode><s:Value>ter:NotAuthorized</s:Value></s:Subcode></s:Code></s:Fault></s:Body></s:Envelope>")
            return
        elif op == "GetCapabilities":
            out = f"<Capabilities><Media><XAddr>http://127.0.0.1:{port}/onvif/media</XAddr></Media></Capabilities>"
        elif op == "GetProfiles":
            out = "<Profiles token='main'/><Profiles token='sub'/>"
        else:
            assert "<ProfileToken>main</ProfileToken>" in body
            out = "<MediaUri><Uri>rtsp://192.168.1.23:554/h264Preview_01_main</Uri></MediaUri>"
        self.send_response(200); self.end_headers()
        self.wfile.write(f"<s:Envelope xmlns:s='s'><s:Body>{out}</s:Body></s:Envelope>".encode())


@pytest.fixture()
def camera():
    srv = HTTPServer(("127.0.0.1", 0), FakeCamera)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    FakeCamera.calls = []
    yield f"http://127.0.0.1:{srv.server_address[1]}/onvif/device_service"
    srv.shutdown()


def test_stream_address_with_the_typed_login(camera):
    # The camera's clock is years ahead: the login must use the camera's time.
    url = discovery.stream_address(camera, "admin", "s3cret&pw")
    assert url == "rtsp://admin:s3cret%26pw@192.168.1.23:554/h264Preview_01_main"


def test_wrong_password_says_so_and_tries_nothing_else(camera):
    with pytest.raises(discovery.AddError, match="username or password"):
        discovery.stream_address(camera, "admin", "guess")
    # One attempt with what the admin typed — no other passwords.
    assert FakeCamera.calls.count("GetCapabilities") == 1 and "GetProfiles" not in FakeCamera.calls


def test_camera_switched_off():
    with pytest.raises(discovery.AddError, match="Couldn't reach"):
        discovery.stream_address("http://127.0.0.1:9/onvif/device_service", "admin", "pw")
