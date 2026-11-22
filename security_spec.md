# AppForge Studio — Security Rules Specification

## 1. Data Invariants
1. A `UserProfile` document at `/users/{userId}` can only be created by the authenticated user matching `userId`, with `role: 'user'` and `accountStatus: 'active'`. Users cannot self-promote to `'admin'` or unsuspend themselves.
2. An `AppProject` at `/projects/{projectId}` must belong to an authenticated, email-verified user (`ownerId == request.auth.uid`), with immutable `ownerId` and `createdAt`.
3. A `BuildJob` at `/builds/{buildId}` must reference an existing `projectId` owned by the caller (`exists()` + `get()` verification on create), and once `status` reaches a terminal value (`completed`, `failed`, `cancelled`), non-admin users cannot update it.
4. `SubscriptionPlan` (`/plans/{planId}`) and `EngineSettings` (`/settings/{settingId}`) are readable by signed-in users, and writable strictly by verified admins (`isAdmin()`).
5. `AdminEngineSecrets` (`/adminSecrets/{secretId}`) is strictly readable and writable ONLY by verified admins (`isAdmin()`).
6. `AuditLog` (`/auditLogs/{logId}`) can be created by signed-in users for their own `actorUid`, never updated or deleted by non-admins, and listable only by admins or the matching `actorUid`.
7. PII (`email` in `/users/{userId}`) is strictly isolated to `isOwner(userId) || isAdmin()`.

## 2. Dirty Dozen Attack Payloads (Must All Yield PERMISSION_DENIED)
1. **Self-Admin Escalation**: Creating `/users/attacker` with `role: 'admin'`.
2. **Role Mutation**: Updating `/users/user1` changing `role` from `'user'` to `'admin'`.
3. **Self-Unsuspend**: Updating `/users/user1` changing `accountStatus` from `'suspended'` to `'active'`.
4. **Shadow Field Injection**: Creating `/projects/p1` with an undeclared field `isVerified: true`.
5. **Owner Spoofing**: Creating `/projects/p1` with `ownerId: 'victim_uid'`.
6. **Orphan Build Creation**: Creating `/builds/b1` referencing a non-existent `projectId: 'fake_proj'`.
7. **Cross-Tenant Build Creation**: Creating `/builds/b1` referencing `projectId` owned by another user.
8. **Terminal Build Tampering**: Updating `/builds/b_done` (where `status == 'completed'`) to `status: 'queued'`.
9. **Unauthorized Plan Tampering**: Non-admin updating `/plans/pro` to `monthlyPriceEur: 0`.
10. **Admin Secret Exfiltration**: Non-admin reading `/adminSecrets/engines`.
11. **PII Scraping List**: Non-admin listing `/users` without owner filter / trying to read another user's `/users/victim`.
12. **Path ID Poisoning**: Creating `/projects/invalid..id/..` or 200-char ID string, or invalid `packageName` regex.
