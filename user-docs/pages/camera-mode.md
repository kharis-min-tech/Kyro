# Camera Mode

Camera Mode counts people with a camera plugged into **any computer**, right in the web page. There's nothing to install. Plug the camera in, open the page, press **Start counting**.

<Shot name="camera-mode" alt="Camera Mode counting: 'Counting', the number of people now, and the camera picture with a box around each person counted" />

::: tip Watch it
See Camera Mode in action in the [video tour](/getting-started/video-tour), from **1:41**.
:::

::: info Who can use it
**Administrators** and **operators**. In **Live** mode the count goes to everyone's dashboard. In **Demo** mode it only shows on that computer, so you can try it out safely.
:::

## Start counting

1. Plug your camera (or cameras) into the computer. A USB webcam is fine.
2. On that computer, open **kyro.kharischurch.com** in **Chrome** or **Edge** and sign in.
3. Open **Camera Mode** in the menu.
4. Press **Start counting**. When the browser asks to use the camera, click **Allow**.

<Shot name="camera-mode-start" alt="Camera Mode before starting: three steps and the Start counting button" />

The first time, Kyro downloads its AI (about 40 MB), which takes a minute. After that it starts in a few seconds.

Kyro now:

- draws a box around every person it counts (**green** = sure, **amber** = less sure)
- shows **people now** at the top, and the count on each camera's picture
- sends the count to your dashboard every 5 seconds (Live mode), so it appears on [AI Count](/pages/ai-count), [Live Cameras](/pages/live-cameras), the [Seat Map](/pages/seat-map), [Sessions](/pages/sessions) and [Analytics](/pages/analytics) for everyone

::: tip Start by itself
Tick **Start counting by itself whenever this page is opened on this computer**. Next Sunday you only need to open the page.
:::

## More than one camera

Plug in as many cameras as the computer takes. Each one appears on the page within a few seconds and gets its own picture and count. To stop counting one camera (for example a laptop's built-in camera), untick **Count** under its picture.

Each camera shows up on the [Cameras](/pages/cameras) page by itself. There, an administrator can give it a **name**, the **room** it covers and the room's **seat count**. Set the seat count so **Seats left** works and phones get **filling up** alerts.

## While it's counting

- **Keep the page open and on screen.** If you switch to another tab or minimise the window, the browser slows the counting down, and Kyro shows a warning.
- **Keep the computer plugged in.** Kyro keeps the screen from going to sleep while it counts.
- Press **Stop** to stop counting and turn the cameras off.

If the browser says it wasn't allowed to use the camera, click the **camera icon** in the address bar, choose **Allow**, then press **Start counting** again.

## How accurate is it?

Camera Mode uses the same kind of AI as the installed version, and always the newest one, because it comes with the website.

- **A computer with decent graphics** uses Kyro's most accurate AI. On test pictures of crowded halls it found about the same number of people as the installed version.
- **A computer with weak graphics** switches to a lighter AI by itself. The page says so. It still counts well, but finds fewer people far from the camera.

For the best count, see [Getting the best count from your cameras](/guides/camera-setup#getting-the-best-count-from-your-cameras).

## Want the installed version?

At the bottom of the page, **Want the installed version?** gives you one line to paste into the computer's terminal. The installed version:

- counts without a web page being open
- starts by itself when the computer turns on
- installs every new AI update by itself, between services

<Shot name="camera-mode-install" alt="Want the installed version? section with Windows and Mac / Linux tabs, the command with a Copy button, and a pairing code" />

1. Pick **Windows** or **Mac / Linux**.
2. Press **Copy**.
3. **Windows:** click Start, type **PowerShell** and open it. **Mac:** press Cmd + Space, type **Terminal** and open it.
4. Paste the line and press Enter.
5. When it asks for a **pairing code**, press **Get a pairing code** on the page (administrators) and type the code it shows.
6. Wait for **All done!** The first time takes 10–20 minutes. The computer then shows as **Online** on the [Cameras](/pages/cameras) page.

Running the command again later is safe: it just brings everything up to date. See [Setting up cameras](/guides/camera-setup) for more.

## On a phone

Camera Mode works on a phone or tablet too, using its camera, but a computer with a USB camera mounted high up gives a much better view of the room.

<Shot name="phone-camera-mode" alt="Camera Mode on a phone" />
