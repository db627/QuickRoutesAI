import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../config/firebase";

export interface UploadProgress {
  uploaded: number;
  total: number;
}

/**
 * Upload a local photo URI to Firebase Storage under
 * trips/{tripId}/stops/{stopId}/{timestamp}-{index}.jpg and return the download URL.
 */
async function uploadOne(
  tripId: string,
  stopId: string,
  localUri: string,
  index: number,
): Promise<string> {
  const response = await fetch(localUri);
  const blob = await response.blob();
  const filename = `${Date.now()}-${index}.jpg`;
  const path = `trips/${tripId}/stops/${stopId}/${filename}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
  return getDownloadURL(storageRef);
}

/**
 * Upload a batch of local photo URIs. Returns the download URLs in the same
 * order as the input. Fails fast if any upload fails.
 */
export async function uploadStopPhotos(
  tripId: string,
  stopId: string,
  localUris: string[],
  onProgress?: (p: UploadProgress) => void,
): Promise<string[]> {
  const urls: string[] = [];
  for (let i = 0; i < localUris.length; i++) {
    const url = await uploadOne(tripId, stopId, localUris[i], i);
    urls.push(url);
    onProgress?.({ uploaded: i + 1, total: localUris.length });
  }
  return urls;
}
