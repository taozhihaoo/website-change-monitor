import { z } from 'zod';

export const selectorTypeSchema = z.enum(['css', 'xpath', 'text']);

const urlSchema = z.string().trim().min(1, 'URL is required.').max(2048);
const selectorSchema = z.string().trim().min(1, 'Selector is required.').max(1000);
const webhookUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .default(null);

const notifyEmailSchema = z
  .string()
  .trim()
  .max(320)
  .refine((value) => value.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
    message: 'Must be a valid email address.',
  })
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .default(null);

const intervalSchema = z.coerce
  .number()
  .int()
  .min(60, 'The minimum check interval is 60 seconds.')
  .max(30 * 24 * 3600, 'The maximum check interval is 30 days.');

export const createMonitorSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(200),
  url: urlSchema,
  selector: selectorSchema,
  selector_type: selectorTypeSchema.default('css'),
  check_interval_seconds: intervalSchema.default(300),
  enabled: z.boolean().default(true),
  webhook_url: webhookUrlSchema,
  notify_email: notifyEmailSchema,
});

// For updates there must be no defaults: an absent field means "leave
// unchanged", not "apply the default".
const webhookPatchSchema = z
  .string()
  .trim()
  .max(2048)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional();

const notifyEmailPatchSchema = z
  .string()
  .trim()
  .max(320)
  .refine((value) => value.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
    message: 'Must be a valid email address.',
  })
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional();

export const updateMonitorSchema = z
  .object({
    name: z.string().trim().min(1, 'Name cannot be empty.').max(200).optional(),
    url: urlSchema.optional(),
    selector: selectorSchema.optional(),
    selector_type: selectorTypeSchema.optional(),
    check_interval_seconds: intervalSchema.optional(),
    enabled: z.boolean().optional(),
    webhook_url: webhookPatchSchema,
    notify_email: notifyEmailPatchSchema,
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.url !== undefined ||
      value.selector !== undefined ||
      value.selector_type !== undefined ||
      value.check_interval_seconds !== undefined ||
      value.enabled !== undefined ||
      value.webhook_url !== undefined ||
      value.notify_email !== undefined,
    { message: 'Provide at least one field to update.' },
  );

export const idParamSchema = z.object({ id: z.uuid('Monitor id must be a UUID.') });

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const testExtractionSchema = z.object({
  url: urlSchema,
  selector: selectorSchema,
  selector_type: selectorTypeSchema.default('css'),
});

export const runNowQuerySchema = z.object({
  wait: z.enum(['1', 'true']).optional(),
});

export type CreateMonitorBody = z.infer<typeof createMonitorSchema>;
export type UpdateMonitorBody = z.infer<typeof updateMonitorSchema>;
export type TestExtractionBody = z.infer<typeof testExtractionSchema>;
