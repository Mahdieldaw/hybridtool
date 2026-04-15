export type LandscapePosition = 'northStar' | 'eastStar' | 'mechanism' | 'floor';

export const LANDSCAPE_ORDER: LandscapePosition[] = ['northStar', 'mechanism', 'eastStar', 'floor'];

export const LANDSCAPE_LABEL: Record<LandscapePosition, string> = {
  northStar: 'North Star',
  mechanism: 'Mechanism',
  eastStar: 'East Star',
  floor: 'Floor',
};

export interface LandscapeStyle {
  chipBg: string;
  chipBorder: string;
  chipText: string;
  passageBg: string;
  passageBorder: string;
  dispersedBg: string;
  dispersedBorder: string;
}

export const LANDSCAPE_STYLES: Record<LandscapePosition, LandscapeStyle> = {
  northStar: {
    chipBg: 'bg-amber-500/20',
    chipBorder: 'border-amber-500/50',
    chipText: 'text-amber-300',
    passageBg: 'bg-amber-500/12',
    passageBorder: 'border-l-amber-400',
    dispersedBg: 'bg-amber-500/5',
    dispersedBorder: 'border-l-amber-500/40',
  },
  mechanism: {
    chipBg: 'bg-blue-500/15',
    chipBorder: 'border-blue-500/40',
    chipText: 'text-blue-300',
    passageBg: 'bg-blue-500/10',
    passageBorder: 'border-l-blue-400',
    dispersedBg: 'bg-blue-500/5',
    dispersedBorder: 'border-l-blue-500/30',
  },
  eastStar: {
    chipBg: 'bg-violet-500/15',
    chipBorder: 'border-violet-500/40',
    chipText: 'text-violet-300',
    passageBg: 'bg-violet-500/8',
    passageBorder: 'border-l-violet-400',
    dispersedBg: 'bg-violet-500/4',
    dispersedBorder: 'border-l-violet-500/30',
  },
  floor: {
    chipBg: 'bg-white/5',
    chipBorder: 'border-white/15',
    chipText: 'text-text-muted',
    passageBg: 'bg-white/4',
    passageBorder: 'border-l-white/25',
    dispersedBg: '',
    dispersedBorder: 'border-l-white/10',
  },
};
