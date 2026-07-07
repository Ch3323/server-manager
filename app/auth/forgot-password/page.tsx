"use client";

import { useState } from "react";
import Link from "next/link";

import { showErrorToast, showSuccessToast } from "@/lib/client-notify";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        throw new Error("Failed to request password reset");
      }

      setSent(true);
      showSuccessToast("If the account exists, a reset link has been sent.");
    } catch (err) {
      showErrorToast(err, "Failed to request password reset");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Forgot Password</CardTitle>
          <CardDescription>Enter your email and we will send a reset link.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sent ? (
            <p className="text-sm text-muted-foreground">
              If the account exists, a reset link has been sent.
            </p>
          ) : (
            <form className="space-y-4" onSubmit={(event) => void submit(event)}>
              <Input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                type="email"
                disabled={isLoading}
              />
              <Button className="w-full" type="submit" disabled={isLoading || !email.trim()}>
                {isLoading ? "Sending..." : "Send reset link"}
              </Button>
            </form>
          )}
          <Button variant="outline" className="w-full" asChild>
            <Link href="/auth/login">Back to login</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
