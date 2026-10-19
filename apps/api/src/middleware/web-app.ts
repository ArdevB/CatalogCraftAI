import path from 'node:path';
import express, { Router } from 'express';
import helmet from 'helmet';

/**
 * Serves the built web app from the API (`WEB_DIST_DIR`), so a single service
 * hosts both on one origin: cookies stay first-party and there is no CORS to
 * configure. Any path that isn't a file or under /api gets index.html, so the
 * browser router can handle it.
 */
export function webAppRouter(distDir: string): Router {
  const router = Router();

  // The page's own policy: only scripts, styles and requests from this origin.
  router.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          // React sets a few inline style attributes (e.g. progress bar widths).
          styleSrcAttr: ["'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );

  // Hashed build files never change, so browsers may cache them for a year.
  router.use(
    '/assets',
    express.static(path.join(distDir, 'assets'), { immutable: true, maxAge: '365d', index: false }),
  );
  // A missing build file (e.g. an old cached page asking for a replaced asset) is a 404, never index.html.
  router.use('/assets', (_req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });
  router.use(express.static(distDir, { index: false, maxAge: '1h' }));

  const indexFile = path.join(distDir, 'index.html');
  router.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    // Always revalidate the page itself so a new deploy is picked up straight away.
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });

  return router;
}
