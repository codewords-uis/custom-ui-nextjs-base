"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.parent === window) return;
    try {
      window.parent.postMessage(
        {
          type: "cw-route-error",
          message: (error?.message ?? "").slice(0, 200),
          digest: error?.digest ?? null,
          global: true,
        },
        "*",
      );
    } catch {
      // Ignore — parent may be cross-origin and reject postMessage
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#020008",
          color: "rgba(255,255,255,0.85)",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        }}
      >
        <div style={{ textAlign: "center", padding: "0 1rem" }}>
          <h1 style={{ fontSize: "1rem", fontWeight: 500 }}>
            Something went wrong
          </h1>
          <p
            style={{
              maxWidth: "24rem",
              fontSize: "0.875rem",
              color: "rgba(255,255,255,0.6)",
              margin: "0.5rem auto 1rem",
            }}
          >
            Try again in a moment.
          </p>
          <button
            onClick={reset}
            style={{
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(255,255,255,0.05)",
              color: "rgba(255,255,255,0.8)",
              padding: "0.375rem 1rem",
              fontFamily: "inherit",
              fontSize: "0.875rem",
              borderRadius: "0.375rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
