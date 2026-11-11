# Troubleshooting & FAQ

## Signing in

**It keeps asking me to choose Demo or Live.**
In Demo mode, a sign-in lasts only while that tab is open. In Live mode you stay signed in on that device for up to 12 hours.

**"Too many failed sign-ins".**
After 10 wrong passwords from one device, Kyro pauses sign-in from that device for 15 minutes. Wait, then try again, or ask an administrator to set a new password.

**I was signed out suddenly.**
An administrator may have removed your account, or your 12-hour sign-in ran out. Sign in again.

**I can't see a page my colleague can see, or a link sends me back.**
Each person can only open the pages they've been given. Ask an administrator to tick the page for you on [Users](/pages/users).

**I can't approve the final count.**
Only admins and operators can approve. Ask one of them, or ask an administrator to change your access.

**How do I switch between Demo and Live?**
Tap **Sign out** at the bottom of the sidebar and choose the other mode.

## Counts

**My manual count isn't in the total.**
It's still a draft. Tap **Approve final count** on [Manual Count](/pages/manual-count).

**I entered a count twice and the total didn't go up.**
That's on purpose. There's one count per room per service, so a second count for the same room replaces the first.

**The total looks too high.**
Check whether a manual count was entered for a room a camera already counts. Kyro warns about this, but it can be missed. Remove the manual count.

**Arrival & exit times says "Connect the camera system".**
Arrival times come from the cameras. Without them there's nothing to show yet.

**It says 2 or 3 people and there's only one person there.**
The figure under the big number on [AI Count](/pages/ai-count) now tells you how it was reached. Three things make one person read as more:

1. **No service is being recorded.** The *register of people* is what knows that the person on camera 1 and the person on camera 2 are the same person — and it only exists while a service is running. Without one, each camera's count is simply **added** to the next, and **face matching does nothing however the switch is set**, because face codes belong to a service. Start one from **Sessions → Start a session now**, or put the time on your [Rota](/pages/rota).
2. **Two cameras are set as different rooms.** Cameras sharing a **room name** are two views of one room, and Kyro takes the fullest view. Cameras with different room names are different rooms and are added up — right for a balcony and a main floor, wrong for two cameras pointed at the same place. A camera that adds itself is named after itself, so two cameras in one computer start out added together. Give them the **same room name** on [Cameras](/pages/cameras) (the pencil).
3. **Something that isn't a person is being counted.** On [Cameras](/pages/cameras), the preview under **Counting on this computer** draws a green box round everything it counts. Look at where the extra boxes are: a poster or photo of people, a face on a screen, or **the camera seeing the very screen it's previewing on** all get counted.

**It's counting a blank wall, or a pillar.**
The AI is asked *where are the people* and answers with its best guess for every patch that's vaguely person-shaped. On a featureless wall that guess is a weak one — so a **small** box now has to be much more convincing than a big one before it's counted, and a box wider than it is tall is never a person. If a particular spot is counted every service anyway, mark it once with **Don't count an area** on [Cameras](/pages/cameras).

**It says more people than the room holds.**
That's a check worth having, and it only works once you've set the real seat count (**Cameras → pencil → Seat capacity**). If the count goes above it, Kyro says so in red under the figure and raises it under **Is Kyro working?** — because a hall with 114 seats doesn't hold 300 people, so a count above that has gone wrong somewhere.

**The figure isn't capped**, deliberately: people do stand at the back, and a number quietly clamped to 114 is a number nobody can investigate. Look at the green boxes on the Cameras preview to see what's being counted.

**Something got counted that wasn't a person — how do I take the number back down?**
Kyro drops a photograph held up to the lens by itself (it sits entirely inside the box round the person holding it), and **asks** about anything that hasn't moved for four minutes — a pillow, a coat over a chair, a poster. Open [AI Count](/pages/ai-count) and look for **Kyro needs a second opinion**.

Answering **No, take it off** removes it from the live count *and* from today's attendance, busiest day, came-in and the arrival chart, immediately — and anything that looks like it isn't counted again for the rest of the service. If it's something permanent your camera always sees, mark it once with **Don't count an area** on [Cameras](/pages/cameras).

## Cameras

**A camera shows Offline.**
The computer counting with that camera has stopped or lost its internet connection.
- **A camera that says "Camera mode" under its name** was added by Camera Mode, so it only counts while the Camera Mode page is open. Switching it on in Cameras doesn't make it count by itself. For everyday counting, [install the Kyro counter](/guides/camera-setup) on the computer the camera is plugged into. That camera then appears again as **USB camera** and counts on its own.
- **Counting on this computer:** check a Kyro tab is still open on that computer, and that [Cameras](/pages/cameras) shows **Counting**. If not, press **Start counting**. You can move around Kyro freely — only closing the Kyro tab stops it.
- **Installed version:** check the camera computer is on and online. It shows **Online** on [Cameras](/pages/cameras) when it's working.
- Check the camera's cable (USB cameras) or power and network (Wi-Fi cameras).

**I stopped counting, but the old picture is still on the screen.**
It shouldn't be, and it isn't any more. Stopping counting now tells Kyro straight away, and Kyro throws the camera's last picture away the moment it hears — a tile for a camera that is off shows grey and a line of text, never a photograph. If you still see one, reload the page; a tab that has been left behind another window for a long time can be showing a page several minutes old.

**"Is Kyro working?" shows red problems I can't get rid of.**
Open **Attendance** and find the **Is Kyro working?** panel. Each problem now has a **Put aside** button (administrators only), and **Put all N aside** clears a whole list in one go.

Putting a problem aside is not deleting it. It moves down into **Fixed, but worth knowing about**, with its times and the number of times it happened, and it comes straight back to the top if it happens once more — so nothing that is still going wrong can be hidden.

Use it for a camera you have unplugged or switched off. A problem normally clears itself when the thing that failed starts working again, and a camera in a drawer can never do that.

::: tip The red ✗ is not a button
The red ✗ beside a problem is there to mark it as a problem. The button is on the right-hand side of the same row and says **Put aside**.
:::

**I deleted a camera and its problems are still listed.**
Deleting a camera removes its problems outright — they go with it. If you only **switched it off**, its problems are closed instead but stay in the record below, because the camera still exists and could be switched back on.

## Camera Mode

**The browser says it wasn't allowed to use the camera.**
Click the **camera icon** in the address bar (or the padlock), choose **Allow** for the camera, then press **Start counting** again.

**"No camera found".**
Plug the camera in, wait a few seconds, then press **Start counting**. If another program (Zoom, Teams, OBS…) is using the camera, close it first.

**It says "Lighter AI".**
That computer's graphics are too slow for the most accurate AI, so Kyro uses a lighter one. It still counts, but finds fewer people far from the camera. Use a computer with better graphics, in **Chrome** or **Edge**, for the best count.

**The count stopped or slowed down.**
Keep the Camera Mode page **on screen**. Browsers slow down pages in hidden tabs and minimised windows. Also stop the computer from going to sleep.

**The count isn't on the dashboard.**
Camera Mode only sends counts in **Live** mode. In **Demo** mode the count stays on that computer.

**I can't press Start session.**
The camera isn't sending pictures yet. See above.

**System Status says "Not connected".**
This version of Kyro isn't connected to the camera system. Manual counts, approvals, integrations and count alerts still work.

## Alerts

**I don't get alerts when Kyro is closed.**
1. On iPhone, make sure you opened Kyro from the **home-screen icon** (see [Install on your phone](/getting-started/install)).
2. On [Notifications](/pages/notifications), tap **Send in 20s** and lock your phone straight away.
3. Check phone **Settings → Notifications → Kyro** and any Focus / Do Not Disturb mode.

**I saved a count but didn't get an alert.**
The person who saves a count isn't alerted about it. Test with a second phone. Count alerts are also only sent from **Live** mode.

**It says "subscription has expired".**
Tap **Turn off**, then **Turn on** again.

**It says "Blocked".**
Tap the lock icon in the browser's address bar → **Notifications** → **Allow**, then refresh.

## Integrations

**"Could not send".**
Check the webhook URL, tap **Save settings** and try **Send a test** again. A test with [webhook.site](https://webhook.site) shows whether the problem is in Kyro or in the other system.

## Still stuck?

Contact the Kharis tech team with a screenshot of what you see and the page you were on.
