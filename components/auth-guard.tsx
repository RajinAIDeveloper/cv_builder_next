"use client";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const ALLOWED_EMAILS = [
  "infohrplusbd@gmail.com",
  "ultrotech1236@gmail.com",
];

/**
 * Client-side email allowlist guard.
 *
 * Why client-side: the dev machine can't reach Clerk's backend API
 * (server-side `currentUser()` / `clerkClient()` both throw "fetch failed").
 * The browser can reach Clerk just fine, so we read the user via the
 * `useUser` hook (which talks to Clerk from the browser).
 *
 * Defense-in-depth:
 *   1. Clerk Dashboard Allowlist — only the 2 emails can sign in at all.
 *   2. Middleware — blocks unauthenticated requests at the edge.
 *   3. This guard — UX redirect to /blocked for any signed-in user
 *      whose email isn't on the allowlist (belt-and-braces).
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const router = useRouter();

  const email =
    user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? "";
  const isAllowed = isSignedIn && ALLOWED_EMAILS.includes(email);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.replace("/sign-in");
      return;
    }
    if (!ALLOWED_EMAILS.includes(email)) {
      router.replace("/blocked");
    }
  }, [isLoaded, isSignedIn, email, router]);

  if (!isLoaded || !isAllowed) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    );
  }

  return <>{children}</>;
}
