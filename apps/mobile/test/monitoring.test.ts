import { scrub } from '@/lib/monitoring';

test('crash events keep the stack but drop user, request, extras and data-bearing breadcrumbs', () => {
  const event = scrub({
    exception: { values: [{ type: 'Error', value: 'boom' }] },
    user: { id: 'owner' }, request: { url: 'http://x/v1/sync/push' }, extra: { customer: 'Ramesh 9876543210' },
    breadcrumbs: [
      { category: 'console', message: 'saved bill for Ramesh ₹240' },
      { category: 'navigation', message: '/customer/c-1' },
      { category: 'xhr', message: 'POST /v1/sync/push' },
    ],
  });
  expect(event).toEqual({ exception: { values: [{ type: 'Error', value: 'boom' }] }, breadcrumbs: [{ category: 'navigation', message: undefined }] });
  expect(JSON.stringify(event)).not.toMatch(/Ramesh|9876|sync/);
});
