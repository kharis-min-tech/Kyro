# Live Cameras

Live Cameras shows every camera on one screen, grouped by room. You can see how full each room is, how many seats are left, and whether the people queuing outside will fit.

<Shot name="live-cameras" alt="Live Cameras page with the venue overview: people in venue, seats left, occupancy, cameras live, outside queue, and seats by room" />

## Venue overview

The card at the top answers the big questions:

| Box | Shows |
|---|---|
| **IN VENUE** | People inside, out of the total seats |
| **SEATS LEFT** | Free seats. Turns amber under 20 and red with **Full** at 0. |
| **OCCUPANCY** | How full the venue is |
| **CAMERAS** | How many cameras are live |
| **OUTSIDE QUEUE** | People waiting outside, with a verdict: **Yes, 40 spare seats after** or **No, 25 too many** |

If there's no outdoor camera, use **−** and **+** on **OUTSIDE QUEUE** to enter a rough count of the queue (it changes by 10). Kyro tells you whether they'll fit.

**Seats by room** lists each room's capacity, people in, seats left and how full it is, with a status of **Open**, **Filling**, **Full**, **Offline** or **Camera error**. Tap the heading to fold the table away.

## Filling-up warnings

When a room reaches **80%** full, an amber **Rooms filling up** banner appears at the top. At **90%** it turns red: **Overcrowding alert**. Each room shows how many seats are left. Tap **×** to dismiss a room's warning (it comes back if you reload the page).

## Camera tiles

Below the overview, each camera has a tile showing the live picture, **Live** or **Offline**, the count against capacity and seats left. Tiles show **FILLING UP** at 80% and **OVERCROWDED** at 90%.

::: warning Only a doorway camera shows "in" and "out"
**In** and **out** mean people crossing a line, and only a camera on a doorway watches one. A camera pointed at a room has no line: what it can tell you is that it became sure of somebody, and later lost sight of them — which is not the same as them arriving and leaving. One person at a desk, stepping out of shot and back, produced *6 in · 5 out* without walking anywhere.

So a room camera shows **most at once** instead, which it can genuinely measure. To get real arrivals and departures, set a camera's type to **Outdoor / queue** — or, for a door, point one at the entrance and mark it as such on the [Cameras](/pages/cameras) page.

Arrivals and departures for the whole building don't need a doorway camera: Kyro works them out from the register of people instead, counting each person once. See [AI Count](/pages/ai-count).
:::

- **See one room bigger:** tap the expand icon at the bottom right of its tile. Close it with **<Icon name="close" label="close" />** or the Esc key.
- **Picture stopped?** If a tile says **Stream lost — tap to retry**, tap it.

::: warning A camera that isn't counting has no figures
Only its **capacity** is shown — that's a number you typed in, not something a camera found. **People in**, **space left** and **how full** all read **—**, and so do the venue totals at the top when no camera is running anywhere.

"21 spaces left" in a room nothing can see isn't a cautious figure, it's an invented one — and it's the kind somebody acts on when deciding whether to open another room.
:::

::: tip A camera that is off shows no picture at all
When you stop counting, or unplug a camera, its tile goes grey straight away and says so. It never keeps showing the last picture it sent: a photograph of a full hall is far more convincing than the word "Offline" beside it, so Kyro would rather show you nothing than show you a moment that has passed.
:::

An **outdoor queue** camera shows a big number of **people outside**. It has no seats. Its count feeds the **OUTSIDE QUEUE** box above.

::: info In Demo mode
Demo camera tiles show a placeholder instead of a real picture, and the counts are simulated.
:::
