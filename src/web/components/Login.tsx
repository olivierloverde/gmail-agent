import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useSearchParams } from "next/navigation";
import { createToken } from "@/lib/jwt";

export function Login() {
  const [userId, setUserId] = useState("");
  const [jwtSecret, setJwtSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { setToken } = useAuth();
  const searchParams = useSearchParams();

  useEffect(() => {
    const errorMessage = searchParams.get("error");
    if (errorMessage) {
      setError(decodeURIComponent(errorMessage));
    }
  }, [searchParams]);

  const handleLogin = () => {
    try {
      if (!userId.trim() || !jwtSecret.trim()) {
        setError("Please enter both User ID and JWT Secret");
        return;
      }

      // Create JWT token
      const token = createToken(userId.trim(), jwtSecret.trim());

      setError(null);
      setToken(token);
    } catch (error) {
      console.error("Login error:", error);
      setError("Failed to create authentication token");
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Gmail Agent Web Interface</CardTitle>
          <CardDescription>
            Enter your credentials to connect to the Gmail Agent
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="Enter your Telegram User ID"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <input
                type="password"
                value={jwtSecret}
                onChange={(e) => setJwtSecret(e.target.value)}
                placeholder="Enter your JWT Secret"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <p className="text-sm text-muted-foreground">
                The JWT Secret can be found in your .env file as JWT_SECRET
              </p>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <Button onClick={handleLogin} className="w-full">
              Connect
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
