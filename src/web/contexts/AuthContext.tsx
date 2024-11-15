import React, { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface AuthContextType {
  token: string | null;
  setToken: (token: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    // Check for token in localStorage on mount
    const storedToken = localStorage.getItem("gmail_agent_token");
    if (storedToken) {
      setTokenState(storedToken);
    } else {
      // Redirect to login if no token
      router.push("/login");
    }
  }, [router]);

  const setToken = (newToken: string) => {
    localStorage.setItem("gmail_agent_token", newToken);
    setTokenState(newToken);
    router.push("/"); // Redirect to home after login
  };

  const logout = () => {
    localStorage.removeItem("gmail_agent_token");
    setTokenState(null);
    router.push(
      "/login?error=" +
        encodeURIComponent("Authentication failed. Please login again.")
    );
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        setToken,
        logout,
        isAuthenticated: !!token,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
