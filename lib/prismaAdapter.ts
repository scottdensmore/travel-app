import { PrismaPg } from '@prisma/adapter-pg';

class DatabaseUrlAdapter extends PrismaPg {
    constructor(private readonly databaseUrl: string | undefined) {
        super({
            connectionString: databaseUrl,
            // node-postgres otherwise waits indefinitely for a connection.
            connectionTimeoutMillis: 5_000,
            idleTimeoutMillis: 300_000,
        });
    }

    override async connect() {
        // Constructing a client during a build needs no database. A query must
        // never fall back to ambient PGHOST/PGUSER or a local user database.
        if (!this.databaseUrl?.trim()) {
            throw new Error('DATABASE_URL must be configured before connecting to the database.');
        }
        return super.connect();
    }
}

/** Every client, including independent transaction-test clients, owns a pool. */
export function createPrismaAdapter() {
    return new DatabaseUrlAdapter(process.env.DATABASE_URL);
}
