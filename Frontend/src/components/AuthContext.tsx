"use client";

import React, { createContext, useContext } from "react";

export type AppRole = "owner" | "admin" | "operator" | "viewer";

export type AppUser = {
  id: string;
  email?: string | null;
  role: AppRole;
  active: boolean;
};

type AuthContextValue = {
  user: AppUser | null;
  canAdmin: boolean;
  canOperate: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  canAdmin: false,
  canOperate: false,
});

export function AuthContextProvider({
  value,
  children,
}: {
  value: AuthContextValue;
  children: React.ReactNode;
}) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
