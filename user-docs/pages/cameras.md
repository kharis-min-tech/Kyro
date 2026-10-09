# Cameras

The Cameras page is where you add the cameras Kyro watches, and name the room (zone) each one covers.

::: info Admins only
Only **administrators** can add, change or remove cameras. Everyone else sees the list read-only.
:::

<Shot name="cameras" alt="Cameras page listing registered cameras with their zone, stream address and seat capacity, and the Add a camera section" />

## In Live mode: cameras add themselves

In **Live** mode you don't add USB cameras by hand. A camera appears here by itself, within a few seconds, when it's counting:

- with [Camera Mode](/pages/camera-mode) on any computer, or
- plugged into a **camera computer** that has the installed version (see [Setting up cameras](/guides/camera-setup)).

For each camera, an administrator can:

- tap the **pencil** to set its **name**, the **room** (zone) it covers and the room's **seat count**. Set the seat count so **Seats left** and the **filling up** phone alerts work.
- tap **Switch off** to stop counting a camera you don't want (for example a laptop's built-in camera). Switched-off cameras are listed under **Switched off**, with **Switch back on**.

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
