import { describe, expect, it } from "vitest";
import {
    AUTHZ_POLICY_MATRIX,
    evaluateCommentAccess,
    evaluateProjectAccess,
    evaluateTaskAccess,
    evaluateTimeLogAccess,
} from "../../lib/authz/policies";
import type {
    AuthzAction,
    AuthzUser,
    CommentMembership,
    ProjectMembership,
    TaskMembership,
    TimeLogMembership,
} from "../../lib/authz/types";

const user: AuthzUser = { id: "user-1", role: "MEMBER" };

function taskMembership(ownsTask: boolean, accessLevel: string): TaskMembership {
    return {
        projectId: "project-1",
        userId: user.id,
        accessLevel,
        taskOwnerId: ownsTask ? user.id : "another-user",
    };
}

function projectMembership(accessLevel: string): ProjectMembership {
    return { projectId: "project-1", userId: user.id, accessLevel };
}

function commentMembership(authorId: string, accessLevel = "MEMBER"): CommentMembership {
    return { projectId: "project-1", userId: user.id, accessLevel, authorId };
}

function timeLogMembership(authorId: string, accessLevel = "MEMBER"): TimeLogMembership {
    return { projectId: "project-1", userId: user.id, accessLevel, authorId };
}

describe("authz policy matrix", () => {
    it.each(AUTHZ_POLICY_MATRIX)(
        "$kind $accessLevel $action (ownsTask=$ownsTask)",
        (row) => {
            const actual = row.kind === "task"
                ? evaluateTaskAccess(user, taskMembership(row.ownsTask, row.accessLevel), row.action)
                : evaluateProjectAccess(user, projectMembership(row.accessLevel), row.action);

            expect(actual).toBe(row.allowed);
        },
    );
});

describe("authz policy safeguards", () => {
    it("lets an ADMIN bypass resource membership for known actions", () => {
        const admin: AuthzUser = { id: "admin-1", role: "ADMIN" };

        expect(evaluateTaskAccess(admin, null, "task:delete")).toBe(true);
        expect(evaluateProjectAccess(admin, null, "project:manage")).toBe(true);
        expect(evaluateCommentAccess(admin, null, "comment:edit")).toBe(true);
        expect(evaluateTimeLogAccess(admin, null, "timelog:edit")).toBe(true);
    });

    it("denies an outsider when project membership is absent", () => {
        // A null membership at the POLICY level means "task context exists but
        // the viewer has no project membership" — standalone tasks remain
        // viewable (creator/assignee can edit via isTaskOwner), while
        // project/comment/timelog actions stay denied.
        expect(evaluateTaskAccess(user, null, "task:view")).toBe(true);
        expect(evaluateTaskAccess(user, null, "task:edit")).toBe(false);
        expect(evaluateProjectAccess(user, null, "project:view")).toBe(false);
        expect(evaluateCommentAccess(user, null, "comment:edit")).toBe(false);
        expect(evaluateTimeLogAccess(user, null, "timelog:edit")).toBe(false);
    });

    it("allows comment edits only to the author or a project manager", () => {
        expect(evaluateCommentAccess(user, commentMembership(user.id), "comment:edit")).toBe(true);
        expect(evaluateCommentAccess(user, commentMembership("another-user"), "comment:edit")).toBe(false);
        expect(evaluateCommentAccess(user, commentMembership("another-user", "MANAGER"), "comment:edit")).toBe(true);
        expect(evaluateCommentAccess(user, commentMembership("another-user", "VIEWER"), "comment:edit")).toBe(false);
    });

    it("allows timelog edits only to the author or a project manager", () => {
        expect(evaluateTimeLogAccess(user, timeLogMembership(user.id), "timelog:edit")).toBe(true);
        expect(evaluateTimeLogAccess(user, timeLogMembership("another-user"), "timelog:edit")).toBe(false);
        expect(evaluateTimeLogAccess(user, timeLogMembership("another-user", "ADMIN"), "timelog:edit")).toBe(true);
        expect(evaluateTimeLogAccess(user, timeLogMembership("another-user", "VIEWER"), "timelog:edit")).toBe(false);
    });

    it("fails closed for an unknown action", () => {
        const unknownAction = "task:archive" as AuthzAction;
        const membership = taskMembership(true, "ADMIN");

        expect(evaluateTaskAccess(user, membership, unknownAction)).toBe(false);
        expect(evaluateProjectAccess(user, projectMembership("ADMIN"), unknownAction)).toBe(false);
    });
});
