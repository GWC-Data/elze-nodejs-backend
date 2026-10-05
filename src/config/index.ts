// Each section loads on first access, as before: a script that only needs `env` never
// validates the SMTP or JWT settings. The require calls stay require for that reason.
interface Config {
  readonly env: typeof import('./env');
  readonly app: typeof import('./appConfig');
  readonly auth: typeof import('./auth');
  readonly email: typeof import('./email');
  readonly database: typeof import('./database');
  readonly engine: typeof import('./engine');
  readonly context: typeof import('./context');
}

const MODULES: Record<keyof Config, string> = {
  env: './env',
  app: './appConfig',
  auth: './auth',
  email: './email',
  database: './database',
  engine: './engine',
  context: './context',
};

const config = {} as Config;
for (const [name, file] of Object.entries(MODULES)) {
  Object.defineProperty(config, name, {
    enumerable: true,
    get: () => require(file),
  });
}

export = config;
