---
status: accepted
---

# Use React and TypeScript with JWT cookie sessions

The internal backoffice is built with React and TypeScript, and authenticated sessions use signed JWTs delivered in host-scoped HttpOnly cookies rather than exposing bearer tokens to React or browser storage. A server-side session record keyed by the JWT `sid` claim provides logout and revocation, trading fully stateless validation for reliable internal-session control and incident response.

## Consequences

- Production backoffice assets are prebuilt into the single central Node.js package.
- JWTs use explicit algorithm, signature, issuer, audience, subject, expiration, and session validation.
- React restores authentication through the session API and never reads a JWT.
- Cookie authentication retains CSRF-token validation and `SameSite=Strict`; the deployment intentionally does not configure or enforce a separate trusted-origin allowlist.
- Signing-key rotation, session revocation, login throttling, and authentication audit events are production requirements.
