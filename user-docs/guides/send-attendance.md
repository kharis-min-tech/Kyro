# Sending attendance to another system

Send each service's total to a Google Sheet, a denomination portal or a chat channel automatically, with no copying numbers by hand.

## Example: log every service in a Google Sheet (with Zapier)

1. In **Zapier**, create a Zap.
2. **Trigger:** choose **Webhooks by Zapier → Catch Hook** and copy the webhook URL it gives you.
3. In Kyro, open **Integrations**, paste the URL into **Webhook URL (HTTPS)** and tap **Save settings**.
4. Tap **Send a test** in Kyro. Back in Zapier, click **Test trigger**, and you'll see Kyro's test data.
5. **Action:** choose **Google Sheets → Create Spreadsheet Row**, and map the columns:
   - Date → `service_date`
   - Total → `totals grand_total`
   - Camera count → `totals camera_count`
   - Manual count → `totals manual_count`
6. Turn the Zap on.

After each service, approve the counts on **Manual Count**, then tap **Send end-of-service now** in Integrations. A new row appears in your sheet.

::: tip Filter out tests
Test sends include `"test": true` and Demo sends include `"mode": "demo"`. Add a Zapier **Filter** step that only continues when `mode` is `live` and `test` doesn't exist.
:::

See [Integrations](/pages/integrations) for every field Kyro sends.
