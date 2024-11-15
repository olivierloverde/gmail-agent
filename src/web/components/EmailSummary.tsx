import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

interface EmailSummaryProps {
  summary: {
    type: string;
    timestamp: string;
    overview: string;
    priorityEmails: Array<{
      sender: string;
      subject: string;
      priority: string;
      action: string;
    }>;
    insights: string[];
  };
}

export function EmailSummary({ summary }: EmailSummaryProps) {
  return (
    <Card className="w-full max-w-4xl mx-auto my-4">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle>
            {summary.type} Summary
            <Badge variant="outline" className="ml-2">
              {formatDistanceToNow(new Date(summary.timestamp), {
                addSuffix: true,
              })}
            </Badge>
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <section>
            <h3 className="font-semibold mb-2">Overview</h3>
            <p className="text-muted-foreground">{summary.overview}</p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Priority Emails</h3>
            <div className="space-y-2">
              {summary.priorityEmails.map((email, index) => (
                <div key={index} className="border rounded-lg p-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">{email.sender}</p>
                      <p className="text-sm text-muted-foreground">
                        {email.subject}
                      </p>
                    </div>
                    <Badge
                      variant={
                        email.priority === "High" ? "destructive" : "default"
                      }
                    >
                      {email.priority}
                    </Badge>
                  </div>
                  <p className="text-sm mt-2">{email.action}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Key Insights</h3>
            <ul className="list-disc list-inside space-y-1">
              {summary.insights.map((insight, index) => (
                <li key={index} className="text-muted-foreground">
                  {insight}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </CardContent>
    </Card>
  );
}
