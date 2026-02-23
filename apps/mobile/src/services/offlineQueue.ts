import {doc, setDoc} from "firebase/firestore";
import { firestore } from "../config/firebase";

interface QueuedWrite {
    path: string;
    docId: string;
    data: Record<string, any>;
    merge: boolean;
}

const queue: QueuedWrite[] = [];

export function enqueueWrite(
    path: string,
    docId: string,
    data: Record<string, any>,
    merge = true
) {
    queue.push({path, docId, data, merge});
    // Remove later
    console.log(`[OfflineQueue] Queued write to ${path}/${docId}. Queue size: ${queue.length}`);
}

export async function flushQueue() {
  if (queue.length === 0) return;
  console.log(`[OfflineQueue] Flushing ${queue.length} queued writes...`);

  const toFlush = [...queue];
  queue.length = 0;

  for (const write of toFlush) {
    try {
      await setDoc(
        doc(firestore, write.path, write.docId),
        write.data,
        { merge: write.merge }
      );
      console.log(`[OfflineQueue] Wrote to ${write.path}/${write.docId}`);
    } catch (err) {
      console.error(`[OfflineQueue] Failed ${write.path}/${write.docId}:`, err);
      queue.unshift(write);
    }
  }
}

export function getQueueSize() {
  return queue.length;
}