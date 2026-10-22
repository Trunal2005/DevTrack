import { randomUUID } from 'node:crypto';

interface TestDatabase {
  databaseName: string;
  collections(): Promise<Array<{ deleteMany(filter: Record<string, never>): Promise<unknown> }>>;
}

interface DatabaseDriver {
  connection: {
    readyState: number;
    db?: TestDatabase;
    getClient(): unknown;
  };
  connect(uri: string): Promise<unknown>;
  disconnect(): Promise<unknown>;
}

interface DisposableServer {
  getUri(databaseName: string): string;
  stop(): Promise<unknown>;
}

/** Only a server provisioned by this run can supply the integration database. */
export async function createIntegrationDatabase(
  driver: DatabaseDriver,
  provision: () => Promise<DisposableServer>,
  inheritedUri: string | undefined,
) {
  if (inheritedUri !== undefined) {
    throw new Error('Integration tests refuse MONGODB_URI. Unset it; a disposable MongoDB instance is provisioned automatically.');
  }
  const initialState = driver.connection.readyState;
  if (initialState !== 0) {
    throw new Error('Integration tests refuse an existing MongoDB connection.');
  }

  const server = await provision();
  const databaseName = `devtrack_integration_${randomUUID().replaceAll('-', '')}`;
  let uri: string;
  try {
    uri = server.getUri(databaseName);
    await driver.connect(uri);
    if (driver.connection.readyState !== 1 || driver.connection.db?.databaseName !== databaseName) {
      throw new Error('Integration MongoDB connected to an unexpected database.');
    }
  } catch (error) {
    // Never clear or drop a database following a failed connection attempt.
    await server.stop();
    throw error;
  }

  const ownedDatabase = driver.connection.db;
  const ownedClient = driver.connection.getClient();
  let closed = false;
  const ownsConnection = () => !closed
    && driver.connection.readyState === 1
    && driver.connection.db === ownedDatabase
    && ownedDatabase?.databaseName === databaseName
    && driver.connection.getClient() === ownedClient;

  return {
    uri,
    async clear() {
      if (!ownsConnection()) {
        throw new Error('Refusing integration cleanup: the active MongoDB connection is not owned by this fixture.');
      }
      const collections = await ownedDatabase!.collections();
      for (const collection of collections) {
        await collection.deleteMany({});
      }
    },
    async close() {
      if (closed) return;
      const disconnectOwnedClient = ownsConnection();
      closed = true;
      try {
        if (disconnectOwnedClient) await driver.disconnect();
      } finally {
        // Stopping this instance removes only its own temporary data directory.
        // No dropDatabase call is ever made on an application/shared server.
        await server.stop();
      }
    },
  };
}
