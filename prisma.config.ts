import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer loads .env or package.json's seed command implicitly.
// Environment variables supplied by CI/deployment continue to take precedence.
config({ quiet: true });

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
        seed: 'ts-node --project tsconfig.seed.json prisma/seed.ts',
    },
    // Generation/typechecking does not need a database. Commands that access
    // one still fail when DATABASE_URL is absent; never supply a fallback DB.
    datasource: { url: process.env.DATABASE_URL },
});
