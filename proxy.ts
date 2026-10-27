import { NextResponse, type NextRequest } from "next/server";

// Cookie-presence check only; real session validation happens in requireUser()
// inside each Route Handler.
export function proxy(request: NextRequest) {
  if (request.cookies.has("session")) {
    return NextResponse.next();
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|login).*)"],
};
