import admin from "firebase-admin";
import type { PaginationOptions } from "../middleware/pagination";

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  hasMore: boolean;
  nextCursor?: string;
}

type FirestoreQuery = admin.firestore.Query;

type CursorPayload = {
  orderValue: string | number;
  id: string; // document id tie-breaker
};

export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeCursor(token: string): CursorPayload {
  let parsed: unknown;

  try {
    const json = Buffer.from(token, "base64url").toString("utf8");
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid cursor encoding.");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as any).id !== "string" ||
    ((parsed as any).orderValue == null || (typeof (parsed as any).orderValue !== "string" && typeof (parsed as any).orderValue !== "number"))
  ) {
    throw new Error("Invalid cursor payload.");
  }

  return parsed as CursorPayload;
}

/**
 * Paginate a Firestore query in a performant way.
 *
 * IMPORTANT:
 * - Provide a stable `orderField` that exists on documents.
 * - For cursor-mode stability, we add a tie-breaker ordering on documentId.
 *
 * Example usage (trips):
 *   const base = db.collection("trips").where(...);
 *   const result = await paginateFirestore(base, req.pagination!, { orderField: "createdAt", orderDirection: "desc" });
 */
export async function paginateFirestore<T>(
  baseQuery: FirestoreQuery,
  options: PaginationOptions,
  config: {
    orderField: string; // e.g., "createdAt" or "updatedAt"
    orderDirection?: admin.firestore.OrderByDirection; // "asc" | "desc"
  },
): Promise<PaginatedResponse<T>> {
  const orderField = config.orderField;
  const orderDirection = config.orderDirection ?? "desc";

  // Count total *without* limit/offset/startAfter applied.
  // (baseQuery should include filters, but not pagination yet)
  const countSnap = await baseQuery.count().get();

  const total = countSnap.data().count;

  // Apply stable ordering:
  // 1) primary orderField
  // 2) doc id tie-breaker so cursor pagination is deterministic
  let ordered;
  if((baseQuery instanceof admin.firestore.CollectionReference) === false) {
    
    ordered = baseQuery.orderBy(admin.firestore.FieldPath.documentId(), orderDirection);
  }else{
    ordered = baseQuery.orderBy(orderField, orderDirection).orderBy(admin.firestore.FieldPath.documentId(), orderDirection);
  }
  
  // Cursor-mode
  if (options.mode === "cursor") {
    const payload = decodeCursor(options.cursor);

    // Fetch limit + 1 so hasMore is accurate (without extra queries).
    const snap = await ordered.startAfter(payload.orderValue, payload.id).limit(options.limit + 1).get();

    const docs = snap.docs;
    const hasMore = docs.length > options.limit;

    const pageDocs = hasMore ? docs.slice(0, options.limit) : docs;

    const data = pageDocs.map((d) => ({ id: d.id, ...d.data() })) as unknown as T[];

    let nextCursor: string | undefined;
    if (hasMore && pageDocs.length > 0) {
      const last = pageDocs[pageDocs.length - 1];
      const lastData = last.data() as Record<string, any>;
      const lastOrderValue = lastData[orderField];

      // If orderField is missing, cursor cannot be generated reliably
      if (lastOrderValue == null) {
        throw new Error(`Cannot generate nextCursor: '${orderField}' missing on document ${last.id}.`);
      }

      nextCursor = encodeCursor({ orderValue: lastOrderValue, id: last.id });
    }

    return {
      data,
      total,
      page: options.page, // always 1 for cursor-mode from middleware
      hasMore,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  // Page-mode (offset)
  const offset = (options.page - 1) * options.limit;

  // Firestore offset can be inefficient for very large offsets, but required by ticket.
  // We only fetch the requested page.
  const snap = await ordered.offset(offset).limit(options.limit).get();

  const data = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as unknown as T[];

  const hasMore = options.page * options.limit < total;

  return {
    data,
    total,
    page: options.page,
    hasMore,
  };
}