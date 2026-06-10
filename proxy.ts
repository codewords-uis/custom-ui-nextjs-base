import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ALLOWED_ORIGINS = [
  "https://codewords.agemo.ai",
  "https://codewords-staging.agemo.ai",
  "http://localhost:3001",
];

const FRAME_ANCESTORS =
  "'self' *.agemo.ai *.codewords.run *.codewords.click *.ngrok.app *.ngrok.dev localhost:3001";

const isAllowedOrigin = (origin: string | null): boolean => {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (origin.endsWith(".ngrok.app")) return true;
  if (origin.endsWith(".ngrok.dev")) return true;
  if (origin.endsWith(".codewords.run")) return true;
  if (origin.endsWith(".codewords.click")) return true;
  return false;
};

const SKIP_PATHS = ["/_next", "/favicon.ico", "/health", "/api/health", "/api/cw-auth"];

const CODEWORDS_APP_URL =
  process.env.CODEWORDS_APP_URL || "https://codewords.agemo.ai";

// Served to iframe loads with no preview auth. Rather than navigating the
// iframe to the CodeWords login flow (which redirects to the AuthKit domain
// that sets X-Frame-Options and "refuses to connect" inside an iframe), this
// page asks the parent CodeWords app for a one-time key over postMessage. The
// parent already holds the user's session, so the iframe never needs to load
// an auth page itself.
const AUTH_HANDSHAKE_HTML = `<!DOCTYPE html>
<html><head><title>Authenticating...</title></head>
<body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui;color:#666">
<div style="text-align:center">
<p id="cw-auth-msg">Authenticating...</p>
<script>
(function() {
  var projectId = '${process.env.CODEWORDS_PROJECT_ID || ""}' || location.hostname.split('.')[0];
  var grantUrl = '${CODEWORDS_APP_URL}/api/auth/preview-grant?project_id=' + encodeURIComponent(projectId) + '&redirect=' + encodeURIComponent(location.href);
  var done = false;

  // Guard against an infinite handshake loop: if cookies cannot persist in this
  // third-party context (e.g. a browser that blocks third-party cookies and
  // does not support CHIPS), each successful handshake reloads straight back
  // here. Count rapid reloads within a short window; after a few rounds, stop
  // and offer a top-level sign-in instead. The window lets a legitimate re-auth
  // (e.g. after the cookie expires hours later) start fresh.
  var loops = 0;
  var now = Date.now();
  try {
    var prev = JSON.parse(sessionStorage.getItem('cw_auth_loops') || '{}');
    if (prev && typeof prev.t === 'number' && now - prev.t < 15000) {
      loops = prev.n || 0;
    }
  } catch (e) {}

  function showFallback() {
    var msg = document.getElementById('cw-auth-msg');
    if (!msg) return;
    // Open at top level (new tab) — the AuthKit login page cannot be framed.
    msg.innerHTML = 'Sign in to view this preview.<br>' +
      '<a href="' + grantUrl + '" target="_blank" rel="noopener" ' +
      'style="color:#2563eb;display:inline-block;margin-top:8px">Open preview &rarr;</a>';
  }

  if (loops >= 3) { showFallback(); return; }
  try { sessionStorage.setItem('cw_auth_loops', JSON.stringify({ n: loops + 1, t: now })); } catch (e) {}

  function requestToken() {
    try { window.parent.postMessage({ type: 'cw-auth-request', projectId: projectId }, '*'); } catch (e) {}
  }

  window.addEventListener('message', function(e) {
    if (done) return;
    if (e.data && e.data.type === 'cw-auth-token' && e.data.otk) {
      done = true;
      var url = new URL(location.href);
      url.searchParams.set('cw_otk', e.data.otk);
      location.href = url.toString();
    }
  });

  // Retry the request: the parent's message listener may attach slightly after
  // this iframe loads, so a single fire-and-forget can be missed.
  requestToken();
  var attempts = 0;
  var poll = setInterval(function() {
    attempts++;
    if (done) { clearInterval(poll); return; }
    if (attempts > 8) { clearInterval(poll); showFallback(); return; }
    requestToken();
  }, 700);
})();
</script>
</div></body></html>`;

export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  if (SKIP_PATHS.some((p) => pathname.startsWith(p))) {
    return addSecurityHeaders(NextResponse.next(), request);
  }

  // Handle preflight
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS" && origin && isAllowedOrigin(origin)) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods":
          "GET, HEAD, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const previewAuth = process.env.CODEWORDS_PREVIEW_AUTH;

  // No preview auth configured → sandbox token check or public access
  if (!previewAuth) {
    const accessToken = process.env.CODEWORDS_ACCESS_TOKEN;

    // No access token configured → fully public (production deployments)
    if (!accessToken) {
      return addSecurityHeaders(NextResponse.next(), request);
    }

    // Access token IS configured (sandbox) → require valid token
    const queryToken = searchParams.get("cw_token");
    if (queryToken === accessToken) {
      const cleanUrl = request.nextUrl.clone();
      cleanUrl.searchParams.delete("cw_token");
      const response = NextResponse.redirect(cleanUrl);
      response.cookies.set("cw_access", accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        // CHIPS — the sandbox preview runs in a third-party iframe; without
        // Partitioned the cookie is dropped by third-party cookie blocking.
        partitioned: true,
        path: "/",
        maxAge: 60 * 60 * 24,
      });
      return addSecurityHeaders(response, request);
    }

    const cookieToken = request.cookies.get("cw_access")?.value;
    if (cookieToken === accessToken) {
      return addSecurityHeaders(NextResponse.next(), request);
    }

    // No valid token → block access
    return addSecurityHeaders(
      new NextResponse("Unauthorized", { status: 401 }),
      request
    );
  }

  // === Preview auth flow ===

  // 1. Check cw_preview cookie
  const previewCookie = request.cookies.get("cw_preview")?.value;
  if (previewCookie === "1") {
    return addSecurityHeaders(NextResponse.next(), request);
  }

  // 2. Check cw_token (sandbox dev access from Cody's canvas_preview)
  const accessToken = process.env.CODEWORDS_ACCESS_TOKEN;
  if (accessToken) {
    const queryToken = searchParams.get("cw_token");
    if (queryToken === accessToken) {
      const cleanUrl = request.nextUrl.clone();
      cleanUrl.searchParams.delete("cw_token");
      const response = NextResponse.redirect(cleanUrl);
      response.cookies.set("cw_access", accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        // CHIPS — see note above; required for third-party iframe persistence.
        partitioned: true,
        path: "/",
        maxAge: 60 * 60 * 24,
      });
      return addSecurityHeaders(response, request);
    }

    const cookieToken = request.cookies.get("cw_access")?.value;
    if (cookieToken === accessToken) {
      return addSecurityHeaders(NextResponse.next(), request);
    }
  }

  // 3. Check cw_otk (one-time key from preview-grant redirect)
  const otk = searchParams.get("cw_otk");
  if (otk) {
    // Validate OTK via ui-builder through runtime
    const runtimeUri = process.env.CODEWORDS_RUNTIME_URI;
    const projectId = process.env.CODEWORDS_PROJECT_ID || request.nextUrl.hostname.split(".")[0];

    if (runtimeUri) {
      const verifyRedirect = new URL("/api/cw-auth", request.nextUrl.origin);
      verifyRedirect.searchParams.set("otk", otk);
      verifyRedirect.searchParams.set("project_id", projectId);
      verifyRedirect.searchParams.set(
        "redirect",
        (() => {
          const cleanUrl = request.nextUrl.clone();
          cleanUrl.searchParams.delete("cw_otk");
          return cleanUrl.toString();
        })()
      );
      return NextResponse.redirect(verifyRedirect);
    }
  }

  // 4. No auth — serve handshake page for iframes, redirect for browsers
  const accept = request.headers.get("accept") || "";
  const isIframe = request.headers.get("sec-fetch-dest") === "iframe";

  if (isIframe) {
    return addSecurityHeaders(
      new NextResponse(AUTH_HANDSHAKE_HTML, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
      request
    );
  }

  if (!accept.includes("text/html")) {
    return addSecurityHeaders(
      new NextResponse("Unauthorized", { status: 401 }),
      request
    );
  }

  // Browser direct access → redirect to CodeWords login
  const projectId = process.env.CODEWORDS_PROJECT_ID || request.nextUrl.hostname.split(".")[0];
  const grantUrl = new URL(
    "/api/auth/preview-grant",
    CODEWORDS_APP_URL
  );
  grantUrl.searchParams.set("project_id", projectId);
  grantUrl.searchParams.set("redirect", request.nextUrl.toString());
  return NextResponse.redirect(grantUrl.toString());
}

function addSecurityHeaders(
  response: NextResponse,
  request: NextRequest
): NextResponse {
  const origin = request.headers.get("origin");

  if (origin && isAllowedOrigin(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set(
      "Access-Control-Allow-Methods",
      "GET, HEAD, POST, PUT, DELETE, OPTIONS"
    );
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );
  }

  response.headers.set(
    "Content-Security-Policy",
    `frame-ancestors ${FRAME_ANCESTORS}`
  );

  return response;
}

export const config = {
  matcher: "/:path*",
};
