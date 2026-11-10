# AI Count

AI Count is the main dashboard. It shows how many people are in the building, how that changed through the day, when people arrived and left, what's on, and the health of the system.

<Shot name="ai-count" alt="AI Count page: total people in building, chart of the day, arrival and exit times, Live Overview, AI Alerts and System Status" />


## Is this a person?

The AI is asked *where are the people in this picture*, and it answers honestly. A cushion is person-shaped. So is a photograph of somebody held up to the lens. **Nothing in a single frame can settle it.**

Two things now do:

- **A picture held up to a camera isn't counted at all.** A photograph of people on a phone, or on a printed sheet, sits *entirely inside* the box round the person holding it, and is much smaller. Two real people standing close together never do that — one's head is above the other's shoulders, or their feet are below. Kyro drops those detections before they reach the count.
- **Anything that hasn't moved for four minutes gets a question.** A seated person is never still: they breathe, shift, turn their head. A pillow, a coat over a chair, a statue or a poster doesn't move at all, ever. Kyro shows you the picture and asks **Is this a person?** — it never decides on its own, because people do fall asleep.

Answer **No, take it off** and it comes off the count *and off today's figures*, and **anything that looks like it isn't counted again** for the rest of the service — so the same cushion isn't asked about every four minutes.

::: tip A statue your camera always sees
For something permanent, mark it once with **Don't count an area** on the [Cameras](/pages/cameras) page instead of answering the same question every service.
:::

## When Kyro is wrong, the number goes down

Every correction takes the number **back out** — not just off the live count, but out of today's figures: attendance, **busiest day**, **came in this session**, and the arrival chart, all in the same moment you answer.

This used to be only half true. Kyro corrected itself in memory, and the rows it had already written stayed exactly where they were — so the register said 1 and the page went on saying 2. That's a figure that can only ever climb, and it's why *busiest day* read 4 when there had only ever been one person.

Nothing is destroyed: corrected entries are marked deleted the same way a deleted day is, so a correction can itself be undone.

## Is this the same person?

When Kyro has to guess whether two sightings are the same person, it now **asks you** — with a picture of each.

It still makes its guess, so the count never stalls waiting for an answer. Your answer **corrects the register straight away**: two entries become one, or one becomes two, and the attendance figure moves while you're looking at it. The panel tells you what changed — *"Counted as one person. 48 different people this service."*

Each question says what Kyro thought and why: how alike the two looked, whether a face was readable, and whether everyone in the room was dressed alike. Three answers: **Same person**, **Different people**, **Can't tell**.

::: info What's kept, and what isn't
**Both pictures are deleted the moment you answer.** What's kept is how alike the two looked and what you said — no photograph, no face code, no name.
:::

### Does it actually learn?

Yes, but narrowly, and it's worth being precise about it.

**It does not retrain the AI.** The model that finds people and the one that reads faces are fixed files, the same in every church. A few hundred answers couldn't move them.

**What it does set is the line.** Kyro calls two people the same when they look a certain percentage alike. That number started as a measurement taken on standard photographs — not on your hall, your lighting or your congregation's coats. Every answer you give is one labelled example from *your* building, and a threshold is exactly the kind of thing a few dozen labelled examples can set properly.

So after **25 answers** Kyro starts moving that line to fit your building, one small step at a time, and only when the move would get more of your own answers right. Every change is recorded. The panel shows you the line it's using, where it came from, and how often Kyro was already right without you.

## On the rota

While something on your [Rota](/pages/rota) is running, an **On the rota** panel appears beside the figures: what's on, its times, and **what Kyro is recording it as**. If it says nothing is being recorded yet, no camera has seen anybody — check a camera is counting.

It also shows what's on **next**, within the next twelve hours. If you haven't put a rota in, the panel isn't there at all.

## The headline number

**Total people in building** is the big number at the top. On any day other than today it shows that day's figure and reads **Historical data**.

Admins and operators can switch what the number and chart show with the button at the top right of the card (**People Count ▾**):

| Option | Shows |
|---|---|
| **People Count** | People in the building now |
| **Occupancy %** | How full the venue is |
| **Entries** | Total entries today |
| **Exits** | Total exits today |

::: info Manual counts are included
For **People Count** and **Entries**, today's **approved** [manual counts](/pages/manual-count) are added to the camera count. Drafts aren't added until they're approved.
:::

## Look at another day

1. Tap the **date button** at the top right (for example *October 6, 2026*).
2. Pick **Today**, **Yesterday**, **7 days ago** or **30 days ago**, or choose any past day from **Custom date**.

## Arrival & exit times

This card answers **"when do people arrive?"** Blue bars above the line are people arriving, and orange bars below the line are people leaving, for each time slot.

<Shot name="arrival-times" size="wide-card" alt="Arrival and exit times card: busiest arrival 9:45 to 10:00 AM with 2,066 people, busiest exit 12:15 to 12:30 PM, half had arrived by 10:00 AM" />

- The four boxes give the answers straight away: **Busiest arrival time**, **Busiest exit time**, **Half had arrived by** and **First arrivals**.
- Switch between **15 min**, **30 min** and **1 hr** slots.
- **Hover over or tap a bar** to see its numbers just above the chart.
- Tap **Table** to see every slot as a list of times with **Arrived** and **Left**.

::: tip Use it to plan
If half your congregation arrives in the 15 minutes before the service starts, that's when you need the most ushers at the doors.
:::

Arrival times come from the cameras' entry and exit counts. Without the camera system connected, the card says so instead of showing numbers. In Demo mode it shows **Sample data**.

## Zone Overview and Detailed Zone Analytics

**Zone Overview** has a card for each room with a camera, showing people now and a small trend line. **Detailed Zone Analytics** (admins and operators) lists each zone with **Now**, **Peak** and **Trend (Today)**. Tap any zone to open it on the [Seat Map](/pages/seat-map).

## Right-hand column

- **Live Overview:** a slideshow of camera pictures. Use the arrows or dots to move between cameras, or **View all** to open [Live Cameras](/pages/live-cameras).
- **AI Alerts** (admins and operators): recent alerts like *High Density Detected* or *Camera Offline*. Resolved alerts fade and show **CLEARED**.
- **System Status** (admins only): whether each part of Kyro is really working.

## Reading System Status

| Row | What it checks | You might see |
|---|---|---|
| **AI Service** | Whether the Kyro server answers | Live · Offline · Not connected |
| **Cameras** | How many cameras are running | Live (3 of 3) · 2 of 3 live · Offline (0 of 3) · None set up |
| **Data Feed** | Whether counts arrived in the last 20 seconds | Live · Not updating · No data |

Green means working, amber means partly working, red means down, and grey means not connected. In Demo mode every row reads **Live (demo)**.
