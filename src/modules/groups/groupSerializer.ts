import type { GroupView } from './groupRepository';

function shapeGroup(row: GroupView): GroupView;
function shapeGroup(row: GroupView | null | undefined): GroupView | null;
function shapeGroup(row: GroupView | null | undefined): GroupView | null {
  if (!row) return null;
  return { ...row, active: Boolean(row.active), memberCount: Number(row.memberCount) };
}

export { shapeGroup };
