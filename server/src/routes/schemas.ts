import { z } from 'zod';

export const idempotencyKey = z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/);
export const lang = z.enum(['fr', 'en', 'es']);
const notes = z.string().trim().max(500).nullish();

export const destination = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('room') }),
  z.object({ kind: z.literal('pool'), locationId: z.number().int().positive() }),
]);

export const activateBody = z
  .object({
    token: z.string().min(20).max(200).optional(),
    code: z.string().trim().min(4).max(40).optional(),
  room: z.string().trim().max(40).optional(),
    name: z.string().trim().max(100).optional(),
    language: lang.default('fr'),
  })
  .refine((b) => !!b.token !== !!b.code, 'token_or_code');

export const foodSubmitBody = z.object({
  idempotencyKey,
  lines: z
    .array(
      z.object({
        itemId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(99),
        optionIds: z.array(z.number().int().positive()).max(20).default([]),
        expectedUnitPriceMinor: z.number().int().min(0).optional(),
      }),
    )
    .min(1)
    .max(30),
  destination,
  notes,
  expectedTotalMinor: z.number().int().min(0).optional(),
});

export const serviceSubmitBody = z.object({
  idempotencyKey,
  lines: z
    .array(
      z.object({
        itemId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(99),
        details: z.string().trim().max(300).nullish(),
        expectedUnitPriceMinor: z.number().int().min(0).optional(),
        expectedComplimentary: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(30),
  destination,
  notes,
});

export const callbackBody = z.object({ idempotencyKey });
export const languageBody = z.object({ language: lang });

export const pushSubscriptionBody = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});

export const revisionBody = z.object({ expectedRevision: z.number().int().positive() });

export const staffLoginBody = z.object({ username: z.string().trim().min(1).max(80), password: z.string().min(1).max(200) });
export const deviceBody = z.object({ deviceId: z.number().int().positive() });

export const takeoverBody = revisionBody.extend({ reason: z.string().trim().min(3).max(300) });
export const confirmationBody = revisionBody.extend({
  outcome: z.enum(['confirmed', 'not_received']),
  method: z.enum(['room_call', 'in_person']),
});
export const amendmentBody = revisionBody.extend({ note: z.string().trim().min(3).max(500), newTotalMinor: z.number().int().min(0).optional() });
export const posBody = revisionBody.extend({ status: z.enum(['entered', 'uncertain', 'not_entered']), reference: z.string().trim().max(80).nullish() });
export const statusBody = revisionBody.extend({ to: z.enum(['in_progress', 'completed']) });
export const closeBody = revisionBody.extend({
  outcome: z.enum(['rejected', 'cancelled']),
  reason: z.string().trim().min(3).max(300),
  posDecision: z.string().trim().max(300).nullish(),
});
export const resolveBody = revisionBody.extend({ note: z.string().trim().min(3).max(300), useCurrentRoom: z.boolean().optional() });

const isoDateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'invalid_date');

export const createStayBody = z.object({
  guestName: z.string().trim().min(1).max(120),
  roomId: z.number().int().positive(),
  occupants: z.number().int().min(1).max(12).default(1),
  scheduledDeparture: isoDateTime.nullish(),
});
export const updateStayBody = z.object({
  guestName: z.string().trim().min(1).max(120).optional(),
  occupants: z.number().int().min(1).max(12).optional(),
  scheduledDeparture: isoDateTime.nullable().optional(),
});
export const moveBody = z.object({ roomId: z.number().int().positive() });
export const rotateBody = z.object({
  reason: z.enum(['reprint', 'occupant_change', 'lost', 'other']),
  revokeSessions: z.boolean().optional(),
});
