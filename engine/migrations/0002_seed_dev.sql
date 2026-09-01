-- Dev-only seed data. There is no review-creation endpoint in build-order
-- step 1 (reviews are a later step), so this seeds one demo organization and
-- one review with fixed ids to make POST /v1/evidence exercisable against the
-- seeded organization header value. Not product data; local development only.
-- Fixed but RFC-4122-valid v4 UUIDs (version nibble 4, variant nibble 8) —
-- an all-zeros id like 00000000-0000-0000-0000-000000000001 fails strict UUID
-- validation (e.g. Zod's .uuid()) because its version/variant nibbles aren't
-- valid, which would make this seed data unusable against the API. Confirmed
-- by actually calling the endpoint with the original ids.
INSERT INTO organization (id, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Demo Organization')
ON CONFLICT (id) DO NOTHING;

INSERT INTO review (id, organization_id)
VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
