// TypeScript 6 requires explicit module declarations for side-effect imports
// of non-code files. Next.js's `next-env.d.ts` covers images but not CSS,
// and Next docs forbid editing that file — so this lives here.
declare module '*.css';
