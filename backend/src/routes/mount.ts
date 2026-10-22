import type { Express, Router } from 'express';
import { API_BASE_PATH } from '../config/constants.js';

export function mountApiRoutes(app: Express, routes: Router): void {
  // Handle versioned requests first so /api does not run their middleware twice.
  app.use(API_BASE_PATH, routes);
  app.use('/api', (req, res, next) => {
    if (req.path === '/v1' || req.path.startsWith('/v1/')) return next();
    res.setHeader('X-API-Deprecation-Warning', 'The unversioned /api endpoints are deprecated and will be removed in a future release. Please migrate to /api/v1.');
    return routes(req, res, next);
  });
}
