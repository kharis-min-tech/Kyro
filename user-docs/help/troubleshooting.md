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

## Cameras

**A camera shows Offline.**
The computer counting with that camera has stopped or lost its internet connection.
- **Camera Mode:** check the [Camera Mode](/pages/camera-mode) page is still open, on screen, and says **Counting**. If not, press **Start counting**.
- **Installed version:** check the camera computer is on and online. It shows **Online** on [Cameras](/pages/cameras) when it's working.
- Check the camera's cable (USB cameras) or power and network (Wi-Fi cameras).

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
