/**
 * Payload-First Security TDD Spec for AppForge Studio Firestore Rules
 * Validates the Dirty Dozen attack payloads against hardened rules invariants.
 */

export const DIRTY_DOZEN_CASES = [
  { name: 'Self-Admin Escalation on create', path: 'users/attacker', op: 'create', payload: { role: 'admin' }, expected: 'PERMISSION_DENIED' },
  { name: 'Role Mutation on update', path: 'users/user1', op: 'update', payload: { role: 'admin' }, expected: 'PERMISSION_DENIED' },
  { name: 'Self-Unsuspend on update', path: 'users/user1', op: 'update', payload: { accountStatus: 'active' }, expected: 'PERMISSION_DENIED' },
  { name: 'Shadow Field Injection on project', path: 'projects/p1', op: 'create', payload: { isVerified: true }, expected: 'PERMISSION_DENIED' },
  { name: 'Owner Spoofing on project', path: 'projects/p1', op: 'create', payload: { ownerId: 'victim_uid' }, expected: 'PERMISSION_DENIED' },
  { name: 'Orphan Build Creation', path: 'builds/b1', op: 'create', payload: { projectId: 'nonexistent' }, expected: 'PERMISSION_DENIED' },
  { name: 'Cross-Tenant Build Creation', path: 'builds/b1', op: 'create', payload: { projectId: 'other_user_project' }, expected: 'PERMISSION_DENIED' },
  { name: 'Terminal Build Tampering', path: 'builds/b_done', op: 'update', payload: { status: 'queued' }, expected: 'PERMISSION_DENIED' },
  { name: 'Unauthorized Plan Tampering', path: 'plans/pro', op: 'update', payload: { monthlyPriceEur: 0 }, expected: 'PERMISSION_DENIED' },
  { name: 'Admin Secret Exfiltration', path: 'adminSecrets/engines', op: 'get', payload: null, expected: 'PERMISSION_DENIED' },
  { name: 'PII Scraping List', path: 'users', op: 'list', payload: null, expected: 'PERMISSION_DENIED' },
  { name: 'Path ID Poisoning / Invalid Package', path: 'projects/bad..id', op: 'create', payload: { packageName: 'INVALID' }, expected: 'PERMISSION_DENIED' },
];
