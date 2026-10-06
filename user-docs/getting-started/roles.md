# Roles & access

Every Kyro user has a role, and each role comes with a set of pages. An administrator can also choose exactly which pages each person sees, on the [Users](/pages/users) page.

## The three roles

| Role | Shown as | Pages they see by default |
|---|---|---|
| **Admin** | Administrator | All 12 pages |
| **Operator** | Operator | AI Count, Manual Count, Live Cameras, Seat Map, Cameras, Rota, Sessions, Analytics, Notifications |
| **Viewer** | Viewer | Manual Count, Seat Map, Cameras |

## What else changes with the role

- **System Status** on AI Count is shown to admins only.
- The **People Count / Occupancy / Entries / Exits** switch and the **Detailed Zone Analytics** table on AI Count are for admins and operators.
- **AI questions:** admins get questions about the room (*"Is this the stage?"*, *"Does this count look right?"*). Operators and admins get questions about people (*"Did they leave or go to the toilet?"*). Viewers don't get AI questions.

## How Kyro works out the role

On the Users page you tick the pages each person can use, and Kyro sets the role from the ticks:

- Tick **Seat Editor**, **Integrations** or **Users** and the person becomes an **admin**.
- Tick any of AI Count, Manual Count, Live Cameras, Rota, Sessions, Analytics or Notifications (and no admin pages) and they become an **operator**.
- Anything else, such as only Seat Map and Cameras, makes them a **viewer**.

The badge next to **Page access** shows the role before you save, for example **→ operator**.

::: warning Hiding a page doesn't lock it
Unticking a page removes it from that person's sidebar. It's a way to keep Kyro simple for each person. Don't rely on it to keep information secret from someone who knows the page's web address.
:::
