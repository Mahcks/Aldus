const MB = 1024 ** 2;
const GB = 1024 ** 3;
const MAX_BYTES = 1024 ** 4;
const tokenPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function formatSizeLimit(bytes: number) {
  if (bytes >= GB && bytes % GB === 0) return `${bytes / GB} GB`;
  return `${Math.round((bytes / MB) * 10) / 10} MB`;
}

export function parseSizeLimit(value: string): number | undefined {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(mb|gb)$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const bytes = Math.round(amount * (match[2]!.toLowerCase() === 'gb' ? GB : MB));
  if (!Number.isFinite(bytes) || bytes < 1024 || bytes > MAX_BYTES) return undefined;
  return bytes;
}

export function parseFormats(value: string) {
  return [
    ...new Set(
      value
        .toLowerCase()
        .split(/[\s,]+/)
        .map((item) => item.replace(/^\./, ''))
        .filter(Boolean),
    ),
  ];
}

export function validPolicyToken(value: string) {
  return value.length > 0 && value.length <= 35 && tokenPattern.test(value);
}

export function validFormats(values: string[]) {
  return (
    values.length > 0 &&
    values.length <= 16 &&
    values.every((value) => value.length <= 16 && tokenPattern.test(value))
  );
}
