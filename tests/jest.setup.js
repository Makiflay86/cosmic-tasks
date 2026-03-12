/**
 * Global Jest setup — runs before each test file.
 */

global.requestAnimationFrame = (cb) => { return 0; };

global.fetch = jest.fn().mockImplementation((url) => {
  if (url === '/api/tasks') return Promise.resolve({ json: async () => [] });
  if (url === '/api/stats') return Promise.resolve({ json: async () => ({ total: 0, completed: 0, pending: 0, high_priority: 0 }) });
  return Promise.resolve({ json: async () => ({}) });
});
