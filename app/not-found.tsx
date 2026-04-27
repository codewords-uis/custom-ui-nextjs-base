"use client";

import { useEffect } from "react";
import Image from "next/image";

export default function NotFound() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.parent === window) return;
    try {
      window.parent.postMessage(
        {
          type: "cw-route-not-found",
          path: window.location.pathname,
        },
        "*",
      );
    } catch {
      // Ignore — parent may be cross-origin and reject postMessage
    }
  }, []);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#020008]">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: 0.25,
          background: `radial-gradient(
            ellipse 200% 100% at 50% 100%,
            #020101 0%,
            #0a0402 10%,
            #200a04 18%,
            #501808 24%,
            #a03010 30%,
            #e05020 34%,
            #ff8040 38%,
            #ffb070 42%,
            #ffd0a0 46%,
            #e0a0c0 50%,
            #b060a0 54%,
            #8a3090 58%,
            #6b2080 62%,
            #4a1a6b 68%,
            #2d1054 75%,
            #1a0a3d 84%,
            #0a0020 92%,
            #020008 100%
          )`,
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-4 px-4 text-center">
        <Image
          src="/codewords-asterisk.svg"
          alt=""
          width={40}
          height={40}
          aria-hidden="true"
          className="opacity-80"
        />
        <h1 className="font-mono text-base text-white/90">Page not found</h1>
        <p className="max-w-sm font-mono text-sm text-white/60">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
      </div>
    </div>
  );
}
