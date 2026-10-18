/** Supported output aspect ratios and their pixel sizes. */
export const ASPECTS = {
  '9:16': { width: 1080, height: 1920, label: 'Short (9:16)' },
  '16:9': { width: 1920, height: 1080, label: 'Landscape (16:9)' },
  '1:1': { width: 1080, height: 1080, label: 'Square (1:1)' },
} as const;

export type AspectRatio = keyof typeof ASPECTS;

export const ASPECT_RATIOS = Object.keys(ASPECTS) as AspectRatio[];

/** Returns the pixel size for a ratio, falling back to 9:16 for unknown values. */
export function aspectSize(aspect: string | null | undefined): { width: number; height: number } {
  const key = (aspect && aspect in ASPECTS ? aspect : '9:16') as AspectRatio;
  return { width: ASPECTS[key].width, height: ASPECTS[key].height };
}
