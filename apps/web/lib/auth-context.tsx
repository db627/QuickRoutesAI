"use client";

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { onAuthStateChanged, User, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, firestore } from "./firebase";
import type { UserRole } from "@quickroutesai/shared";

interface AuthState {
  user: User | null;
  role: UserRole | null;
  orgId: string | null;
  loading: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  role: null,
  orgId: null,
  loading: true,
  logout: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const readProfile = useCallback(async (firebaseUser: User) => {
    const userDoc = await getDoc(doc(firestore, "users", firebaseUser.uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      setRole((data.role as UserRole) ?? null);
      setOrgId((data.orgId as string | undefined) ?? null);
    } else {
      setRole(null);
      setOrgId(null);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        await readProfile(firebaseUser);
      } else {
        setUser(null);
        setRole(null);
        setOrgId(null);
      }
      setLoading(false);
    });
    return unsub;
  }, [readProfile]);

  const logout = async () => {
    await signOut(auth);
  };

  const refresh = useCallback(async () => {
    if (auth.currentUser) {
      await readProfile(auth.currentUser);
    }
  }, [readProfile]);

  return (
    <AuthContext.Provider value={{ user, role, orgId, loading, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
