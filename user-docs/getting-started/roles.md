# Roles & access

Every Kyro user has a role, and each role comes with a set of pages. An administrator can also choose exactly which pages each person sees, on the [Users](/pages/users) page.

## The three roles

| Role | Shown as | Pages they see by default |
|---|---|---|
| **Admin** | Administrator | All 12 pages |
| **Operator** | Operator | AI Count, Manual Count, Live Cameras, Seat Map, Cameras, Rota, Sessions, Analytics, Notifications |
| **Viewer** | Viewer | Manual Count, Seat Map, Cameras. Good for ushers. |

## What else changes with the role

- **Manual Count:** everyone with the page can enter counts. Only **admins and operators** can approve the final count.
- **Cameras:** only **admins** can add, change or remove cameras. Everyone else sees them read-only.
- **System Status** on AI Count is shown to admins only.
- The **People Count / Occupancy / Entries / Exits** switch and the **Detailed Zone Analytics** table on AI Count are for admins and operators.
- **AI questions:** admins get questions about the room (*"Is this the stage?"*, *"Does this count look right?"*). Operators and admins get questions about people (*"Did they leave or go to the toilet?"*). Viewers don't get AI questions.

## How Kyro works out the role

On the Users page you tick the pages each person can use, and Kyro sets the role from the ticks:

- Tick **Seat Editor**, **Integrations** or **Users** and the person becomes an **admin**.
- Tick any of AI Count, Live Cameras, Rota, Sessions, Analytics or Notifications (and no admin pages) and they become an **operator**.
- Anything else, such as Manual Count, Seat Map and Cameras, makes them a **viewer**. That's the right choice for ushers.

The badge next to **Page access** shows the role before you save, for example **→ operator**.

::: tip Pages are locked, not just hidden
If someone types the address of a page they haven't been given, Kyro sends them back to a page they can use. In Live mode the server also checks every action, so an usher can't approve counts or manage users even with a direct link.
:::
