import { quoteIdentifier } from '../tools/sql';

const q = quoteIdentifier;

const CT = {
  connections: q('connections'),
  datasets: q('datasets'),
  reviews: q('context_object_reviews'),
  publications: q('context_publications'),
  versions: q('context_layer_versions'),
  objects: q('context_objects'),
};

export { CT };
