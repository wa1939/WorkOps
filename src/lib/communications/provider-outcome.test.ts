import { expect, it } from 'vitest';
import { requireAcceptedId } from './provider-outcome';

it('returned provider error is failed', () => {
  expect(() => requireAcceptedId({ data: null, error: { message: 'Rejected' } })).toThrow('Rejected');
});

it('missing provider id is not success', () => {
  expect(() => requireAcceptedId({ data: {} })).toThrow('acceptance ID');
});

it('returns acceptance id without claiming delivery', () => {
  expect(requireAcceptedId({ data: { id: 'receipt-1' } })).toBe('receipt-1');
});
