import { quoteIdentifier } from '../../shared/db/sql';

const q = quoteIdentifier;

const CT = {
  connections: q('connections'),
  datasets: q('datasets'),
  reviews: q('context_object_reviews'),
  versions: q('context_layer_versions'),
  objects: q('context_objects'),
};

export { CT };
