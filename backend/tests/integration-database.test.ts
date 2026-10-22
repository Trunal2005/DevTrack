import { describe, expect, it, vi } from 'vitest';
import { createIntegrationDatabase } from '../src/__tests__/integration/database.js';

function fixtures() {
  const collection = { deleteMany: vi.fn().mockResolvedValue({}) };
  const database = {
    databaseName: '',
    collections: vi.fn().mockResolvedValue([collection]),
    dropDatabase: vi.fn(),
  };
  const client = {};
  const connection = { readyState: 0, db: database, getClient: vi.fn(() => client) };
  const driver = {
    connection,
    connect: vi.fn(async (uri: string) => {
      connection.readyState = 1;
      database.databaseName = new URL(uri).pathname.slice(1);
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  const server = {
    getUri: vi.fn((name: string) => `mongodb://127.0.0.1:49152/${name}`),
    stop: vi.fn().mockResolvedValue(true),
  };
  const provision = vi.fn().mockResolvedValue(server);
  return { collection, database, connection, driver, server, provision };
}

describe('integration database isolation (no MongoDB required)', () => {
  it.each([
    'mongodb://localhost:27017/devtrack',
    'mongodb://127.0.0.1:27017/devtrack_test',
    'mongodb://prod.example.com/customer_test_archive',
    'mongodb+srv://user:secret@cluster.example.com/production',
    'mongodb://127.0.0.1:27017/test?authSource=admin',
    'not-a-mongodb-uri',
    '',
  ])('rejects inherited URI %s before provisioning, connecting, or cleanup', async (uri) => {
    const f = fixtures();
    await expect(createIntegrationDatabase(f.driver, f.provision, uri)).rejects.toThrow('refuse MONGODB_URI');
    expect(f.provision).not.toHaveBeenCalled();
    expect(f.driver.connect).not.toHaveBeenCalled();
    expect(f.database.collections).not.toHaveBeenCalled();
    expect(f.database.dropDatabase).not.toHaveBeenCalled();
    expect(f.driver.disconnect).not.toHaveBeenCalled();
  });

  it('refuses to adopt a pre-existing connection, even to a test-named database', async () => {
    const f = fixtures();
    f.connection.readyState = 1;
    f.database.databaseName = 'devtrack_test';
    await expect(createIntegrationDatabase(f.driver, f.provision, undefined)).rejects.toThrow('existing MongoDB connection');
    expect(f.provision).not.toHaveBeenCalled();
    expect(f.driver.connect).not.toHaveBeenCalled();
    expect(f.database.collections).not.toHaveBeenCalled();
    expect(f.driver.disconnect).not.toHaveBeenCalled();
  });

  it('uses a unique database on each freshly provisioned server and clears only owned fixtures', async () => {
    const a = fixtures();
    const b = fixtures();
    const first = await createIntegrationDatabase(a.driver, a.provision, undefined);
    const second = await createIntegrationDatabase(b.driver, b.provision, undefined);
    expect(first.uri).toMatch(/^mongodb:\/\/127\.0\.0\.1:49152\/devtrack_integration_[a-f0-9]{32}$/);
    expect(first.uri).not.toBe(second.uri);
    expect(a.driver.connect).toHaveBeenCalledWith(first.uri);
    await first.clear();
    expect(a.collection.deleteMany).toHaveBeenCalledWith({});
    expect(b.collection.deleteMany).not.toHaveBeenCalled();
    await first.close();
    await first.close();
    await second.close();
    expect(a.driver.disconnect).toHaveBeenCalledTimes(1);
    expect(a.server.stop).toHaveBeenCalledTimes(1);
    expect(a.database.dropDatabase).not.toHaveBeenCalled();
    await expect(first.clear()).rejects.toThrow('not owned');
  });

  it('stops only its disposable server after connection failure', async () => {
    const f = fixtures();
    f.driver.connect.mockRejectedValueOnce(new Error('connection failed'));
    await expect(createIntegrationDatabase(f.driver, f.provision, undefined)).rejects.toThrow('connection failed');
    expect(f.server.stop).toHaveBeenCalledOnce();
    expect(f.database.collections).not.toHaveBeenCalled();
    expect(f.database.dropDatabase).not.toHaveBeenCalled();
    expect(f.driver.disconnect).not.toHaveBeenCalled();
  });

  it('cannot clean an unexpected database returned after connection', async () => {
    const f = fixtures();
    f.driver.connect.mockImplementationOnce(async () => {
      f.connection.readyState = 1;
      f.database.databaseName = 'production';
    });
    await expect(createIntegrationDatabase(f.driver, f.provision, undefined)).rejects.toThrow('unexpected database');
    expect(f.server.stop).toHaveBeenCalledOnce();
    expect(f.database.collections).not.toHaveBeenCalled();
    expect(f.database.dropDatabase).not.toHaveBeenCalled();
    expect(f.driver.disconnect).not.toHaveBeenCalled();
  });

  it.each(['database', 'database name', 'client', 'disconnected'] as const)('refuses cleanup after the owned %s changes', async (change) => {
    const f = fixtures();
    const fixture = await createIntegrationDatabase(f.driver, f.provision, undefined);
    if (change === 'database') f.connection.db = { ...f.database };
    if (change === 'database name') f.database.databaseName = 'production';
    if (change === 'client') f.connection.getClient.mockReturnValue({});
    if (change === 'disconnected') f.connection.readyState = 0;
    await expect(fixture.clear()).rejects.toThrow('not owned');
    expect(f.database.collections).not.toHaveBeenCalled();
    expect(f.collection.deleteMany).not.toHaveBeenCalled();
    await fixture.close();
    expect(f.driver.disconnect).not.toHaveBeenCalled();
    expect(f.server.stop).toHaveBeenCalledOnce();
    expect(f.database.dropDatabase).not.toHaveBeenCalled();
  });

  it('still stops the owned instance if disconnect fails', async () => {
    const f = fixtures();
    const fixture = await createIntegrationDatabase(f.driver, f.provision, undefined);
    f.driver.disconnect.mockRejectedValueOnce(new Error('disconnect failed'));
    await expect(fixture.close()).rejects.toThrow('disconnect failed');
    expect(f.server.stop).toHaveBeenCalledOnce();
    expect(f.database.dropDatabase).not.toHaveBeenCalled();
  });
});
