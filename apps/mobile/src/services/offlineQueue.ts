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
  cb(queue.length);
  return () => {
    queueSizeListeners.delete(cb);
  };
}

export function subscribeOptimisticOnlineStatus(cb: Listener<boolean | null>) {
  optimisticListeners.add(cb);
  cb(optimisticOnlineStatus); 
  return () => {
    optimisticListeners.delete(cb); 
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