import React from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Layout } from "@/components/Layout";
import { EmailSummary } from "@/components/EmailSummary";
import { useSocket } from "@/hooks/useSocket";
import { useAuth } from "@/contexts/AuthContext";

export default function Home() {
  const [summaries, setSummaries] = React.useState<any[]>([]);
  const { isAuthenticated } = useAuth();
  const socket = useSocket();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/login");
    }
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (!socket) return;

    socket.on("summary", (summary: any) => {
      setSummaries((prev) => [summary, ...prev]);
    });

    return () => {
      socket.off("summary");
    };
  }, [socket]);

  if (!isAuthenticated) {
    return null;
  }

  return (
    <Layout>
      <div className="space-y-6">
        {summaries.map((summary, index) => (
          <EmailSummary key={index} summary={summary} />
        ))}
        {summaries.length === 0 && (
          <div className="text-center text-muted-foreground">
            No summaries available yet
          </div>
        )}
      </div>
    </Layout>
  );
}
