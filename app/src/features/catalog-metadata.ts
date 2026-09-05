export function seriesPositionError(value: string) {
  return value.trim() && !/^\d{1,6}(\.\d{1,3})?$/.test(value.trim())
    ? 'Use a number from 0 to 999999.999, with up to three decimal places.'
    : '';
}

export function narratorNamesError(value: string) {
  const names = value
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length > 20) return 'Enter at most 20 narrators.';
  return names.some((name) => Array.from(name).length > 200)
    ? 'Each narrator name must be 200 characters or fewer.'
    : '';
}
