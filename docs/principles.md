# Core Principles and Values

## 1. Transparency

- Systems build trust when they provide clear, consistent views of data.
- Permissions must be explicit and enforced.
- Sync must be deterministic and auditable.

---

## 2. Scalability and Extensibility

- Grow incrementally, keep modules small.
- New features evolve from the core model.
- External integrations use stable, documented APIs.

---

## 3. Accessibility

- Simple default flows for common actions.
- Advanced controls optional, not required.
- Offline support optional; sync rules explicit.

---

## 4. Security

- HTTPS everywhere.
- Backend is source of truth; client is untrusted.
- Authn/Authz checked on every request.

---

## 5. Data Ownership

- Users own data.
- Backups supported: a daily restic snapshot of the database, and a restore that a test runs
  (docs/backups.md).
- Schema is open and migratable.

---

## 6. Iterative Simplicity

- Ship small, safe slices.
- Avoid speculative complexity.

---

## 7. Minimal Dependencies

- Prefer stdlib + internal libs.
- Add deps only with clear ROI.
