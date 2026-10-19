# Workspace ownership inventory

> This inventory is the gate for W01 workspace-key migration and the W06/W07 intelligence and AI scoping work. It must enumerate every Prisma model in `prisma/schema.prisma`; missing a model is a failed gate. `workspaceId` is the planned foreign-key column for direct workspace scope. Derived records inherit scope through the named parent.
>
> Ownership values are deliberately canonical: `workspace-key`, `workspace-derived`, `organization-global`, and `personal-with-workspace-link`. Department gained its W01 workspace association; the workspace boundary is now explicit.

```csv
model,ownership,parent,workspaceKey,notes
Department,organization-global,—,workspaceId,describes organization; gained a one-workspace association in W01
User,organization-global,—,—,organization identity and auth principal; not a workspace boundary
Workspace,workspace-key,—,—,"tenancy root added in W01; slug unique; Asia/Riyadh default timezone; archive sets read-only"
WorkspaceMember,workspace-derived,Workspace,workspaceId,"membership join with role OWNER/ADMIN/MEMBER/VIEWER; unique (workspaceId, userId)"
TeamLoadSnapshot,personal-with-workspace-link,—,workspaceId,user workload snapshot computed only from its workspace context
TeamLoadRun,organization-global,—,—,workload refresh lease ledger keyed by scope and input version; no direct workspace foreign key
Announcement,workspace-key,—,workspaceId,team-wide announcement scoped to one workspace
AnnouncementSeen,workspace-derived,Announcement,—,per-user dismissal inherits announcement workspace
Account,organization-global,—,—,authentication provider account follows organization user identity
Session,organization-global,—,—,authentication session follows organization user identity
VerificationToken,organization-global,—,—,authentication verification token has no workspace context
PasswordResetToken,organization-global,—,—,password reset token follows organization identity; reset tokens stored hashed (tokenHash) and single-use (usedAt)
RateLimitEntry,organization-global,—,—,per-route abuse-control counters keyed by route principal; no workspace scope
TaskSubscriber,workspace-derived,Task,—,task watch/notify subscription inherits task workspace
CommentReaction,workspace-derived,Comment,—,comment emoji reaction inherits comment workspace
CommentRead,workspace-derived,Comment,—,per-user comment read receipt inherits comment workspace
CustomField,workspace-derived,Project,—,project-local typed field definitions inherit project workspace
CustomFieldValue,workspace-derived,CustomField,—,task cell value inherits custom field workspace
UserDepartment,organization-global,—,—,organization department membership; Department now carries the W01 workspace association
Tag,workspace-key,—,workspaceId,shared tag dictionary is isolated per workspace
Project,workspace-key,—,workspaceId,collaboration root with direct W01 workspace foreign key
ProjectObjective,workspace-derived,Project,—,inherits project workspace
ProjectOutput,workspace-derived,Project,—,inherits project workspace
ProjectRisk,workspace-derived,Project,—,inherits project workspace
ProjectStage,workspace-derived,Project,—,inherits project workspace
AppConfig,organization-global,—,—,application configuration is organization-global; future workspace settings require re-examination
ProjectMember,workspace-derived,Project,—,inherits project workspace
CaseStudy,workspace-key,—,workspaceId,collaboration root with direct W01 workspace foreign key
CaseStudyMember,workspace-derived,CaseStudy,—,inherits case study workspace
CaseStudyDepartment,workspace-derived,CaseStudy,—,department relation does not change case study workspace scope
Task,workspace-key,—,workspaceId,collaboration root with direct W01 workspace foreign key
TimeLog,workspace-derived,Task,—,per-user time entry inherits the task workspace
ActiveTimer,personal-with-workspace-link,Task/User,—,one active timer per user; task supplies workspace context
RecurringRule,workspace-derived,Task,—,inherits task workspace; schedule configuration follows its task
TaskAssignment,workspace-derived,Task,—,inherits task workspace
TaskDependency,workspace-derived,Task,—,both task sides must resolve within the task workspace
TaskTag,workspace-derived,Task,—,inherits task workspace; tag is also workspace-keyed
Attachment,workspace-derived,Task,—,inherits task workspace
Link,workspace-derived,Task/Project/CaseStudy/NotePage,—,polymorphic link inherits the selected workspace entity
Comment,workspace-derived,Task,—,inherits task workspace
LeaveRequest,personal-with-workspace-link,—,workspaceId,user leave record requires the workspace of its created context
Handover,personal-with-workspace-link,—,workspaceId,leave handover belongs to users and its workspace context; do not derive scope from personal LeaveRequest
HandoverTask,workspace-derived,Task,—,task side provides the workspace boundary while the handover remains user context
KPI,workspace-key,—,workspaceId,department collaboration KPI root with direct workspace foreign key
KPIUpdate,workspace-derived,KPI,—,inherits KPI workspace
NotePage,workspace-key,—,workspaceId,collaboration root with direct W01 workspace foreign key
NoteTag,workspace-derived,NotePage,—,inherits note workspace
TaskReminder,workspace-derived,Task,—,inherits task workspace despite its user recipient
Notification,personal-with-workspace-link,—,workspaceId,user notification requires the workspace of its source context
NotificationEvent,workspace-key,—,workspaceId,durable notification event captures the workspace and recipient context; dedupe key is unique
Delivery,workspace-derived,NotificationEvent,—,inherits notification-event workspace and records one channel delivery attempt
PushSubscription,organization-global,—,—,encrypted browser push subscription is bound to the organization user and device; workspace delivery is resolved by the event
UserIdentityAlias,organization-global,—,—,approved identity consolidation follows organization user identities and has no workspace scope
NotificationPreference,organization-global,—,—,user channel preferences follow the organization identity and apply across workspace contexts
WorkArea,workspace-key,—,workspaceId,project and case-study grouping is collaboration data within one workspace
ExternalContact,workspace-key,—,workspaceId,shared external contact is isolated to its collaboration workspace
ExternalAction,workspace-derived,Task,—,external action is the task workflow in the task workspace
ReminderRule,workspace-derived,ExternalAction,—,inherits external action workspace
FollowUpEvent,workspace-derived,ExternalAction,—,inherits external action workspace and its notification context
ActionEvidence,workspace-derived,ExternalAction,—,inherits external action workspace
WeeklyReport,workspace-key,—,workspaceId,report root is scoped to one workspace
AuditLog,workspace-derived,Task/Project/CaseStudy/KPI/NotePage/SupportRequest/Announcement/AiWorkflow,—,generic audit entity must resolve to the workspace context named by its entity record
SavedView,personal-with-workspace-link,—,workspaceId,user-owned view requires the workspace in which it was created
SavedViewVote,personal-with-workspace-link,—,workspaceId,user vote requires the saved-view workspace and voting user context
UserStreak,personal-with-workspace-link,—,workspaceId,user streak requires the workspace whose activity is counted
SupportRequest,workspace-key,—,workspaceId,collaboration request root with direct workspace foreign key
AiConversation,personal-with-workspace-link,—,workspaceId,user conversation requires the workspace of its created context
AiMessage,personal-with-workspace-link,—,workspaceId,message inherits conversation context but carries a direct workspace link because its parent is personal
AiMemory,personal-with-workspace-link,—,workspaceId,user or shared memory must retain the workspace context in which it was proposed
AiMemorySource,personal-with-workspace-link,—,workspaceId,memory provenance follows the personal memory context and carries it directly
AiPlaybook,personal-with-workspace-link,—,workspaceId,owner and scope make the playbook user-linked while its workspace context is explicit
AiPlaybookVersion,personal-with-workspace-link,—,workspaceId,version inherits the owner playbook context and keeps a direct workspace link
AiPlaybookEvaluation,personal-with-workspace-link,—,workspaceId,evaluation follows the owner playbook context and keeps a direct workspace link
AiFeedback,personal-with-workspace-link,—,workspaceId,feedback may reference workflow approval conversation message or memory source; direct workspace context is required
AiConversationSummary,personal-with-workspace-link,—,workspaceId,summary follows its user conversation and carries the conversation workspace
AiIntake,personal-with-workspace-link,—,workspaceId,user file intake requires the workspace of its created context
AiAsset,workspace-key,—,workspaceId,multimodal source asset is a workspace content root with an optional owner
AiSourceBlock,workspace-derived,AiAsset,—,extracted source block inherits asset workspace
AiExtractionRun,workspace-derived,AiAsset,—,extraction run inherits asset workspace
AiProcessingConsent,organization-global,—,—,actor and asset checksum are not workspace foreign keys; Phase 2 W07 AI scoping must re-examine it
AiWorkflow,workspace-key,—,workspaceId,workflow execution is a collaboration root and must capture workspace at creation
AiWorkflowStep,workspace-derived,AiWorkflow,—,inherits workflow workspace
AiWorkflowEvent,workspace-derived,AiWorkflow,—,inherits workflow workspace even when it records a step event
AiApproval,workspace-derived,AiWorkflow,—,approval gate inherits workflow workspace
AiOperationalLog,workspace-derived,AiWorkflow,—,operational log inherits workflow workspace
AiProviderCredential,organization-global,—,—,no workspace parent or foreign key; Phase 2 W07 AI scoping must re-examine provider credential isolation
AiModelAssignment,organization-global,—,—,providerKey is not a workspace relation; Phase 2 W07 AI scoping must re-examine model assignment scope
AiKnowledgeChunk,workspace-derived,AiAsset/Task/Project/CaseStudy/KPI/NotePage/WeeklyReport/SupportRequest/Announcement,—,polymorphic entityType/entityId must resolve to a workspace-keyed source entity for W06 retrieval
AiEntityFingerprint,workspace-derived,AiAsset/Task/Project/CaseStudy/KPI/NotePage/WeeklyReport/SupportRequest/Announcement,—,polymorphic freshness record must resolve to a workspace-keyed source entity
AiEmbeddingVector,workspace-derived,AiKnowledgeChunk,—,embedding payload inherits knowledge chunk workspace
AiJob,workspace-derived,AiWorkflow,—,workflow or step execution uses workflow workspace; non-workflow job types require explicit W07 scope
AiJobAttempt,workspace-derived,AiJob,—,attempt inherits job workspace
AiMonitor,personal-with-workspace-link,—,workspaceId,user-created monitor requires the workspace context it observes
AiMonitorState,personal-with-workspace-link,—,workspaceId,monitor state follows a user monitor and carries its workspace directly
AiSuggestion,personal-with-workspace-link,—,workspaceId,monitor suggestion is user-linked and requires the observed workspace
AiConnector,organization-global,—,—,connector has no workspace relation; Phase 2 W07 AI scoping must re-examine integration scope
AiConnectorCredential,organization-global,—,—,inherits organization-global connector scope; Phase 2 W07 AI scoping must re-examine credential isolation
AiWebhookDelivery,organization-global,—,—,inherits organization-global connector scope; Phase 2 W07 AI scoping must re-examine delivery scope
AiCapabilityResult,organization-global,—,—,idempotency result has no workspace parent; Phase 2 W07 AI scoping must re-examine capability-result scope
```
