"""Voice-over for the video tour (Kokoro TTS, soft "af_heart" voice).

    python narrate-tour.py <kokoro model dir> <out.wav> <timeline.json> [voice]

timeline.json comes from record-tour.mjs: when each narrated part starts,
in seconds. Each line is spoken at its part's start and must finish before
the next part (it's sped up a little if needed).
"""
import json, sys
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

MODELS, OUT, TIMELINE = sys.argv[1], sys.argv[2], sys.argv[3]
VOICE = sys.argv[4] if len(sys.argv) > 4 else "af_heart"
k = Kokoro(f"{MODELS}/kokoro-v1.0.onnx", f"{MODELS}/voices-v1.0.bin")

LINES = {
    "intro":                "Welcome to Kyro. Here's a quick tour.",
    "help":                 "If you get stuck, tap Help. It works, even before you sign in.",
    "signin":               "Choose Demo mode to explore with sample data, then pick the admin account.",
    "ai_question":          "Kyro opens on AI Count. When the AI isn't sure about something, it asks you. Just tap the answer, and it learns.",
    "ai_count":             "AI Count shows how many people are in the building right now. You can switch the chart to occupancy, entries, or exits.",
    "arrivals":             "Arrival and exit times show when people arrive and leave the most. Blue bars are arrivals, and orange bars are people leaving. Tap Table, to see every time slot as a list.",
    "manual":               "Ushers count rooms without a camera, on Manual Count. Type the room, add the number with the quick buttons, then review and save.",
    "approve":              "At the end of service, approve the final count.",
    "live_cameras":         "Live Cameras shows every room at a glance: how full it is, and how many seats are left. The outside queue tells you if the people waiting will fit. Tap any camera, to see it bigger.",
    "camera_mode":          "To count with a camera, plug it into any computer, and open Camera Mode. There's nothing to install. Press Start counting, and allow the camera.",
    "camera_mode_counting": "Kyro draws a box around everyone it counts, and sends the number to your dashboard, for the whole team to see.",
    "camera_mode_install":  "Want it to run without a page open? Copy this one line, into the computer's terminal, and Kyro installs itself, and keeps itself up to date.",
    "seat_map":             "On the Seat Map, red seats are taken, and dark seats are free. Tap a free seat, to reserve it for a guest.",
    "notifications":        "Turn on notifications once, and alerts reach your phone, even when it's locked. Then choose when Kyro should alert you.",
    "help_guide":           "Need help? Help guide, in the menu, opens the right page of the guide, with every step explained in pictures.",
    "end":                  "You're ready. Start in Demo mode, then sign in to Live for the real thing.",
}

timeline = json.load(open(TIMELINE))
marks = {m["id"]: m["t"] for m in timeline}
TOTAL = marks["finish"]
order = [m for m in timeline if m["id"] in LINES]

SR = 24000
track = np.zeros(int(TOTAL * SR) + SR, dtype=np.float32)
for n, m in enumerate(order):
    text = LINES[m["id"]]
    start = m["t"] + 0.4
    nxt = order[n + 1]["t"] if n + 1 < len(order) else TOTAL
    budget = nxt - start - 0.15
    speed = 0.95
    while True:
        samples, sr = k.create(text, voice=VOICE, speed=speed, lang="en-us")
        dur = len(samples) / sr
        if dur <= budget or speed >= 1.2:
            break
        speed = round(speed + 0.05, 2)
    assert sr == SR
    # gentle 40 ms fade in/out so lines never click
    f = int(0.04 * sr)
    samples = samples.astype(np.float32)
    samples[:f] *= np.linspace(0, 1, f); samples[-f:] *= np.linspace(1, 0, f)
    i = int(start * sr)
    track[i:i + len(samples)] += samples[: len(track) - i]
    flag = "" if dur <= budget else "  <-- runs over"
    print(f"{start:6.1f}s  {dur:4.1f}s of {budget:4.1f}s  speed {speed}{flag}  | {m['id']}")

peak = np.abs(track).max()
track = track / peak * 0.85 if peak > 0 else track
sf.write(OUT, track[: int(TOTAL * SR)], SR)
print("wrote", OUT)
