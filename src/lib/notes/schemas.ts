import { z } from "zod";

export const noteIdSchema = z.string().min(1);
export const noteLinkSchema = z.object({ label: z.string().trim().min(1), url: z.string().url() });
export const noteSearchSchema = z.object({ query: z.string().trim().max(200).default(""), tagId: z.string().min(1).optional(), sharedOnly: z.boolean().optional() });
export const createNoteSchema = z.object({ title: z.string().trim().min(1), body: z.string(), isShared: z.boolean(), tagIds: z.array(z.string().min(1)).default([]), links: z.array(noteLinkSchema).default([]), taskId: z.string().nullable().default(null), caseStudyId: z.string().nullable().default(null) });
export const updateNoteSchema = z.object({ title: z.string().trim().min(1).optional(), body: z.string().optional(), isShared: z.boolean().optional(), isPinned: z.boolean().optional(), color: z.string().optional(), tagIds: z.array(z.string().min(1)).optional(), links: z.array(noteLinkSchema).optional(), taskId: z.string().nullable().optional(), caseStudyId: z.string().nullable().optional(), expectedUpdatedAt: z.string().datetime() });
export type NoteSearchInput = z.infer<typeof noteSearchSchema>;
export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
