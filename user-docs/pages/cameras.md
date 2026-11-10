# Cameras

The Cameras page is where you add the cameras Kyro watches, and name the room (zone) each one covers.

::: info Admins only
Only **administrators** can add, change or remove cameras. Everyone else sees the list read-only.
:::

<Shot name="cameras" alt="Cameras page listing registered cameras with their zone, stream address and seat capacity, and the Add a camera section" />

## Counting on this computer

At the top of the Cameras page, **Counting on this computer** turns the counting on and off.

1. Plug your camera into this computer — straight in, or a wireless transmitter's receiver through an HDMI-to-USB capture card.
2. Press **Start counting** and allow the browser to use the camera.

It shows the number of people and how often a new count arrives. **Move around Kyro freely — counting carries on.** It only stops if you close the Kyro tab on that computer, so leave one open and stop the computer sleeping during a service. Use Chrome or Edge.

For counting that runs with nothing open at all, and that also gives **in and out** numbers, install the counter on that computer — see [Setting up cameras](/guides/camera-setup).

## In Live mode: cameras add themselves

In **Live** mode you don't add USB cameras by hand. A camera appears here by itself, within a few seconds, when it's counting:

- switched on from this page (**Counting on this computer**) on any computer, or
- plugged into a **camera computer** that has the installed version (see [Setting up cameras](/guides/camera-setup)).

For each camera, an administrator can:

- tap the **pencil** to set its **name**, the **room** (zone) it covers and the room's **seat count**. Set the seat count so **Seats left** and the **filling up** phone alerts work.
- tap **Switch off** to stop counting a camera you don't want. (A computer's own built-in camera is never used, so it never appears here.) Switched-off cameras are listed under **Switched off**, with **Switch back on**.

### Adding a camera plugged into this computer

**Add a camera → Plugged into this device → Scan.** Kyro lists every camera it can see on that computer, with anything plugged in since you opened the page marked *just plugged in*. Tap **Preview** to check it's the right one, then **Count with this**.

That's the whole thing. Counting switches on, the camera appears in the list above within a few seconds with its own name, and you give it a proper name and a room with the **pencil**.

::: tip There is no stream address
A camera plugged into a computer by USB — a webcam, a capture card, an action camera — hasn't got a stream address, and Kyro doesn't ask for one. Stream addresses are only for cameras on the network, which don't plug into anything.
:::

If a camera doesn't appear in the scan, open **My camera isn't in this list** under the results. The list Kyro shows is every camera the browser will admit to, so a camera that's missing is missing from the computer, not from Kyro.

::: warning Action cameras and dash cams: storage mode
Plugging one in usually puts it into **storage mode**, where it offers its memory card and nothing else — no computer sees a camera. On the camera's own screen choose **PC Camera**, **Webcam**, **UVC** or **USB Camera**. Some ask the moment you plug the cable in and give up after a few seconds; some want it set in the menu before you plug it in at all.
:::

Then, in order: plug it straight into the computer rather than through a hub or dock; try a different socket and a different **cable** (a charging-only cable carries no picture and looks identical); close anything else that might be holding it (Zoom, Teams, FaceTime, Photo Booth, OBS, another browser tab); switch the camera on before plugging it in if it has its own power switch; then tap **Scan again**.

Still nothing? Open your computer's own camera app — **Photo Booth** on a Mac, **Camera** on Windows — and see whether that lists it. If it doesn't, the computer isn't seeing the camera either, and nothing Kyro does will change that.

### Wi-Fi cameras: Find cameras

For Wi-Fi security cameras, press **Find cameras** (under **Wi-Fi cameras**). The camera computer at church lists the cameras on its Wi-Fi; click **Add** next to one and type the camera's own username and password. See [Wi-Fi security cameras](/guides/camera-setup#with-wi-fi-security-cameras-best-for-several-cameras) for the full steps.

### Do several cameras work together?

**Yes — they share one register.** One entry per human being, whichever camera sees them. Somebody who walks from one camera to another keeps the same identity and is counted once, not twice.

Three things join a person up across cameras, strongest first:

1. **Their face**, when face matching is on and a face was readable. Strongest by far, and the only one that works across a crowded hall.
2. **What they look like** — the colour of what they're wearing, their build and height. Weak on its own, and weakest in exactly this case: two cameras see the same person from two angles, at two distances, in two patches of light.
3. **Who else is in the room.** If a camera that can see the same place has exactly one person in view that this camera hasn't accounted for, that's almost certainly who this is. It only applies in a quiet room — with a crowd, "the only one" stops meaning anything, so Kyro doesn't use it.

::: warning Kyro has to know which cameras see the same place
Two cameras **plugged into the same computer** are treated as one place automatically — a USB cable is two metres long.

For anything else, **give them the same room name** (the pencil on this page). Cameras sharing a room name are two views of one room: Kyro takes the fullest view instead of adding them up. Cameras with *different* room names are different rooms and **their counts are added together** — right for a balcony and a main floor, wrong for two cameras pointed at the same hall.

A camera that adds itself is named after itself, so it starts out as its own room. That's the first thing to set.
:::

To see whether it's working, open **AI Count** → **How the counting is doing**. It shows how many cameras are feeding the register, how many people have been recognised on more than one of them, and how each match was made.

### Face matching

Face matching answers one question Kyro cannot otherwise answer: is the person who just walked in somebody already counted? Without it, an usher holding the door all morning is counted every time they step through, and a choir in matching robes cannot be told apart at all.

It is **off** until an administrator switches it on (Cameras page → **Face matching** → **Switch on…**), confirming that the church has completed a **DPIA** for face matching and has **notices up at every entrance**. Kyro records who confirmed that and when.

Even then it only runs **during a service** (Kyro records services by itself — see [Sessions](/pages/sessions)).

**What Kyro keeps.** No photographs. Each clearly visible face becomes a list of 128 numbers. Kyro does not know who anybody is and never compares a face against any list of people.

Those numbers are kept for **the length of one service**, so that people are still recognised if the system restarts mid-service — they used to be held in memory only, and every restart lost them, which meant people already counted were counted again. They are deleted when the service ends, when a different service starts, the moment face matching is switched off, when the authorisation is withdrawn or expires, and **within twelve hours whatever else happens**.

[What Kyro does with face data →](/pages/data-protection)

How well it works (measured on 6,000 standard face-photo pairs): when Kyro says two faces are the same person it was right every time, so it doesn't wrongly merge different people. It only works for faces turned towards a camera and big enough in the picture (about 30 pixels wide or more), so cameras facing the congregation from the front help most; cameras behind people mostly see the backs of heads.

### Don't count an area (statues, mannequins)

The AI sometimes takes a **statue, sculpture or mannequin** for a person. Kyro already double-checks every person it counts with a second AI that tells people from statues (on the installed version), but for a statue your camera always sees, mark it once:

1. On the camera, tap **Don't count an area**. Its live picture opens.
2. **Drag a box** tightly around the statue. Draw more boxes if needed (up to 10).
3. Tap **Save**.

Nothing that lies mostly inside a box is counted, by the installed version or by Camera Mode. Someone walking in front of the statue only partly overlaps the box, so they're still counted. But someone standing **inside** the box wouldn't be, so keep boxes tight, and don't draw them over seats. To undo, open it again and tap **Remove area**.

**Camera computers** lists every computer that counts for you, with a green dot when it's **Online**, its version and when it was last seen. **Pair a camera computer** gives the code the installer asks for.

**Add a network camera** is for Wi-Fi or network cameras, which don't plug into a computer. Paste the camera's stream address (it starts with `rtsp://`; the camera's app or manual shows it). A camera computer with the installed version then connects to it.

::: info The steps below
The rest of this page describes Demo mode, and Kyro set up with its own server.
:::

## Add a camera

1. Open **Add a camera**.
2. Under **What type of camera?**, choose **IP / Network Camera**, **USB Webcam** or **Other**. Kyro fills in an example stream address for that type.
3. Fill in:
   - **Camera name**, for example *Main Auditorium*
   - **Zone / area name**: the room it covers, for example *Main Floor* or *Balcony*
   - **Stream address**: where Kyro reads the picture from (see below)
   - **Seat capacity** (optional): the number of seats in the room
4. Tap **Add camera**.

If the name sounds like it's outside (*Entrance*, *Foyer*, *Car park*, *Queue*…), Kyro asks **"Is this an outdoor or queue camera?"** Answer **Yes, it's an outdoor/queue camera** for a camera that counts people waiting, or **No, it has seats**.

::: warning Kyro's seat guess is not your seat count
When a camera is counting, Kyro's seat finder looks at the picture and works out roughly how many seat-shaped things it can see. **That is a guess, and it is shown as one** — `~21?` in the Capacity column, and *"Kyro thinks it can see about 21 seats"* on the camera tile.

Until an administrator sets the real number, **nothing is worked out from it**: no *spaces left*, no *% full*, no *capacity utilisation*, and **no filling-up or overcrowding alert**. A guess that can't be told from a measurement is worse than no guess, because everything built on it inherits the confidence without the doubt — and the thing at the end of that chain is a phone alert telling a steward a room is nearly full.

Set the real seat count with the **pencil** on this page and all of those start working for that room.
:::

::: tip Seat capacity sets up the seat map
When you give an indoor camera a seat capacity, Kyro creates a starter seat layout of that size, so the [Seat Map](/pages/seat-map) works straight away. You can draw the real layout later in the [Seat Editor](/pages/seat-editor).
:::

## Finding the stream address

Only network cameras have one. Open **How do I find my camera's stream address?** on the Add a camera form for the full steps.

- **IP / network camera:** open the camera's own app, or its web page (the address on its sticker, typed into a browser on the same Wi-Fi) → **Settings → Network → RTSP**, and copy what it shows. It looks like `rtsp://192.168.1.64:554/stream1`. If the camera wants a username and password they go in front: `rtsp://user:pass@192.168.1.64:554/stream1`.
- **Can't find it?** For most Wi-Fi cameras you don't need to — use **Find cameras** instead (above), and just type the camera's username and password.
- **USB webcam:** there isn't one. Use **Plugged into this device**.

## Edit or delete a camera

- **Edit:** tap a **pencil** icon to change the name, zone, stream address, type (**Indoor (has seats)** or **Outdoor / queue (no seats)**) or seat capacity, then **Save**.
- **Delete:** tap the **bin**, then **Yes, delete it**. This can't be undone.

::: tip Where to put cameras
Camera placement decides whether everyone gets counted. See [Getting the best count from your cameras](/guides/camera-setup).
:::

## Start the camera

Adding a camera tells Kyro about it. The camera starts counting once the Kyro software is running for it on the church's Kyro computer. Tap **Start worker** on a camera to see the command, and give it to whoever looks after that computer.

::: info Outdoor / queue cameras
An outdoor camera counts people waiting, not seats. Its count appears as **OUTSIDE QUEUE** on [Live Cameras](/pages/live-cameras), and it's left out of the seat totals.
:::
