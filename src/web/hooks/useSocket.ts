import { useEffect, useRef } from "react";
import io, { Socket } from "socket.io-client";
import { useAuth } from "@/contexts/AuthContext";

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const { token, isAuthenticated, logout } = useAuth();

  useEffect(() => {
    if (!isAuthenticated || !token) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    socketRef.current = io("http://localhost:3001", {
      auth: {
        token,
      },
      withCredentials: true,
      transports: ["websocket", "polling"],
    });

    socketRef.current.on("connect", () => {
      console.log("Socket connected");
    });

    socketRef.current.on("connect_error", (error) => {
      console.error("Socket connection error:", error);
      if (error.message === "Authentication error") {
        logout();
      }
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [token, isAuthenticated, logout]);

  return socketRef.current;
}
