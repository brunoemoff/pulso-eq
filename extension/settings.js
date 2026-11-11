export const frequencies = [60, 150, 400, 1000, 2400, 6000, 12000];
export const presets = {
  'Plano': [0, 0, 0, 0, 0, 0, 0],
  'Mais grave': [8, 5, 1, 0, 0, 0, 0],
  'Voz clara': [-4, -2, -1, 3, 5, 2, 0],
  'Brilho': [-1, 0, 0, 0, 2, 4, 6],
  'Noite': [-5, -3, 0, 2, 1, -2, -4]
};

function clamp(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function normalize(value) {
  return {
    bands: frequencies.map((_, index) => clamp(value?.bands?.[index], -12, 12, 0)),
    volume: clamp(value?.volume, 0, 400, 100)
  };
}
