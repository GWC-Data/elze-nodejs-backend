const STATUS = { available: 'available', planned: 'planned' };

const CONNECTORS = [
  {
    id: 'domo',
    name: 'Domo',
    status: STATUS.available,
    description: 'Connect with a Domo access token and pick the datasets to build a context from.',
    docsUrl: 'https://domo-support.domo.com/s/article/360042934494',
    credentials: [
      {
        id: 'name',
        label: 'Connection name',
        type: 'text',
        placeholder: 'Domo — Sales',
        help: 'How this connection appears in your workspace.',
      },
      {
        id: 'host',
        label: 'Domo instance',
        type: 'text',
        placeholder: 'acme.domo.com',
        help: 'The address you sign in to. An access token is issued by one instance and is only valid there.',
      },
      {
        id: 'token',
        label: 'Developer access token',
        type: 'secret',
        placeholder: '',
        help: 'Domo → Admin → Authentication → Access tokens. Stored encrypted and never shown again.',
      },
    ],
  },
  {
    id: 'snowflake',
    name: 'Snowflake',
    status: STATUS.planned,
    description: 'Account, warehouse, database and a key-pair or password credential.',
    credentials: [],
  },
  {
    id: 'databricks',
    name: 'Databricks',
    status: STATUS.planned,
    description: 'Workspace URL, SQL warehouse and a personal access token.',
    credentials: [],
  },
  {
    id: 'bigquery',
    name: 'BigQuery',
    status: STATUS.planned,
    description: 'Project, dataset and a service-account key.',
    credentials: [],
  },
  {
    id: 'redshift',
    name: 'Amazon Redshift',
    status: STATUS.planned,
    description: 'Cluster endpoint, database and credentials.',
    credentials: [],
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    status: STATUS.planned,
    description: 'Host, database and a read-only role.',
    credentials: [],
  },
];

const BY_ID = new Map<string, (typeof CONNECTORS)[number]>(CONNECTORS.map((c) => [c.id, c]));

function findConnector(id: unknown) {
  return BY_ID.get(String(id || '').trim().toLowerCase()) || null;
}

export { STATUS, CONNECTORS, findConnector };
