# Integrations

Integrations sends Kyro's end-of-service attendance total to another system: your denomination's reporting portal, a Google Sheet through Zapier, or anything else that accepts a **webhook**.

<Shot name="integrations" alt="Integrations page with the plain-English explanation, the webhook URL, shared secret, the automatic sending schedule (Sundays at 12:30), and the Save settings, Send a test and Send today’s total now buttons" />

## What happens when you send

- Kyro takes **today's approved Manual Counts**: every room and the total. Drafts are left out until they're approved.
- It posts them to your webhook address as a small data message (example below).
- **Send a test** adds a pretend camera count of 42 and is marked `"test": true`, so you can check it arrives without confusing your records.
- Nothing changes in Kyro. Sending just shares a copy of the numbers.

## Connect a system

1. In the other system, create a webhook and copy its URL. In Zapier, use **Webhooks by Zapier → Catch Hook**.
2. In Kyro, paste it into **Webhook URL**.
3. Optional: add a **Shared secret** if your receiving system asks for one. Kyro sends it as an `X-Kyro-Secret` header so the receiver can check the data came from you. Once saved it's never shown again; type a new one to replace it.
4. Tap **Save settings**.
5. Tap **Send a test**. You should see **Test sent — the receiving system answered "200 OK"**.

In Live mode the settings are saved on the Kyro server, so every admin sees the same ones. In Demo mode they stay on your device.

::: tip Just want to see it working?
Paste a fresh address from [webhook.site](https://webhook.site), tap **Send a test**, and watch it arrive there.
:::

## Send automatically after each service

In Live mode, tick **Send automatically after each service**, choose the **days** (for example Sun) and a **time**, then **Save settings**.

Kyro sends today's approved counts once on each chosen day, within 15 minutes of that time, **even if nobody has Kyro open**. Pick a time after the final count is usually approved, for example 30 minutes after the service ends.

Under the schedule you'll see when it last sent and whether it was delivered, for example *Last sent Sun 12 Oct, 12:45 (automatically) — delivered*.

## Send by hand

1. On [Manual Count](/pages/manual-count), tap **Approve final count**.
2. Open Integrations and tap **Send today's total now**.

::: warning Only approved counts are sent
Draft manual counts aren't included. Approve them first, or schedule the automatic send for after they're usually approved.
:::

## What Kyro sends

The **What gets sent (example)** card shows exactly what a test send would contain right now, and **Copy** copies it. It looks like this:

```json
{
  "service_date": "2026-10-12",
  "counted_at": "2026-10-12T11:45:00.000Z",
  "mode": "live",
  "totals": {
    "camera_count": 0,
    "manual_count": 176,
    "grand_total": 176
  },
  "by_zone": [
    { "zone": "Overflow Room", "count": 64, "source": "manual", "approved_by": "Kharis Admin" },
    { "zone": "Youth Hall", "count": 112, "source": "manual", "approved_by": "Kharis Admin" }
  ],
  "source": "kyro",
  "kyro_version": "0.3.0"
}
```

| Field | Meaning |
|---|---|
| `service_date` | The day of the service |
| `counted_at` | When it was sent |
| `mode` | `live` or `demo`, so test data never gets mixed up with real data |
| `totals` | Camera count (0 until cameras are connected), approved manual count, and the grand total |
| `by_zone` | Each room's count, whether it came from a camera or a manual count, and who approved it |
| `test` | Only on **Send a test**. Test sends add a sample camera count of 42 on "Main Floor" so you can spot them. |

## If a send fails

| Message | What to do |
|---|---|
| **The receiving system said no: 404** (or another number) | The URL is wrong, or the receiver rejected it. Copy the URL again from the other system. |
| **That doesn't look like a web address** | Check you pasted the whole address, starting with `https://`. |
| **Private / local addresses can't be reached** | Kyro sends from the cloud, so it can't reach an address on your church network. Use an internet address. |
| **Last sent … — failed** | The automatic send didn't get through. Check the URL, then use **Send today's total now**. |
