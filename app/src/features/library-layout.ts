export type LibraryDensity = 'comfortable' | 'compact';
export const libraryDensityKey = 'aldus:library-density';
export function libraryDensity(value: string | null): LibraryDensity {
  return value === 'compact' ? 'compact' : 'comfortable';
}
export function libraryColumns(width: number, density: LibraryDensity) {
  if (width < 600) return density === 'compact' ? 3 : 2;
  const available = Math.min(width - (width >= 820 ? 224 : 0), 1240) - 32;
  return Math.max(2, Math.floor(available / (density === 'compact' ? 148 : 200)));
}
