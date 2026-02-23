import { doc, setDoc } from "firebase/firestore";
import { firestore } from "../config/firebase";

interface QueuedWrite {
  path: string;
  docId: string;
  data: Record<string, any>;
  merge: boolean;
}

const queue: QueuedWrite[] = [];
let optimisticOnlineStatus: boolean | null = null;

// --- simple listeners (no extra libs) ---
type Listener<T> = (value: T) => void;

const queueSizeListeners = new Set<Listener<number>>();
const optimisticListeners = new Set<Listener<boolean | null>>();

function emitQueueSize() {
  const size = queue.length;
  queueSizeListeners.forEach((cb) => cb(size));
}

function emitOptimistic() {
  optimisticListeners.forEach((cb) => cb(optimisticOnlineStatus));
}

export function subscribeQueueSize(cb: Listener<number>) {
  queueSizeListeners.add(cb);
  cb(queue.length); // immediately emit current value
  return () => {
    queueSizeListeners.delete(cb); // cleanup must return void
  };
}

export function subscribeOptimisticOnlineStatus(cb: Listener<boolean | null>) {
  optimisticListeners.add(cb);
  cb(optimisticOnlineStatus); // immediately emit current value
  return () => {
    optimisticListeners.delete(cb); // cleanup must return void
  };
}

export function enqueueWrite(
  path: string,
  docId: string,
  data: Record<string, any>,
  merge = true
) {
  queue.push({ path, docId, data, merge });
  console.log(
    `[OfflineQueue] Queued write to ${path}/${docId}. Queue size: ${queue.length}`
  );
  emitQueueSize();
}

export async function flushQueue() {
  if (queue.length === 0) return;

  console.log(`[OfflineQueue] Flushing ${queue.length} queued writes...`);

  const toFlush = [...queue];
  queue.length = 0;
  emitQueueSize();

  // once we start flushing, the optimistic override should be cleared
  optimisticOnlineStatus = null;
  emitOptimistic();

  for (const write of toFlush) {
    try {
      await setDoc(doc(firestore, write.path, write.docId), write.data, {
        merge: write.merge,
      });
      console.log(`[OfflineQueue] Wrote to ${write.path}/${write.docId}`);
    } catch (err) {
      console.error(`[OfflineQueue] Failed ${write.path}/${write.docId}:`, err);
      queue.unshift(write);
      emitQueueSize();
      // stop early; we'll retry next time connection is back
      return;
    }
  }
}

export function getQueueSize() {
  return queue.length;
}

export function setOptimisticOnlineStatus(status: boolean | null) {
  optimisticOnlineStatus = status;
  emitOptimistic();
}

export function getOptimisticOnlineStatus(): boolean | null {
  return optimisticOnlineStatus;
}