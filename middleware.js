import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const basicAuth = req.headers.get('authorization');

  if (basicAuth && basicAuth.startsWith('Basic ')) {
    try {
      const authValue = basicAuth.split(' ')[1];
      // Use Buffer which is safer in Node/Edge environments
      const decoded = Buffer.from(authValue, 'base64').toString('utf-8');
      const [user, pwd] = decoded.split(':');

      const validUser = process.env.CLIENT_USER || 'client';
      const validPass = process.env.CLIENT_PASS || 'SecretPass123!';

      if (user === validUser && pwd === validPass) {
        return NextResponse.next();
      }
    } catch {
      // In case decoding fails, fall through to prompt again
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
