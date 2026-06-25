import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';

// Each user can register one or more pets (the "cast"). Photos live in the
// dressups bucket under pets/<uuid>.<ext>.
export const pets = pgTable(
  'pets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    userEmail: text('user_email').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(), // lowercase, used for @-mentions
    bucketKey: text('bucket_key').notNull(),
    contentType: text('content_type').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('pets_user_id_idx').on(t.userId)],
);

// Each generation references its prompt + the pets it cast. The generated
// image lives in the bucket under outputs/<uuid>.jpg.
export const generations = pgTable(
  'generations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    userEmail: text('user_email').notNull(),
    prompt: text('prompt').notNull(),
    petIds: text('pet_ids').array().notNull().default([]),
    petNames: text('pet_names').array().notNull().default([]),
    outputKey: text('output_key').notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('generations_user_id_idx').on(t.userId)],
);
