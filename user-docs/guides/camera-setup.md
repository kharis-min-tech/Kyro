# Getting the best count from your cameras

Kyro's AI finds people very reliably when it can see them. The camera's
position is now the biggest thing that decides whether **everyone** is counted.

## How good is the AI?

Tested on crowded scenes where every person had been counted by hand, with a
camera covering a whole hall:

| | Before (Oct 2026) | Now |
|---|---|---|
| People found | 28% | **84%** |
| People far from the camera | under 1% | **69%** |
| People near the camera | 68% | **94%** |
| Headcount off by (per ~40 people) | 28 | **4** |

Most of the people it still misses are hidden behind someone else, or so far
away they're only a few pixels tall. Better camera placement fixes most of these.

## Place cameras so everyone's head is visible

- **Mount high, angled down** (about 30–45°). From head height, the front rows
  hide everyone behind them. From above the stage, looking down the rows,
  every head is visible.
- **Cover big rooms with more than one camera.** One camera per section
  (front, back, balcony) means nobody is tiny in the picture. Give each
  camera its own zone on the [Cameras](/pages/cameras) page so people aren't
  counted twice.
- **Use 1080p or higher.** Kyro now uses the camera's full detail. A 4K camera
  sees the back rows much better than a 720p one.
- **Light the room evenly.** Avoid pointing a camera at bright windows or
  stage lights, which turn people into silhouettes.
- **Overflow rooms and side rooms:** use a camera, or count them on
  [Manual Count](/pages/manual-count).

## Check a camera

Whoever looks after the Kyro computer can run the camera check during a
service:

```bash
python -m ai.check_camera --stream rtsp://user:pass@camera/stream1
```

It saves a picture with a numbered box on every person Kyro finds. **Green** =
sure, **amber** = less sure. Anyone without a box is someone that camera can't
see well enough. Raise or re-angle it, add light, or add a camera for that area.

::: tip Spot-check against a manual count
For the first few services, have an usher count one section by hand and
compare it with Kyro's number for that camera. If they're close, the camera
is placed well.
:::
