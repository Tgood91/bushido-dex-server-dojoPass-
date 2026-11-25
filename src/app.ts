import express from 'express';
import { dojoPassRouter } from './routes.js';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true); // Render terminates TLS: req.protocol must read X-Forwarded-Proto
app.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*'); // public, read-only metadata
  next();
});
app.use(dojoPassRouter);
