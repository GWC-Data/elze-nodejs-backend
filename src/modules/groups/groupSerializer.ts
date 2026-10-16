function shapeGroup(row: Record<string, any> | null | undefined) {
  if (!row) return null;
  return { ...row, active: Boolean(row.active), memberCount: Number(row.memberCount) };
}

export { shapeGroup };
