# Pilot user acceptance testing

Use this with each pilot agency before they rely on CatalogCraft for client work. One session takes about 45 minutes.

The agency should use **their own real (or realistic) supplier file**. The automated tests already cover the synthetic data.

Write down anything that surprises them, even when it "works".

## Before the session

- [ ] The pilot environment is deployed (see [DEPLOYMENT.md](DEPLOYMENT.md)) and a backup has been taken.
- [ ] The agency's owner account exists and its plan is set (`npm run set-plan -- <email> agency`).
- [ ] The AI key is configured, and the monthly product allowance covers the test file.
- [ ] You have a way to take notes or record the screen, with their permission.

## Scenarios

Mark each scenario **Pass**, **Pass with issues** or **Fail**. Record what happened in their words.

| # | Scenario | Expected result |
| --- | --- | --- |
| 1 | Sign in, open *Dashboard*. | The getting-started checklist reflects what they've done; nothing looks broken. |
| 2 | Create a client and fill in its brand profile (tone, audience, banned claims). | The client appears in *Clients*; the brand profile is saved. |
| 3 | Add an agency-wide banned claim in *Organization settings → Content rules*. | Saved; it applies to every client. |
| 4 | Invite a colleague as **Reviewer**; the colleague opens the link and joins. | The colleague sees the agency, can review, can't import. |
| 5 | Upload their supplier file (CSV or XLSX), choose the worksheet and header row, check the mapping. | Columns are recognised or easy to map; the preview looks like their file. |
| 6 | Validate. | Problems listed match what they know about the file. Ask: "anything missing or wrong?" |
| 7 | Generate suggestions for titles and descriptions. | Progress is visible; suggestions arrive. Ask: "would you publish these?" |
| 8 | Review: approve some, edit one, reject one, and try to type a banned claim. | Decisions stick; the banned claim is refused with a clear message. |
| 9 | Use *Approve all without warnings*. | Only warning-free suggestions are approved; flagged ones still need a person. |
| 10 | Export and open the CSV in Excel or Google Sheets. | Column order matches the original; SKUs (incl. leading zeros), prices, stock and barcodes are unchanged; only approved text changed; accents display correctly. |
| 11 | Re-import the export into their store's staging/test environment (if they have one). | It imports without errors. |
| 12 | Check *Usage* and the job's *Activity*. | The numbers match what they did. |
| 13 | Colleague from scenario 4 leaves; owner removes another test member. | Access ends immediately. |

## Questions to ask at the end

1. Which part saved you the most time compared with how you do this today?
2. Where did you hesitate or feel unsure what would happen?
3. Would you trust the export enough to import it into a live store? If not, what would it take?
4. How many products a month would you run through this, for how many clients?
5. What would you expect to pay for it?

## Acceptance

The pilot can move to real client work when:

- Scenarios 1–10 and 12–13 pass. Issues may be open only if they have a workaround the agency accepts.
- Scenario 10 passes on **their** file: protected values are byte-for-byte unchanged.
- They answer "yes" to question 3, or name concrete fixes, which then get scheduled.

Keep the filled-in checklist with the date, the agency and the app version (*Dashboard → System status*).
