ALTER TABLE "drafts" DROP CONSTRAINT "draft_kind";--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "draft_kind" CHECK ("drafts"."kind" in ('issue','review','pull_request'));