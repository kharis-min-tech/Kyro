import sys, numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

MODELS = sys.argv[1]; OUT = sys.argv[2]; TOTAL = float(sys.argv[3])
VOICE = sys.argv[4] if len(sys.argv) > 4 else "af_heart"
k = Kokoro(f"{MODELS}/kokoro-v1.0.onnx", f"{MODELS}/voices-v1.0.bin")

# (start seconds, next step starts at, line) — timed to the captions in the video
SCRIPT = [
    (0.6,   4.4,  "Welcome to Kyro. Here's a quick tour."),
    (4.6,   8.9,  "If you get stuck, tap Help. It works, even before you sign in."),
    (9.1,  14.4,  "Choose Demo mode to explore with sample data, then pick the admin account."),
    (14.8, 26.4,  "Kyro opens on AI Count. When the AI isn't sure about something, it asks you. Just tap the answer, and it learns."),
    (26.8, 37.4,  "AI Count shows how many people are in the building right now. You can switch the chart to occupancy, entries, or exits."),
    (37.8, 60.8,  "Arrival and exit times show when people arrive and leave the most. Blue bars are arrivals, and orange bars are people leaving. Tap Table, to see every time slot as a list."),
    (61.2, 75.8,  "Ushers count rooms without a camera, on Manual Count. Type the room, add the number with the quick buttons, then review and save."),
    (76.1, 79.4,  "At the end of service, approve the final count."),
    (79.8, 95.3,  "Live Cameras shows every room at a glance: how full it is, and how many seats are left. The outside queue tells you if the people waiting will fit. Tap any camera, to see it bigger."),
    (95.8, 105.8, "On the Seat Map, red seats are taken, and dark seats are free. Tap a free seat, to reserve it for a guest."),
    (106.3,121.8, "Turn on notifications once, and alerts reach your phone, even when it's locked. Then choose when Kyro should alert you."),
    (122.3,137.2, "Need help? Help guide, in the menu, opens the right page of the guide, with every step explained in pictures."),
    (137.8,TOTAL, "You're ready. Start in Demo mode, then sign in to Live for the real thing."),
]

SR = 24000
track = np.zeros(int(TOTAL * SR) + SR, dtype=np.float32)
for start, nxt, text in SCRIPT:
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
    print(f"{start:6.1f}s  {dur:4.1f}s of {budget:4.1f}s  speed {speed}{flag}  | {text[:50]}")

peak = np.abs(track).max()
track = track / peak * 0.85 if peak > 0 else track
sf.write(OUT, track[: int(TOTAL * SR)], SR)
print("wrote", OUT)
