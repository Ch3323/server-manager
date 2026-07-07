"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { showErrorToast, showSuccessToast } from "@/lib/client-notify";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function ResetPasswordPage() {
  const params = useSearchParams();
  const token = useMemo(() => params.get("token") ?? "", [params]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function submit() {
    if (password.length < 8) {
      showErrorToast(
        new Error("Password must be at least 8 characters"),
        "Password must be at least 8 characters"
      );
      return;
    }

    if (password !== confirmPassword) {
      showErrorToast(new Error("Passwords do not match"), "Passwords do not match");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to reset password");
      }

      setSuccess(true);
      showSuccessToast("Password reset successfully");
    } catch (err) {
      showErrorToast(err, "Failed to reset password");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Reset Password</CardTitle>
          <CardDescription>Create a new password for your account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!token ? (
            <p className="text-sm text-destructive">Reset token is missing.</p>
          ) : success ? (
            <p className="text-sm text-muted-foreground">Your password has been reset.</p>
          ) : (
            <>
              <Input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="New password"
                type="password"
                minLength={8}
                disabled={isLoading}
              />
              <Input
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Confirm password"
                type="password"
                minLength={8}
                disabled={isLoading}
              />
              <Button className="w-full" onClick={() => void submit()} disabled={isLoading || !password || !confirmPassword}>
                {isLoading ? "Saving..." : "Reset password"}
              </Button>
            </>
          )}
          <Button variant="outline" className="w-full" asChild>
            <Link href="/auth/login">Back to login</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
