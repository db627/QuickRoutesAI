import { enqueueWrite, flushQueue, getQueueSize } from '../services/offlineQueue';

jest.mock('../config/firebase', () => ({
  firestore: {},
}));

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  setDoc: jest.fn().mockResolvedValue(undefined),
}));

describe('offlineQueue', () => {
  beforeEach(() => {
    // Clear queue between tests
    while (getQueueSize() > 0) {
      flushQueue();
    }
  });

  it('queues a write correctly', () => {
    enqueueWrite('drivers', 'user123', { isOnline: true });
    expect(getQueueSize()).toBe(1);
  });

  it('queue size increases with multiple writes', () => {
    enqueueWrite('drivers', 'user123', { isOnline: true });
    enqueueWrite('drivers', 'user123', { isOnline: false });
    expect(getQueueSize()).toBe(2);
  });

  it('flushes queue and clears it', async () => {
    enqueueWrite('drivers', 'user123', { isOnline: true });
    await flushQueue();
    expect(getQueueSize()).toBe(0);
  });

  it('queue is empty initially', () => {
    expect(getQueueSize()).toBe(0);
  });
});