ALTER TABLE "championship_countries" ADD COLUMN "order_index" integer;--> statement-breakpoint
-- Backfill existing rows: no prior signal exists for start list order, so each
-- championship's countries are numbered by their current alphabetical display
-- order, which is exactly what they already showed before this column existed.
UPDATE "championship_countries" AS cc
SET "order_index" = ranked.position
FROM (
	SELECT cc2.id, row_number() OVER (
		PARTITION BY cc2.championship_id
		ORDER BY c.name_en
	) - 1 AS position
	FROM "championship_countries" cc2
	JOIN "countries" c ON c.id = cc2.country_id
) AS ranked
WHERE ranked.id = cc.id;--> statement-breakpoint
ALTER TABLE "championship_countries" ALTER COLUMN "order_index" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "championship_countries_order_idx" ON "championship_countries" USING btree ("championship_id","order_index");
