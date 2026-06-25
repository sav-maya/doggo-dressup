import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const dressups = pgTable('dressups', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').notNull(),
  userEmail: text('user_email').notNull(),
  theme: text('theme').notNull(),
  themeLabel: text('theme_label').notNull(),
  prompt: text('prompt').notNull(),
  originalKey: text('original_key').notNull(),
  outputKey: text('output_key').notNull(),
  bytes: integer('bytes').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
