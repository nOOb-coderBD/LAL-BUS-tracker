# Assumptions and remaining external validation

- The app is unofficial. No official DU branding/photo license or endorsement was supplied. Original SVG/CSS illustrations avoid reusing the attached photograph.
- Source routes/times are draft screenshot transcriptions; current services, operating days, physical buses, coordinates and ETA cannot be inferred. Unknown fields remain null/absent.
- Default academic domains are `du.ac.bd` and `student.du.ac.bd`; the institution must approve actual domain/workspace policy. Real enrollment checking is outside mailbox ownership proof.
- Real SMTP/Google credentials, production map-provider contract, public DNS/TLS, approved fleet records and actual drivers are external prerequisites. Local Mailpit/demo personas do not satisfy them.
- Foreground PWA tracking needs HTTPS, explicit location permission, an awake visible browser and network connectivity. Background/locked-device reliability is not promised.
- Android Chrome and iPhone Safari must be exercised on physical devices using the deployment guide. Automated Chromium mobile emulation does not establish hardware GPS/battery/background behavior.
- MongoDB/Redis are required. No in-memory database or static API mock substitutes for the working flow. Local Compose credentials/networking are not a production security boundary.
- Docker images are version-tagged development references. Pin reviewed digests and schedule security updates in production; supply-chain review remains an operator task.
- Database migration 001 creates indexes additively. Schema evolution needs explicit later migrations; seed upserts intentionally preserve admin edits.
- WebSocket-only avoids polling affinity but may fail on restrictive networks. Snapshot recovery and bounded polling/refetch do not promise delivery through every network.
- 10,000 viewers, 10,000 socket connections and 10,000 HTTP RPS are distinct performance targets. No such capacity was measured merely by writing load scripts. Hardware/infra capacity, authorized load execution and independent monitoring are needed.
- MVP provides structured CRUD/review and JSON source import/export. Generic CSV migration, native background tracking, reliable real-time ETA prediction and push notifications require separate development.

Use actual command output and `docs/VALIDATION.md` when present for validation results. Never replace unrun phone, Google/SMTP-delivery or large-load checks with success claims.
