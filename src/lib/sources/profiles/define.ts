import type { FieldLocation, MeasureSpec, PeriodSpec, Profile, ProfileDataset, ProfileField } from "./types";

/**
 * Finds a field by its label (the publisher's header). The position it returns is the position of the
 * cell in a record's `values`. A label carried by no field or by several is not resolved.
 */
export function locateField(fields: readonly ProfileField[], label: string): FieldLocation {
  let index = -1;
  for (let i = 0; i < fields.length; i += 1) {
    if (fields[i].label !== label) continue;
    if (index !== -1) return { ok: false, reason: "repeated" };
    index = i;
  }
  return index === -1 ? { ok: false, reason: "missing" } : { ok: true, index, key: fields[index].key };
}

/** Labels the profile reads that the snapshot does not carry exactly once. */
export function unmatchedFields(
  requires: readonly string[],
  fields: readonly ProfileField[],
): { field: string; reason: "missing" | "repeated" }[] {
  const out: { field: string; reason: "missing" | "repeated" }[] = [];
  for (const field of requires) {
    const found = locateField(fields, field);
    if (!found.ok) out.push({ field, reason: found.reason });
  }
  return out;
}

/** Every label a profile definition reads: measures, their unit columns, period fields, addressing fields. */
export function requiredFields(parts: {
  period: PeriodSpec;
  measures: readonly MeasureSpec[];
  where?: readonly string[];
  extra?: readonly string[];
}): string[] {
  const labels: string[] = [];
  const add = (label: string) => {
    if (!labels.includes(label)) labels.push(label);
  };
  if (parts.period.from === "field") add(parts.period.field);
  if (parts.period.from === "fields") parts.period.fields.forEach(add);
  for (const measure of parts.measures) {
    add(measure.field);
    if (measure.unit.from === "column") add(measure.unit.column);
  }
  parts.where?.forEach(add);
  parts.extra?.forEach(add);
  return labels;
}

/**
 * Builds a profile from its parts. `requires` and `applies` are derived, so a profile cannot read a field
 * it does not also check for.
 */
export function defineProfile(
  claims: (dataset: ProfileDataset) => boolean,
  parts: Omit<Profile, "applies" | "requires"> & { extraFields?: readonly string[] },
): Profile {
  const { extraFields, ...rest } = parts;
  if (rest.measures.length === 0) throw new Error(`profile ${rest.family} has no measure`);
  const requires = requiredFields({
    period: rest.period,
    measures: rest.measures,
    where: [...rest.addressing.where, ...(rest.fixed ?? []).map((m) => m.field)],
    extra: extraFields,
  });
  return {
    ...rest,
    requires,
    applies: (dataset, fields) => claims(dataset) && unmatchedFields(requires, fields).length === 0,
  };
}
