# ADR 0003: Supabase PostgreSQL & Auth with Privileged Server Gateways

## Status
Accepted

## Context
The platform requires durable relational storage with referential integrity for 22 application tables, transactional stored procedures (RPCs) for atomic mastery updates, and secure user authentication. 

In the prototype, the browser client sometimes accessed Supabase tables directly via the anonymous key, while the backend used the service-role key without enforcing user-level course authorization checks. Furthermore, an unverified JWT fallback in the Python backend created an authentication vulnerability.

## Decision
We utilize Supabase PostgreSQL and Supabase Auth under a strict server-gateway model:
1. **No Direct Browser Database Access**: Browser clients authenticate directly with Supabase Auth to obtain session JWTs, but direct database querying from browser clients using `anon` keys is prohibited. Application tables disable anonymous access.
2. **Strict Server Token Verification**: The backend server receives user bearer tokens in HTTP headers or WebSocket handshake auth, validating them against Supabase Auth via `auth.getUser(token)`. A dedicated verification client is used for this purpose to prevent token leakage.
3. **Privileged Backend with Explicit Authorization**: The backend server connects to PostgreSQL using the privileged `SUPABASE_SERVICE_ROLE_KEY`. Because service-role queries bypass Row-Level Security (RLS) (<https://supabase.com/docs/guides/database/postgres/row-level-security>), all server repositories and services MUST explicitly verify course enrollment and role boundaries before executing data queries or mutations.
4. **Transactional RPCs**: Atomic mutations (e.g., applying mastery evidence or claiming study pool entries) are encapsulated in PostgreSQL stored functions restricted to the service role.

## Why
- Guarantees strict authentication and authorization boundaries; eliminating client-forged roles or unverified JWTs (<https://supabase.com/docs/guides/auth/server-side/advanced-guide>).
- Encapsulates complex domain transitions (e.g., student mastery math and peer matching locks) within atomic database transactions, preventing read-modify-write race conditions.
- Provides a clean separation between identity verification and privileged data access.

## Consequences
- Every database interaction passes through the backend server; client components cannot use Supabase client-side subscriptions or direct table queries.
- Developers must maintain explicit authorization checks in all server repositories and cannot rely passively on PostgreSQL RLS policies when querying with the service-role key.
