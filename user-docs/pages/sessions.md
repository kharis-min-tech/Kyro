# Sessions

A session is one recorded service. Kyro saves the busiest number, the average and the full minute-by-minute record for later.

## Live mode: services record themselves

In Live mode you don't start, end or save anything:

- **Starts by itself** when the cameras have seen at least 5 people for 2 minutes. The start time is when they arrived.
- **Ends by itself** when the hall has been nearly empty (fewer than 3 people) for 15 minutes. The end time is when people left. An administrator can also tap **End the service now**.
- **Named by itself**, for example *Sunday morning service · 2 Nov*. Tap the pencil to rename it.
- The **busiest** number only counts a number that held for at least 10 seconds, so a moment's flicker isn't recorded.

When a service ends, administrators see **Service ended — keep the record?** at the bottom of the screen (and on the Services page):

- **Keep:** the record stays, with its download (**CSV**).
- **Delete:** the service's record and its minute-by-minute counts are removed for good.
- **Decide later:** it waits on the Services page, marked *Keep this record?*.

If [face matching](/pages/cameras#face-matching-across-cameras) is switched on, it only runs **while a service is being recorded**, and its face codes are wiped the moment the service ends, whether you keep the record or not.

The rest of this page is for Demo mode and Kyro with its own server, where sessions are started by hand.

<Shot name="sessions" alt="Sessions page with a card for each camera showing Now, Peak and Entries and a Start session button, and a list of past sessions" />

## Start a session

**Quick start:** on the camera's card, tap **Start session**.

**With a name** (recommended):

1. Tap **Start a session manually**.
2. Enter a **Session name**, for example *Sunday Morning Service*.
3. Choose the **Camera**. The **Capacity** fills in from the camera.
4. Tap **Start**.

While recording, the card shows **● Session live** and the time running, and the sidebar shows a green dot next to **Sessions**.

::: info The camera must be live
**Start session** is only available when the camera is sending pictures. If it's greyed out, the camera isn't running yet. See [Cameras](/pages/cameras).
:::

## End a session

Tap the red **End session** on the camera's card. You'll see **Session ended — metrics saved**.

::: warning Remember to end it
If the green dot next to **Sessions** is still pulsing after the service, a session is still running. End it so the numbers stay accurate.
:::

## Past sessions

Finished sessions are listed under **Past sessions**, with the date, how long they ran, the peak, the number of entries and the capacity.

- **Rename:** tap **<Icon name="pencil" /> rename**, type the name, then **Save**. A quick-started session has no name until you rename it here.
- **Download:** tap **Export CSV** to get a spreadsheet of the session's numbers.
- **Delete:** tap **Delete** and confirm. This can't be undone.
