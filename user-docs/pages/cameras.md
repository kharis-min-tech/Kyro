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

### Wi-Fi cameras: Find cameras

For Wi-Fi security cameras, press **Find cameras** (under **Wi-Fi cameras**). The camera computer at church lists the cameras on its Wi-Fi; click **Add** next to one and type the camera's own username and password. See [Wi-Fi security cameras](/guides/camera-setup#with-wi-fi-security-cameras-best-for-several-cameras) for the full steps.

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

::: tip Seat capacity sets up the seat map
When you give an indoor camera a seat capacity, Kyro creates a starter seat layout of that size, so the [Seat Map](/pages/seat-map) works straight away. You can draw the real layout later in the [Seat Editor](/pages/seat-editor).
:::

## Finding the stream address

Open **How do I find my camera's stream address?** on the page for help.

- **IP / network camera:** open the camera's own app → Settings → Network, and copy the **RTSP** address.
- **USB webcam:** enter **0** for the first webcam plugged into the Kyro computer, **1** for a second one.

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
