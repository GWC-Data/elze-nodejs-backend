import { quoteIdentifier } from '../tools/sql';
import { T } from './rbacModel';

const q = quoteIdentifier;

const CT = {
  connections: q('connections'),
  datasets: q('datasets'),
  reviews: q('context_object_reviews'),
  publications: q('context_publications'),
  versions: q('context_layer_versions'),
  objects: q('context_objects'),
  profiles: q('context_profiles'),
  access: T.contextUserAccess,
  groupAccess: T.contextGroupAccess,
};

export { CT };
