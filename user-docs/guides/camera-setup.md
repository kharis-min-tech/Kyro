# Setting up cameras

::: tip Any computer works
A camera has to plug into a computer that runs Kyro, but it can be **any** computer: yours, the church's, a Windows PC, a Mac or Linux. You can move the camera between computers whenever you like. Kyro recognises it and it keeps its **name, room, seat count and history**. Each computer only needs Kyro set up once (below).
:::

For every Sunday, [install Kyro on the camera computer](#install-kyro-on-the-camera-computer-one-time-about-20-minutes): it counts by itself with no page open. Camera Mode is for emergencies and quick tests.

## In an emergency: Camera Mode (nothing to install)

Full details, with pictures: [Camera Mode](/pages/camera-mode).

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
  AI, about as accurate as the installed version. On a computer with weak
  graphics it switches to a lighter AI by itself, which finds fewer people at
  the back.

## Install Kyro on the camera computer (one time, about 20 minutes)

This is the everyday way: no web page needs to be open, and it
also runs when nobody is signed in. The command is also on the
[Camera Mode](/pages/camera-mode#want-the-installed-version) page, with a
**Copy** button.

Cameras plug into a **camera computer** at church: any Windows PC, Mac or
Linux computer that stays on during services. That computer runs the Kyro
Camera Box program. It finds the cameras, counts people with Kyro's AI and
sends the counts to the website.

**1. Get a pairing code.** On the website, go to [Cameras](/pages/cameras) and
press **Pair a camera computer**. The code works for 30 minutes. The page also shows the
install line **with the code already in it**: press **Copy** there and you won't
need to type the code at all.

**2. Run the installer on the camera computer.** (These lines don't include a code, so the installer asks for one.)

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

**3. Plug in your cameras.** Within a few seconds Kyro pops up on the website:
*"We see you've connected … Do you want it on Kyro?"* Click **Yes, add it** and it
starts counting and showing live. (Kyro never opens a camera until you say yes.)
Then, on the Cameras page, give it a name, a room and the room's seat count.

### After that, nothing to do

- **Move cameras freely:** plug a camera into another computer that has Kyro and it
  keeps its name, room, seat count and history.
- **Plug and play:** plug a USB camera in, click **Yes** when Kyro asks, and it's counted. Unplug it and it
  shows as offline. The computer's own built-in camera (like a MacBook's FaceTime camera), phones
  and virtual cameras are never used. Only cameras you plug in are. To stop
  counting a plugged-in camera, press **Switch off** on the Cameras page.
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

## Wireless: a camera far from the computer

### With a wireless video transmitter

A wireless HDMI video transmitter sends the camera's picture across the hall with no cable:

```
[camera] ─HDMI─ [transmitter] ~~~ wireless ~~~ [receiver] ─HDMI─ [HDMI-to-USB capture card] ─USB─ [camera computer]
```

1. Connect the camera's **HDMI out** to the **transmitter** (the camera needs an HDMI port, usually micro-HDMI, and must be in video mode so it shows the live picture).
2. At the camera computer, connect the **receiver** to an **HDMI-to-USB capture card**, and the capture card to the computer's USB port. Some receivers have a **USB-C output** that works as a webcam: then you don't need a capture card.
3. Kyro sees the capture card as a plugged-in camera and asks *"We see you've connected … Do you want it on Kyro?"* Click **Yes, add it**.

If the camera or transmitter is switched off or goes out of range, the receiver shows a blank or "no signal" screen. Kyro notices, shows **Needs attention: No picture** on the Cameras page and doesn't count it as 0 people.

::: tip Tips
- Turn off the camera's on-screen display (battery, time, recording icons) if it has the option, so only the room is shown.
- Keep the transmitter and receiver in sight of each other. Walls and crowds shorten the range.
- Power the camera and transmitter from the mains or a power bank. Batteries rarely last a whole service.
:::

### With the camera computer next to the camera

Put the small camera computer beside the camera (short USB cable) and let **the computer** connect to the church **Wi-Fi**. Only a power plug is needed. If the Wi-Fi is weak, the live video sends smaller pictures instead of freezing. The counting itself happens on the computer, so it isn't affected.

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

**Not counting objects (October 2026 check).** Kyro was tested on 410 pictures
where every person had been outlined by hand, including 80 rooms with no people
but plenty of chairs, sofas, screens and bags. Changes made after that check:

- One person is no longer counted twice (a box for their whole body *and* one
  for their top half, hands or arm): those extra boxes fell by about half.
- Objects counted as people fell by about 40%. In the 80 empty rooms, Kyro
  wrongly counted something in 4–5. The clear mistakes left were **statues and
  sculptures**, which look like people to the AI. The installed version now
  double-checks each person with a second AI that tells people from statues,
  and for a statue your camera always sees you can
  [mark an area not to count](/pages/cameras#don-t-count-an-area-statues-mannequins).
- A person who moves around is counted from the very first picture, and once.

What the number means: **people the camera can see right now**, steadied over
the last few pictures. Someone completely hidden (behind a pillar) drops out
while hidden and comes back when visible. Cameras should cover separate areas:
two cameras seeing the same people count them twice.

### Place cameras so everyone's head is visible

- **Mount high, angled down** (about 30–45°). From head height, the front rows
  hide everyone behind them. From above the stage, looking down the rows,
  every head is visible.
- **Cover big rooms with more than one camera.** One camera per section
  (front, back, balcony) means nobody is tiny in the picture. Testing showed
  this matters more than anything else: people at least about a twelfth of the
  picture's height are found about 9 times in 10, people only a few
  pixels tall about 6 times in 10. Cameras must **not overlap**: Kyro adds
  cameras together and doesn't recognise the same person in two cameras, so
  give each camera its own section and its own zone on the
  [Cameras](/pages/cameras) page.
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
