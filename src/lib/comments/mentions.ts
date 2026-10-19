export interface MentionMember {
    id: string;
    name: string | null;
}

export interface ParsedMentions {
    cleanedText: string;
    mentionUserIds: string[];
}

export interface MentionTextSegment {
    type: "text" | "mention";
    text: string;
    userId?: string;
}

type MentionMatch = {
    start: number;
    end: number;
    userId: string;
};

type NormalizedMember = MentionMember & {
    normalizedName: string;
};

function isWordCharacter(character: string | undefined): boolean {
    if (!character) return false;
    if (character === "_") return true;
    return character.toLocaleUpperCase() !== character.toLocaleLowerCase()
        || (character >= "0" && character <= "9");
}

function normalizedName(name: string): string {
    return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function normalizedMembers(members: readonly MentionMember[]): NormalizedMember[] {
    return members
        .filter((member) => typeof member.id === "string" && member.id.length > 0 && typeof member.name === "string")
        .map((member) => ({
            ...member,
            normalizedName: normalizedName(member.name ?? ""),
        }))
        .filter((member) => member.normalizedName.length > 0)
        .sort((left, right) => right.normalizedName.length - left.normalizedName.length);
}

function findMentionMatches(text: string, members: readonly MentionMember[]): MentionMatch[] {
    const candidates = normalizedMembers(members);
    const matches: MentionMatch[] = [];

    for (let index = 0; index < text.length; index += 1) {
        if (text[index] !== "@" || isWordCharacter(text[index - 1]) || text[index - 1] === "@") {
            continue;
        }

        const afterAt = text.slice(index + 1);
        const match = candidates.find((member) => {
            const typedName = afterAt.slice(0, member.normalizedName.length);
            if (typedName.toLocaleLowerCase() !== member.normalizedName) return false;
            return !isWordCharacter(afterAt[member.normalizedName.length]);
        });

        if (!match) continue;
        matches.push({
            start: index,
            end: index + 1 + match.normalizedName.length,
            userId: match.id,
        });
        index = index + match.normalizedName.length;
    }

    return matches;
}

/**
 * Parse valid @name mentions without querying or constructing a database
 * regular expression. Names are matched against the supplied member list,
 * case-insensitively, and duplicate user ids are returned only once.
 */
export function parseMentions(
    text: string,
    validMembers: readonly MentionMember[],
): ParsedMentions {
    const cleanedText = text.trim();
    const mentionUserIds: string[] = [];
    const seen = new Set<string>();

    for (const match of findMentionMatches(cleanedText, validMembers)) {
        if (!seen.has(match.userId)) {
            seen.add(match.userId);
            mentionUserIds.push(match.userId);
        }
    }

    return { cleanedText, mentionUserIds };
}

/** Return stable segments suitable for rendering text and highlighted mentions. */
export function renderMentionHighlights(
    text: string,
    mentions: readonly MentionMember[],
): MentionTextSegment[] {
    const matches = findMentionMatches(text, mentions);
    if (matches.length === 0) return [{ type: "text", text }];

    const segments: MentionTextSegment[] = [];
    let cursor = 0;
    for (const match of matches) {
        if (match.start > cursor) {
            segments.push({ type: "text", text: text.slice(cursor, match.start) });
        }
        segments.push({
            type: "mention",
            text: text.slice(match.start, match.end),
            userId: match.userId,
        });
        cursor = match.end;
    }
    if (cursor < text.length) {
        segments.push({ type: "text", text: text.slice(cursor) });
    }
    return segments;
}
