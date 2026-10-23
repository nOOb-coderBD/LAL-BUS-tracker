# Executable implementation checklist

- [x] Phase 1: npm workspaces, TypeScript, shared Zod contracts, environment validation; `npm run build`.
- [x] Phase 2: Mongo schemas/index migration, repeatable seed; `npm run db:migrate && npm run db:seed` twice; verify 17 routes / 205 source schedules.
- [x] Phase 3: single-use academic email proof, secure sessions, driver approval, demo isolation; auth integration tests.
- [x] Phase 4: assignment checks, atomic start/end, measured foreground GPS, Redis snapshots, authorized Socket.IO; end-to-end integration test.
- [x] Phase 5: crimson heritage UI, Bengali routes, Leaflet, offline PWA, responsive/browser tests.
- [x] Phase 6: CI, Docker/HTTPS instructions, security review, parameterized load tools; `npm run lint && npm test && npm run build && npm run test:e2e`.

Phone hardware and public email delivery need external devices and SMTP credentials. Automated simulation is explicitly development-only and is never evidence of physical tracking or real university enrollment. Large capacity tests require separately authorized infrastructure.

## External validation still outstanding

- [ ] Physical Android Chrome and iPhone Safari foreground/permission/lock testing using docs/DEPLOYMENT.md.
- [ ] Real academic mailbox delivery through production TLS SMTP (local Mailpit proof only tested).
- [ ] Institution review of schedules, fleet records and exact academic domains.
- [ ] Authorized 1k/10k capacity tests and independent infrastructure metrics.
- [ ] Cloud network review for development map tiles; current proxy returns 403.
