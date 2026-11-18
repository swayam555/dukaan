/**
 * Dukaan design tokens. Built for a bright shop counter: high contrast, big touch targets (≥ 48 dp),
 * numerals that read at arm's length, and one strong accent (saffron) for the primary action.
 */
export type Palette = Record<
  'ink' | 'ink2' | 'ink3' | 'line' | 'surface' | 'canvas' | 'saffron' | 'saffronDeep' | 'saffronTint' | 'leaf' | 'leafTint' | 'brick' | 'brickTint' | 'indigo' | 'indigoTint',
  string
>;

export const palette: Palette = {
  ink: '#16181D',
  ink2: '#4A505C',
  ink3: '#80868F',
  line: '#E3E5E8',
  surface: '#FFFFFF',
  canvas: '#F5F4F0',
  saffron: '#E8770E',
  saffronDeep: '#B85A05',
  saffronTint: '#FDEBD8',
  leaf: '#1E8A4C',
  leafTint: '#DDF2E4',
  brick: '#C23B22',
  brickTint: '#FBE3DE',
  indigo: '#2F4DB8',
  indigoTint: '#E2E7FA',
};

export const darkPalette: Palette = {
  ink: '#F1F2F4',
  ink2: '#B9BEC7',
  ink3: '#8A909A',
  line: '#2C3038',
  surface: '#1B1E24',
  canvas: '#121418',
  saffron: '#F08A2A',
  saffronDeep: '#FFA552',
  saffronTint: '#3A2612',
  leaf: '#3DBA6E',
  leafTint: '#16301F',
  brick: '#EF6A50',
  brickTint: '#3A1A14',
  indigo: '#7F98F0',
  indigoTint: '#1C2440',
};


export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

export const type = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' as const },
  label: { fontSize: 13, lineHeight: 17, fontWeight: '600' as const, letterSpacing: 0.2 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
  money: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const, fontVariant: ['tabular-nums' as const] },
} as const;

export const touch = { min: 48, key: 64 } as const;
