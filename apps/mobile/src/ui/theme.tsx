import { useColorScheme } from 'react-native';
import { darkPalette, palette, type Palette } from '@/constants/theme';

export function useColors(): Palette {
  return useColorScheme() === 'dark' ? darkPalette : palette;
}
