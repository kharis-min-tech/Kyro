"""Find cameras on this computer's network — only when an administrator presses
"Find cameras" on the website's Cameras page. Never in the background.

Finding: one ONVIF WS-Discovery "probe" (the standard way security cameras say
"I'm here") sent to the local network. Cameras that answer are listed with
the name and model they announce. No logins are tried and nothing else on
the network is contacted.

Adding: the administrator chooses a camera and types ITS username and
password. With exactly that login, the camera is asked for its video address
(ONVIF GetStreamUri), and the picture is opened once to check it works.
Standard library only.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import ipaddress
import logging
import os
import re
import socket
import time
import urllib.error
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from urllib.parse import quote, urlsplit, urlunsplit

log = logging.getLogger("kyro.box.discovery")

MULTICAST = ("239.255.255.250", 3702)
LISTEN_S = 4.0
MAX_FOUND = 50
MAX_REPLY = 256_000          # bytes; anything bigger isn't a sensible camera reply

PROBE = """<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
 xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
<e:Header><w:MessageID>uuid:{id}</w:MessageID><w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
<w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header>
<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>"""


class AddError(Exception):
    """Something the administrator can act on, in plain English."""


def _local(host: str) -> bool:
    """Only cameras on the church's own network (private addresses) are ever contacted."""
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_private or ip.is_link_local


def _local_ips() -> list[str]:
    ips: set[str] = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.0.2.1", 9))          # picks the main network; nothing is sent
        ips.add(s.getsockname()[0]); s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return [i for i in ips if not i.startswith("127.")] or [""]


def _text(el) -> str:
    return (el.text or "").strip() if el is not None else ""


def _find_all(root, name: str):
    return [e for e in root.iter() if e.tag.rsplit("}", 1)[-1] == name]


def _parse_match(raw: bytes, sender: str) -> dict | None:
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return None
    for m in _find_all(root, "ProbeMatch"):
        xaddrs = [x for e in _find_all(m, "XAddrs") for x in _text(e).split()]
        # The camera's ONVIF address, on the local network and from the camera that answered.
        xaddr = next((x for x in xaddrs if urlsplit(x).hostname == sender), None) \
            or next((x for x in xaddrs if _local(urlsplit(x).hostname or "")), None)
        if not xaddr or urlsplit(xaddr).scheme not in ("http", "https") or not _local(urlsplit(xaddr).hostname or ""):
            continue
        scopes = " ".join(_text(e) for e in _find_all(m, "Scopes")).split()
        def scope(kind: str) -> str:
            v = next((s.split(f"/{kind}/", 1)[1] for s in scopes if f"onvif.org/{kind}/" in s), "")
            return urllib.request.unquote(v).replace("_", " ").strip()[:60]
        return {"ip": urlsplit(xaddr).hostname, "xaddr": xaddr[:300],
                "name": scope("name"), "model": scope("hardware")}
    return None


def find_cameras() -> list[dict]:
    """Ask the local network once which cameras are there; listen for a few seconds."""
    found: dict[str, dict] = {}
    socks = []
    for ip in _local_ips():
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
            s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 1)   # stay on this network
            if ip:
                s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(ip))
                s.bind((ip, 0))
            s.setblocking(False)
            s.sendto(PROBE.format(id=uuid.uuid4()).encode(), MULTICAST)
            socks.append(s)
        except OSError as e:
            log.info("Couldn't look for cameras on %s: %s", ip or "the network", e)
    end = time.time() + LISTEN_S
    import select
    while socks and time.time() < end and len(found) < MAX_FOUND:
        ready, _, _ = select.select(socks, [], [], max(0.05, end - time.time()))
        for s in ready:
            try:
                raw, (sender, _) = s.recvfrom(MAX_REPLY)
            except OSError:
                continue
            if not _local(sender):
                continue
            cam = _parse_match(raw, sender)
            if cam and cam["ip"] not in found:
                found[cam["ip"]] = cam
    for s in socks:
        s.close()
    log.info("Find cameras: %d answered", len(found))
    return sorted(found.values(), key=lambda c: tuple(int(p) for p in c["ip"].split(".")) if c["ip"].count(".") == 3 else (999,))


# ── Adding a camera with the login the administrator typed ──────────────────

def _envelope(body: str, user: str = "", password: str = "", offset: float = 0.0) -> bytes:
    sec = ""
    if user:
        nonce = os.urandom(16)
        created = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=offset)).strftime("%Y-%m-%dT%H:%M:%SZ")
        digest = base64.b64encode(hashlib.sha1(nonce + created.encode() + password.encode()).digest()).decode()
        sec = ('<s:Header><Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">'
               f'<UsernameToken><Username>{_xml(user)}</Username>'
               '<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">'
               f'{digest}</Password><Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">'
               f'{base64.b64encode(nonce).decode()}</Nonce>'
               f'<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">{created}</Created>'
               '</UsernameToken></Security></s:Header>')
    return (f'<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">'
            f'{sec}<s:Body>{body}</s:Body></s:Envelope>').encode()


def _xml(v: str) -> str:
    return v.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _post(url: str, data: bytes, user: str = "", password: str = ""):
    host = urlsplit(url).hostname or ""
    if not _local(host):
        raise AddError("That camera isn't on the church network")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/soap+xml; charset=utf-8"})
    handlers = []
    if user:
        # Some cameras want the login as ordinary web sign-in too (same login, same request).
        mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
        mgr.add_password(None, url, user, password)
        handlers.append(urllib.request.HTTPDigestAuthHandler(mgr))
    opener = urllib.request.build_opener(*handlers)
    try:
        with opener.open(req, timeout=8) as res:
            return ET.fromstring(res.read(MAX_REPLY))
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise AddError("The camera didn't accept that username or password") from None
        body = e.read(MAX_REPLY)
        if re.search(rb"NotAuthorized|not authorized|Sender not Authorized", body, re.I):
            raise AddError("The camera didn't accept that username or password") from None
        raise AddError(f"The camera replied with an error ({e.code})") from None
    except (urllib.error.URLError, socket.timeout, OSError):
        raise AddError("Couldn't reach the camera — is it switched on and on the same Wi-Fi as the camera computer?") from None
    except ET.ParseError:
        raise AddError("The camera sent a reply Kyro doesn't understand") from None


def _clock_offset(xaddr: str) -> float:
    """Seconds the camera's clock is ahead of ours (its login check uses the time)."""
    try:
        root = _post(xaddr, _envelope('<GetSystemDateAndTime xmlns="http://www.onvif.org/ver10/device/wsdl"/>'))
        utc = next(iter(_find_all(root, "UTCDateTime")), None)
        if utc is None:
            return 0.0
        g = lambda n: int(_text(next(iter(_find_all(utc, n)))))
        cam = dt.datetime(g("Year"), g("Month"), g("Day"), g("Hour"), g("Minute"), g("Second"), tzinfo=dt.timezone.utc)
        return (cam - dt.datetime.now(dt.timezone.utc)).total_seconds()
    except Exception:  # noqa: BLE001 — optional
        return 0.0


def stream_address(xaddr: str, user: str, password: str) -> str:
    """The camera's video address (rtsp://user:password@…), asked from the camera with its own login."""
    if not _local(urlsplit(xaddr).hostname or ""):
        raise AddError("That camera isn't on the church network")
    off = _clock_offset(xaddr)
    call = lambda url, body: _post(url, _envelope(body, user, password, off), user, password)
    # Where the camera's video settings live.
    media = xaddr
    try:
        caps = call(xaddr, '<GetCapabilities xmlns="http://www.onvif.org/ver10/device/wsdl"><Category>Media</Category></GetCapabilities>')
        m = next(iter(_find_all(caps, "Media")), None)
        x = _text(next(iter(_find_all(m, "XAddr")), None)) if m is not None else ""
        if x and _local(urlsplit(x).hostname or ""):
            media = x
    except AddError as e:
        if "username or password" in str(e):
            raise
    profiles = call(media, '<GetProfiles xmlns="http://www.onvif.org/ver10/media/wsdl"/>')
    tokens = [p.get("token") for p in _find_all(profiles, "Profiles") if p.get("token")]
    if not tokens:
        raise AddError("The camera didn't offer a video stream")
    # The first profile is the camera's main (sharpest) stream.
    res = call(media, '<GetStreamUri xmlns="http://www.onvif.org/ver10/media/wsdl">'
                      '<StreamSetup><Stream xmlns="http://www.onvif.org/ver10/schema">RTP-Unicast</Stream>'
                      '<Transport xmlns="http://www.onvif.org/ver10/schema"><Protocol>RTSP</Protocol></Transport></StreamSetup>'
                      f'<ProfileToken>{_xml(tokens[0])}</ProfileToken></GetStreamUri>')
    uri = _text(next(iter(_find_all(res, "Uri")), None))
    parts = urlsplit(uri)
    if parts.scheme not in ("rtsp", "rtsps") or not parts.hostname:
        raise AddError("The camera didn't give a usable video address")
    host = parts.hostname if _local(parts.hostname) else urlsplit(xaddr).hostname
    netloc = f"{quote(user, safe='')}:{quote(password, safe='')}@{host}" + (f":{parts.port}" if parts.port else "")
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, ""))


def check_picture(url: str) -> None:
    """Open the video once to make sure it really shows a picture."""
    import cv2
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG, [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 10000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 10000])
    try:
        ok = cap.isOpened() and cap.read()[0]
    finally:
        cap.release()
    if not ok:
        raise AddError("Kyro found the camera's video address but couldn't get a picture from it")
