import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const basicAuth = req.headers.get('authorization');

  if (basicAuth) {
    const authValue = basicAuth.split(' ')[1];
    const [user, pwd] = atob(authValue).split(':');

    const validUser = process.env.CLIENT_USER || 'admin';
    const validPass = process.env.CLIENT_PASS || 'Secret123!';

    if (user === validUser && pwd === validPass) {
      return NextResponse.next();
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Access"',
    },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
