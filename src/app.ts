import path from 'node:path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import config from './config';
import apiRoutes from './routes';
import { requestLimit } from './shared/http/rateLimitMiddleware';

const { DIST_DIR } = config.env;
const { APPLICATION_URL } = config.auth;
const { TRUST_PROXY } = config.http;

const app = express();

app.set('trust proxy', TRUST_PROXY);
app.use(requestLimit);
app.use(cors({ origin: APPLICATION_URL, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use('/api', apiRoutes);

app.use(express.static(DIST_DIR));
app.get('{*splat}', (_req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

export = app;
