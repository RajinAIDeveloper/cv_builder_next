"use client";
import { useClerk } from "@clerk/nextjs";

export default function BlockedPage() {
  const { signOut } = useClerk();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center space-y-4 max-w-sm">
        <h1 className="text-2xl font-semibold text-gray-900">Access Denied</h1>
        <p className="text-gray-500 text-sm">
          Your account is not authorised to use this tool. Contact{" "}
          <a href="mailto:infohrplusbd@gmail.com" className="underline">
            infohrplusbd@gmail.com
          </a>{" "}
          if you believe this is a mistake.
        </p>
        <button
          type="button"
          onClick={() => signOut({ redirectUrl: "/sign-in" })}
          className="mt-4 px-4 py-2 bg-gray-900 text-white rounded text-sm hover:bg-gray-700 transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
