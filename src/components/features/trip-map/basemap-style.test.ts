import { namedFlavor } from '@protomaps/basemaps';
import { describe, expect, it } from 'vitest';

import { buildBasemapStyle } from './basemap-style';

function backgroundColor(style: ReturnType<typeof buildBasemapStyle>): unknown {
  const bg = style.layers.find((layer) => layer.type === 'background');
  return bg?.type === 'background' ? bg.paint?.['background-color'] : undefined;
}

describe('buildBasemapStyle', () => {
  it('draws White with the light sprite by default', () => {
    const style = buildBasemapStyle();
    expect(style.sprite).toBe('/basemaps-assets/sprites/v4/light');
    expect(backgroundColor(style)).toBe(namedFlavor('white').background);
  });

  it('draws Black with its own sprite in the dark theme', () => {
    const style = buildBasemapStyle({ theme: 'dark' });
    expect(style.sprite).toBe('/basemaps-assets/sprites/v4/black');
    expect(backgroundColor(style)).toBe(namedFlavor('black').background);
  });

  it('keeps tiles and glyphs the same across themes', () => {
    const light = buildBasemapStyle({ theme: 'light' });
    const dark = buildBasemapStyle({ theme: 'dark' });
    expect(dark.sources).toEqual(light.sources);
    expect(dark.glyphs).toBe(light.glyphs);
  });
});
