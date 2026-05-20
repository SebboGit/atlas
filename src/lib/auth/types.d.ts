// Augment Auth.js's Session shape with the fields the adapter populates
// from our users table. Keeps the session.user.id typed without
// requiring feature code to cast.

import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      id: string;
    };
  }
}
