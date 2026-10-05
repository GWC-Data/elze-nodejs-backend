import path from 'path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import config from './config';
import apiRoutes from './routes';

const { DIST_DIR } = config.env;
const { APPLICATION_URL } = config.auth;

const app = express();

app.use(cors({ origin: APPLICATION_URL, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use('/api', apiRoutes);

app.use(express.static(DIST_DIR));
app.get('{*splat}', (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

export = app;
