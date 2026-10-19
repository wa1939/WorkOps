import type { MentionMember } from "@/lib/comments/mentions";

export interface CommentMember extends MentionMember {
    email?: string | null;
    image?: string | null;
}

export interface CommentReaction {
    emoji: string;
    count: number;
    reactedByMe: boolean;
    users: Array<{
        id: string;
        name: string | null;
        image: string | null;
    }>;
}

export interface TaskComment {
    id: string;
    taskId?: string;
    body: string;
    authorId: string | null;
    author: CommentMember | null;
    mentionUserIds: string[];
    createdAt: string;
    editedAt: string | null;
    deletedAt: string | null;
    isDeleted: boolean;
    isHandoverUpdate?: boolean;
    myReadAt: string | null;
    reactions: CommentReaction[];
}

export function memberLabel(member: CommentMember): string {
    return member.name?.trim() || member.email?.trim() || member.id;
}
