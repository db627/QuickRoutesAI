import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, firestore } from "../config/firebase";
import type { UserRole } from "@quickroutesai/shared";

interface AuthState {
  user: User | null;
  role: UserRole | null;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ user: null, role: null, loading: true });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const userDoc = await getDoc(doc(firestore, "users", user.uid));
        const role = userDoc.exists() ? (userDoc.data().role as UserRole) : null;
        setState({ user, role, loading: false });
      } else {
        setState({ user: null, role: null, loading: false });
      }
    });
    return unsub;
  }, []);

  return state;
}
