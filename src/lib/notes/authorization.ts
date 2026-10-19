export type NoteActor = { id: string; role: string; departmentIds?: string[] };
export function noteVisibility(actor: NoteActor) { return { OR: [{ isShared: true }, { authorId: actor.id }] }; }
export function canReadNote(note: { isShared: boolean; authorId: string | null }, actor: NoteActor) { return note.isShared || note.authorId === actor.id; }
export function canUpdateNote(note: { authorId: string | null }, actor: NoteActor) { return note.authorId === actor.id; }
