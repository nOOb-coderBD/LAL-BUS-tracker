// The root .env configures API development. Keep release bundles in production
// mode while still loading public VITE_* settings from the monorepo root.
process.env.NODE_ENV = 'production';
const { build } = await import('vite');
await build();
