```js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

// ============================================================
// ACCESS CONTROL
// ============================================================

const SECRET = process.env.CLIENT_PASS || 'Ramupass2026';

function getAccessCookie(req) {
  const cookies = req.headers.cookie || '';

  const cookie = cookies
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('access_token='));

  if (!cookie) return null;

  return decodeURIComponent(
    cookie.substring('access_token='.length)
  );
}

// ============================================================
// SERVER
// ============================================================

const server = http.createServer((req, res) => {

  const parsedUrl = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  let reqPath = parsedUrl.pathname;

  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  // ==========================================================
  // ACCESS CHECK
  // ==========================================================

  const queryToken = parsedUrl.searchParams.get('token');
  const cookieToken = getAccessCookie(req);

  // 1. Authorized link:
  //    /?token=YOUR_TOKEN
  //
  //    Set access cookie and redirect to clean URL.
  if (queryToken === SECRET) {

    res.writeHead(302, {
      'Set-Cookie':
        `access_token=${encodeURIComponent(SECRET)}; ` +
        `Path=/; ` +
        `HttpOnly; ` +
        `Secure; ` +
        `SameSite=Lax; ` +
        `Max-Age=604800`,

      'Location': reqPath
    });

    return res.end();
  }

  // 2. Allow access if the correct cookie already exists.
  const hasAccess =
    cookieToken === SECRET;

  // 3. Block HTML pages when the customer is not authorized.
  const isHtml =
    reqPath.endsWith('.html');

  if (isHtml && !hasAccess) {

    res.writeHead(403, {
      'Content-Type': 'text/html; charset=utf-8'
    });

    return res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        >
        <title>Bikri Hub - Access Denied</title>
      </head>

      <body style="
        font-family: Arial, sans-serif;
        text-align: center;
        padding: 60px 20px;
      ">

        <h2>Access Denied</h2>

        <p>
          Please use your authorized Bikri Hub access link.
        </p>

      </body>
      </html>
    `);
  }

  // ==========================================================
  // EXISTING BIKRI HUB FILE SERVER
  // ==========================================================

  const filePath = path.join(__dirname, reqPath);
  const ext = path.extname(filePath).toLowerCase();

  fs.readFile(filePath, (err, content) => {

    if (err) {

      if (err.code === 'ENOENT') {

        res.writeHead(404, {
          'Content-Type': 'text/plain; charset=utf-8'
        });

        res.end('404 Not Found');

      } else {

        res.writeHead(500, {
          'Content-Type': 'text/plain; charset=utf-8'
        });

        res.end('500 Server Error');
      }

    } else {

      res.writeHead(200, {

        'Content-Type':
          MIME_TYPES[ext] ||
          'application/octet-stream',

        'Cache-Control':
          'no-cache, no-store, must-revalidate',

        'Pragma': 'no-cache',

        'Expires': '0'
      });

      res.end(content);
    }
  });
});

// ============================================================
// START SERVER
// ============================================================

server.listen(PORT, '127.0.0.1', () => {

  console.log(
    `Bikri Hub local server running at http://localhost:${PORT}/`
  );

});
```
