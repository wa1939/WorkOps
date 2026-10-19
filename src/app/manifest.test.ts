import { expect, it } from 'vitest';
import manifest from './manifest';

it('stable app identity and same origin start url', () => {
  const value = manifest();
  expect(value.id).toBe('/');
  expect(value.start_url).toBe('/?source=pwa');
  expect(value.scope).toBe('/');
});
it('standalone display and required icons', () => {
  const value = manifest();
  expect(value.display).toBe('standalone');
  expect(value.icons?.map(icon => icon.sizes)).toEqual(['192x192', '512x512', '512x512']);
  expect(value.icons?.some(icon => icon.purpose === 'maskable')).toBe(true);
});
