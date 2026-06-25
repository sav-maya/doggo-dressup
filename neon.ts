import { defineConfig } from '@neondatabase/config/v1';

export default defineConfig({
  preview: {
    aiGateway: true,
    buckets: {
      dressups: {},
    },
    functions: {
      dressup: {
        name: 'Doggo Dress-Up',
        source: 'src/index.ts',
      },
    },
  },
});
