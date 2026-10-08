# Setting up cameras

## Easiest: Camera Mode (nothing to install)

1. Plug your camera(s) into any computer at church (Windows, Mac or Chromebook).
2. On that computer, open **kyro.kharischurch.com** in **Chrome** or **Edge**, sign in, and open **Camera Mode** in the menu.
3. Press **Start counting** and click **Allow** when the browser asks to use the camera.

That's it. The count appears on **AI Count** and **Live Cameras** for everyone.
Tick **Start counting by itself whenever this page is opened**, and next time
you only need to open the page.

- **Always the newest AI.** It comes with the website, so there's nothing to update.
- **Plug in more cameras any time.** Each one is picked up within a few seconds.
- **Keep the page open and on screen** during the service, and keep the computer plugged in.
- **Accuracy:** on a computer with decent graphics it uses Kyro's most accurate
  AI (in tests it found 83% of people in crowded whole-hall shots, about the
  same as the installed version). On a computer with weak graphics it switches
  to a lighter AI by itself, which finds fewer people at the back.

## Or: install Kyro on the camera computer (one time, about 20 minutes)

Choose this if you'd rather not keep a web page open. The installed version
also runs when nobody is signed in.

Cameras plug into a **camera computer** at church: any Windows PC, Mac or
Linux computer that stays on during services. That computer runs the Kyro
Camera Box program. It finds the cameras, counts people with Kyro's AI and
sends the counts to the website.

**1. Get a pairing code.** On the website, go to [Cameras](/pages/cameras) and
press **Pair a camera computer**. Keep the code on screen (it works for 30 minutes).

**2. Run the installer on the camera computer.**

- **Windows:** open **PowerShell** (search for it in the Start menu), paste this
  line and press Enter:

  ```powershell
  powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/kharis-min-tech/Kyro/main/camera-box/install/install-windows.ps1 | iex"
  ```

- **Mac or Linux:** open **Terminal**, paste this line and press Enter:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/kharis-min-tech/Kyro/main/camera-box/install/install.sh | bash
  ```

The first install downloads Python and the AI, which takes 10–20 minutes.
When it asks, **type the pairing code** from step 1.

**3. Plug in your cameras.** That's it. Each USB camera appears on the Cameras
page within a few seconds. Give it a name, a room and the room's seat count.

### After that, nothing to do

- **Plug and play:** plug a USB camera in and it's counted. Unplug it and it
  shows as offline. If you don't want a camera counted (for example a laptop's
  built-in camera), press **Switch off** on the Cameras page.
- **Starts by itself** whenever the computer turns on, and restarts itself if
  anything goes wrong.
- **Updates itself.** When Kyro's AI is improved, the camera computer
  downloads the new version by itself. It only does this when the
  cameras haven't seen anyone for 15 minutes, so a service is never
  interrupted. If an update ever fails to start, it goes back to the
  previous version on its own.

::: tip Network (Wi-Fi or ethernet) cameras
These don't plug into the computer, so the website needs their address. On
the Cameras page, open **Add a network camera** and paste the camera's
stream address (it starts with `rtsp://`; the camera's app or manual shows
it). The camera computer connects to it within a few seconds.
:::

::: warning Keep the camera computer on
Plug it into power and leave it on. On Windows, set it to sign in
automatically after a restart, so Kyro can start. The installer already stops
the computer going to sleep while it's plugged in.
:::

### How fast does it count?

A computer with an **NVIDIA graphics card** counts several times a second with
Kyro's most accurate settings. A **Mac with an Apple chip (M1 or newer)** is
quick too. An ordinary PC without a graphics card still counts, but each
count takes a few seconds. That's fine for a seated congregation.

## Getting the best count from your cameras

Kyro's AI finds people very reliably when it can see them. The camera's
position is now the biggest thing that decides whether **everyone** is counted.

### How good is the AI?

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

### Place cameras so everyone's head is visible

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

### Check a camera

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
