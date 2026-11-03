-- AlterEnum
ALTER TYPE "context_step" ADD VALUE 'business';

-- AlterTable
ALTER TABLE "context_layer_versions" ADD COLUMN     "business_layer" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "business_layer_updated_at" TIMESTAMPTZ(6);
