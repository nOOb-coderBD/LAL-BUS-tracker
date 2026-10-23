# Source data and import

`data/lal_bus_tracker_routes_seed.json` is retained exactly as supplied. Its metadata says screenshots are not live and require verification. The full source is validated before writes. `npm run db:seed` imports all **17 named routes / 205 schedule entries** and writes `data/import-report.json` with counts, source SHA-256, per-route counts and ambiguities.

Route upserts use unique slug. Schedule upserts use **source route slug + direction + original per-route sequence index**. Identical departure times remain distinct; source ordering is never deduplicated. `$setOnInsert` preserves later admin review/edits when imports repeat. Import count describes source records, not newly inserted rows; unrelated admin-created records are not deleted to force totals.

| Route slug            | Source timetable entries |
| --------------------- | -----------------------: |
| isha-kha              |                       22 |
| khonika               |                       22 |
| torongo               |                       19 |
| choitali              |                       16 |
| srabon                |                       16 |
| boishakhi             |                       15 |
| ullash                |                       14 |
| kinchit               |                       12 |
| bosonto               |                       12 |
| moitree               |                       11 |
| falguni               |                        9 |
| anondo                |                        8 |
| hemonto               |                        7 |
| wari-bateshwar        |                        4 |
| idrakpur              |                        2 |
| mawa-bikrampur        |                        2 |
| curzon-kuwait-maitree |                       14 |
| **Total**             |                  **205** |

Every imported route/schedule starts `NEEDS_ADMIN_VERIFICATION`. Source metadata preserves screenshot filename/index, old update label, freeform notes and original objects. Six timetable records contain number strings; four distinct supplied strings are preserved on the schedules (`4168`, `14-0064`, `08-0035`, `11-0061`). These are unverified transcriptions, never proof of fleet identity. No physical buses are generated.

All 205 operating-day fields are null. Seven entries carry staff-only flags. Unknown stop positions and route geometries stay absent/null. Textual stop lists may describe alternatives, incomplete sequences or spelling errors; no automatic geocoding or invented polylines are produced. Screenshot 7 repeats screenshot 6's বৈশাখী route, so it is not an eighteenth route. Old dates/relative update labels remain source metadata, not current validity.

Admin should compare entries to original screenshots and transport-office records, review both directions and staff-only service, supply known operating days, then explicitly verify. Production trips require a verified route and an approved actual bus/driver assignment. Verifying one route does not silently verify every schedule or prove geometry.

For an import repeatability check, run migration, seed twice and compare source-key counts, including duplicate same-time rows. Integration tests perform this against actual MongoDB. Source JSON import is supported; generic CSV ingestion is not part of the MVP. Admin JSON export is available for review/backup.
