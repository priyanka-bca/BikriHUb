import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const token = url.searchParams.get('token');
  const cookie = req.cookies.get('access_token')?.value;

  // Set the secret key here (or read from process.env.CLIENT_PASS)
  const SECRET = process.env.CLIENT_PASS || 'Ramupass2026';

  // 1. If Ramu clicks the link with ?token=..., save cookie & redirect to clean URL
  if (token === SECRET) {
    const cleanUrl = new URL(url.pathname, req.url);
    const response = NextResponse.redirect(cleanUrl);
    response.cookies.set('access_token', SECRET, {
      path: '/',
      httpOnly: true,
      secure: true,
      maxAge: 60 * 60 * 24 * 7, // keeps him logged in for 7 days
    });
    return response;
  }

  // 2. If cookie exists and matches, let him in
  if (cookie === SECRET) {
    return NextResponse.next();
  }

  // 3. Otherwise, block access
  return new NextResponse('Access Denied. A valid access link is required.', {
    status: 403,
    headers: { 'Content-Type': 'text/plain' },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
