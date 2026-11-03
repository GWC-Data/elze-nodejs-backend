import { readBusinessLayer } from './businessLayerValidator';
import type { BusinessLayer } from './businessLayerValidator';
import type { BusinessLayerRow } from './businessLayerRepository';
import type { VersionStatus } from '../../generated/prisma/enums';

interface BusinessLayerView {
  organizationName: string | null;
  versionId: string | null;
  status: VersionStatus | null;
  businessLayer: BusinessLayer;
  updatedAt: Date | null;
}

function shapeBusinessLayer(row: BusinessLayerRow | null, organizationName: string | null): BusinessLayerView {
  return {
    organizationName,
    versionId: row ? row.version_id : null,
    status: row ? row.status : null,
    businessLayer: readBusinessLayer(row ? row.business_layer : {}),
    updatedAt: row ? row.business_layer_updated_at : null,
  };
}

export { shapeBusinessLayer };
export type { BusinessLayerView };
