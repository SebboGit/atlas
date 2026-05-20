CREATE TYPE "public"."extraction_failure_reason" AS ENUM('pdf-empty', 'ocr-empty', 'llm-unavailable', 'llm-invalid-json', 'all-extractors-failed');--> statement-breakpoint
CREATE TYPE "public"."text_extraction_method" AS ENUM('pdf-text', 'ocr-tesseract', 'email');--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "extraction_error" SET DATA TYPE "public"."extraction_failure_reason" USING "extraction_error"::"public"."extraction_failure_reason";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "text_method" text_extraction_method;