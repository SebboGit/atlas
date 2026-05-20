import { z } from 'zod';

// Validate (and CAP) what we'll trust from the OIDC userinfo response.
// PocketID is trusted, but the JSON over the wire is still untrusted
// input — bound every field that lands in our DB.
//
// Limits chosen to be obviously larger than any reasonable claim while
// preventing memory blow-up from a hostile or misconfigured IdP:
//   - email      < 320 (RFC 5321 max)
//   - name       < 256
//   - groups     ≤ 32 entries, each < 64 chars
export const pocketIdProfileSchema = z.object({
  sub: z.string().min(1).max(256),
  email: z.string().email().max(320).optional(),
  email_verified: z.boolean().optional(),
  name: z.string().max(256).optional(),
  preferred_username: z.string().max(256).optional(),
  groups: z.array(z.string().max(64)).max(32).optional(),
});

export type PocketIDProfile = z.infer<typeof pocketIdProfileSchema>;
