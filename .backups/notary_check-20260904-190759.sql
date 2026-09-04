--
-- PostgreSQL database dump
--

\restrict oWwaw3forwYlVcBmjYAjIfCwlqJCi82mGTLIpGRrM0xsaajt0d483OoiOF2GGyC

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15 (Debian 16.15-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: advance_event; Type: TABLE; Schema: public; Owner: notary
--

CREATE TABLE public.advance_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    suggestion_id uuid NOT NULL,
    event_type text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT advance_event_event_type_check CHECK ((event_type = ANY (ARRAY['shown'::text, 'revealed'::text, 'committed'::text, 'dismissed'::text])))
);


ALTER TABLE public.advance_event OWNER TO notary;

--
-- Name: advance_invocation; Type: TABLE; Schema: public; Owner: notary
--

CREATE TABLE public.advance_invocation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    review_id uuid,
    claim_id uuid,
    invocation_context_id text NOT NULL,
    task_mode text,
    has_evidence_constraint boolean DEFAULT false NOT NULL,
    allowed_moves jsonb DEFAULT '[]'::jsonb NOT NULL,
    policy_version text NOT NULL,
    model text NOT NULL,
    prompt_version text NOT NULL,
    status text NOT NULL,
    error text,
    input_tokens integer,
    output_tokens integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    estimated_cost_millicents bigint,
    estimated_cost_cents integer GENERATED ALWAYS AS (((estimated_cost_millicents / 1000))::integer) STORED,
    CONSTRAINT advance_invocation_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'error'::text, 'skipped'::text])))
);


ALTER TABLE public.advance_invocation OWNER TO notary;

--
-- Name: advance_suggestion; Type: TABLE; Schema: public; Owner: notary
--

CREATE TABLE public.advance_suggestion (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invocation_id uuid NOT NULL,
    model_suggestion_id text NOT NULL,
    ordinal integer NOT NULL,
    move text NOT NULL,
    short_label text NOT NULL,
    prompt text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT advance_suggestion_move_check CHECK ((move = ANY (ARRAY['clarify'::text, 'test'::text, 'compare'::text, 'repair'::text])))
);


ALTER TABLE public.advance_suggestion OWNER TO notary;

--
-- Name: challenge_item; Type: TABLE; Schema: public; Owner: notary
--

CREATE TABLE public.challenge_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    claim_id uuid NOT NULL,
    ordinal integer NOT NULL,
    challenge_type text NOT NULL,
    action text NOT NULL,
    prompt text NOT NULL,
    why_it_matters text NOT NULL,
    model text NOT NULL,
    prompt_version text NOT NULL,
    track1_state text NOT NULL,
    track1_state_reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT challenge_item_action_check CHECK ((action = ANY (ARRAY['clarify_claim'::text, 'add_source'::text, 'open_evidence'::text, 'ask_host'::text, 'draft_test'::text, 'leave_unchanged'::text]))),
    CONSTRAINT challenge_item_challenge_type_check CHECK ((challenge_type = ANY (ARRAY['ambiguity'::text, 'missing_assumption'::text, 'alternative_interpretation'::text, 'evidence_request'::text, 'adversarial_test'::text])))
);


ALTER TABLE public.challenge_item OWNER TO notary;

--
-- Name: claim; Type: TABLE; Schema: public; Owner: notary
--

CREATE TABLE public.claim (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    review_id uuid NOT NULL,
    ordinal integer NOT NULL,
    text text NOT NULL,
    decontextualized_form text,
    materiality boolean DEFAULT false NOT NULL,
    state text DEFAULT 'INDETERMINATE'::text NOT NULL,
    no_source boolean DEFAULT false NOT NULL,
    state_reason text,
    policy_version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    lifecycle_state text DEFAULT 'completed'::text NOT NULL,
    lifecycle_detail text,
    CONSTRAINT claim_lifecycle_state_check CHECK ((lifecycle_state = ANY (ARRAY['not_extracted'::text, 'extracted'::text, 'submitted'::text, 'completed'::text, 'not_checkable'::text, 'failed'::text]))),
    CONSTRAINT claim_state_check CHECK ((state = ANY (ARRAY['SUPPORTED'::text, 'CONTRADICTED'::text, 'UNSUPPORTED'::text, 'INDETERMINATE'::text])))
);


ALTER TABLE public.claim OWNER TO notary;

--
-- Name: evidence; Type: TABLE; Schema: public; Owner: notary
--

CREATE TABLE public.evidence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    review_id uuid NOT NULL,
    origin text NOT NULL,
    submitted_url text,
    canonical_url text,
    payload_ref text,
    payload_hash text,
    retrieval_status text DEFAULT 'pending'::text NOT NULL,
    retrieved_at timestamp with time zone,
    locator_scheme text,
    retention_until timestamp with time zone,
    submitted_by text,
    snapshot_reuse_policy text,
    access_revoked_at timestamp with time zone,
    resolved_text text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    content_kind text,
    text_provenance text,
    canonical_text_hash text,
    parse_status text DEFAULT 'not_attempted'::text NOT NULL,
    parse_error text,
    page_ranges jsonb,
    CONSTRAINT evidence_content_kind_check CHECK (((content_kind IS NULL) OR (content_kind = ANY (ARRAY['html'::text, 'plaintext'::text, 'pdf'::text, 'json'::text, 'inline_excerpt'::text])))),
    CONSTRAINT evidence_origin_check CHECK ((origin = ANY (ARRAY['answer_citation'::text, 'user_added'::text, 'workspace_collection'::text]))),
    CONSTRAINT evidence_parse_status_check CHECK ((parse_status = ANY (ARRAY['not_attempted'::text, 'parsed'::text, 'parse_failed'::text, 'not_parseable'::text]))),
    CONSTRAINT evidence_resolvable_unless_revoked CHECK (((access_revoked_at IS NOT NULL) OR (submitted_url IS NOT NULL) OR (payload_ref IS NOT NULL) OR (payload_hash IS NOT NULL))),
    CONSTRAINT evidence_retrieval_status_check CHECK ((retrieval_status = ANY (ARRAY['pending'::text, 'retrieved'::text, 'unavailable'::text, 'revoked'::text]))),
    CONSTRAINT evidence_text_provenance_check CHECK (((text_provenance IS NULL) OR (text_provenance = ANY (ARRAY['fetched'::text, 'caller_supplied'::text]))))
);


ALTER TABLE public.evidence OWNER TO notary;

--
-- Name: evidence_match; Type: TABLE; Schema: public; Owner: notary
--

CREATE TABLE public.evidence_match (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    claim_id uuid NOT NULL,
    evidence_id uuid NOT NULL,
    locator text NOT NULL,
    resolved_text_hash text NOT NULL,
    excerpt_ref text,
    applicability_json jsonb NOT NULL,
    relation text NOT NULL,
    method text NOT NULL,
    evaluator_version text NOT NULL,
    evaluated_at timestamp with time zone DEFAULT now() NOT NULL,
    locator_json jsonb,
    locator_resolved boolean DEFAULT false NOT NULL,
    locator_resolved_at timestamp with time zone,
    payload_revoked_at timestamp with time zone,
    CONSTRAINT evidence_match_method_check CHECK ((method = ANY (ARRAY['quoted_or_computed'::text, 'entailed'::text]))),
    CONSTRAINT evidence_match_relation_check CHECK ((relation = ANY (ARRAY['supports'::text, 'contradicts'::text])))
);


ALTER TABLE public.evidence_match OWNER TO notary;

--
-- Name: organization; Type: TABLE; Schema: public; Owner: notary
--

CREATE TABLE public.organization (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    plan text DEFAULT 'starter'::text NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    clerk_user_id text,
    entitlement_status text DEFAULT 'active'::text NOT NULL,
    track2_enabled boolean DEFAULT false NOT NULL,
    advance_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT organization_entitlement_status_check CHECK ((entitlement_status = ANY (ARRAY['active'::text, 'past_due'::text, 'canceled'::text, 'inactive'::text])))
);


ALTER TABLE public.organization OWNER TO notary;

--
-- Name: organization_api_key; Type: TABLE; Schema: public; Owner: notary
--

CREATE TABLE public.organization_api_key (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    key_hash text NOT NULL,
    key_prefix text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);


ALTER TABLE public.organization_api_key OWNER TO notary;

--
-- Name: review; Type: TABLE; Schema: public; Owner: notary
--

CREATE TABLE public.review (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    idempotency_key text,
    status text DEFAULT 'processing'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT review_status_check CHECK ((status = ANY (ARRAY['processing'::text, 'complete'::text, 'failed'::text])))
);


ALTER TABLE public.review OWNER TO notary;

--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: notary
--

CREATE TABLE public.schema_migrations (
    version text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.schema_migrations OWNER TO notary;

--
-- Name: usage_event; Type: TABLE; Schema: public; Owner: notary
--

CREATE TABLE public.usage_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid,
    review_id uuid,
    event_type text NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    fetch_bytes bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    estimated_cost_millicents bigint DEFAULT 0 NOT NULL,
    estimated_cost_cents integer GENERATED ALWAYS AS (((estimated_cost_millicents / 1000))::integer) STORED
);


ALTER TABLE public.usage_event OWNER TO notary;

--
-- Name: user; Type: TABLE; Schema: public; Owner: notary
--

CREATE TABLE public."user" (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL
);


ALTER TABLE public."user" OWNER TO notary;

--
-- Name: waitlist_signup; Type: TABLE; Schema: public; Owner: notary
--

CREATE TABLE public.waitlist_signup (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    source text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    invited_at timestamp with time zone
);


ALTER TABLE public.waitlist_signup OWNER TO notary;

--
-- Data for Name: advance_event; Type: TABLE DATA; Schema: public; Owner: notary
--

COPY public.advance_event (id, suggestion_id, event_type, created_at) FROM stdin;
\.


--
-- Data for Name: advance_invocation; Type: TABLE DATA; Schema: public; Owner: notary
--

COPY public.advance_invocation (id, organization_id, review_id, claim_id, invocation_context_id, task_mode, has_evidence_constraint, allowed_moves, policy_version, model, prompt_version, status, error, input_tokens, output_tokens, created_at, estimated_cost_millicents) FROM stdin;
9787895e-c8d3-4591-8e43-9647e14c7d0b	898a0428-7981-49df-be54-f8c25c1c6d13	5b540531-b318-4747-8bfe-190077d3b34d	fe9bd89a-7cdd-48a3-9c6f-1e8a158fe9ed	fe9bd89a-7cdd-48a3-9c6f-1e8a158fe9ed	\N	f	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	636	60	2026-09-03 15:54:36.458929+00	\N
9619179f-fef3-49fd-a901-b4775936d320	1cde4d65-3d8d-4135-859b-2ec318545a24	69afb86d-1071-4543-b11e-d68697e6f68d	4a2a3686-c2f8-4359-a334-f2483d078dfd	4a2a3686-c2f8-4359-a334-f2483d078dfd	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	755	73	2026-09-03 16:01:53.363412+00	\N
ea0dde95-d4dc-4a8e-a1d7-40e3ec877cdb	898a0428-7981-49df-be54-f8c25c1c6d13	a38c7b56-e320-4285-a84c-109fed6c29f4	ad3c6ed8-e0a1-4f6c-bebe-5d4bf17f3b5e	ad3c6ed8-e0a1-4f6c-bebe-5d4bf17f3b5e	\N	f	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	655	69	2026-09-03 16:02:48.185606+00	\N
177f5d4f-e068-4e2a-b8d0-6d59a2c6a94c	898a0428-7981-49df-be54-f8c25c1c6d13	62f76753-10b4-4f58-a637-423dd2a28721	13a650e0-fcfe-481c-befa-de36f92694c7	13a650e0-fcfe-481c-befa-de36f92694c7	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	788	141	2026-09-03 16:03:40.791539+00	\N
c93e625a-53c1-4043-a736-caaab0a35b99	898a0428-7981-49df-be54-f8c25c1c6d13	4d2dfcff-105d-4d3a-ad02-47bbdca1f3d9	12def89b-920d-4744-ac73-77b2e342605b	12def89b-920d-4744-ac73-77b2e342605b	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	733	75	2026-09-03 17:20:35.462595+00	\N
bb97cf4b-49c7-430b-8fc4-38f086a42d34	898a0428-7981-49df-be54-f8c25c1c6d13	e8a8a00f-698c-4b17-8341-4fe8055d023e	f4c70fca-c8dd-480e-b377-4b14e86e52ee	f4c70fca-c8dd-480e-b377-4b14e86e52ee	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	732	74	2026-09-03 17:25:20.151862+00	\N
52eb4742-4fbd-49f2-a46b-01ac70efe3c4	898a0428-7981-49df-be54-f8c25c1c6d13	e8a8a00f-698c-4b17-8341-4fe8055d023e	1f025671-3dec-4fed-811b-933a9252b814	1f025671-3dec-4fed-811b-933a9252b814	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	729	67	2026-09-03 17:25:21.540978+00	\N
cd549626-61dd-4570-9e3d-ee1926eba831	898a0428-7981-49df-be54-f8c25c1c6d13	e56ac6de-048c-4b5b-8fb4-28b5293295f9	b3cd9c4f-45ee-4a76-ab3d-a5ac77126da4	b3cd9c4f-45ee-4a76-ab3d-a5ac77126da4	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	726	63	2026-09-03 17:25:29.427874+00	\N
df42b065-781a-452f-9311-b24f6a617ba7	898a0428-7981-49df-be54-f8c25c1c6d13	e56ac6de-048c-4b5b-8fb4-28b5293295f9	5a062e0a-314b-4889-97cb-9bc2c301753f	5a062e0a-314b-4889-97cb-9bc2c301753f	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	723	7	2026-09-03 17:25:30.480322+00	\N
ddb9b265-e457-4719-9ea9-10773bd747c1	898a0428-7981-49df-be54-f8c25c1c6d13	8ab16362-fc81-4096-8a32-b92917a4e5f9	eccde565-adea-48d2-9d58-5dc8fab09f03	eccde565-adea-48d2-9d58-5dc8fab09f03	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	717	78	2026-09-03 17:25:36.925305+00	\N
5629713d-bc09-4c4b-ab57-d8ee3f320944	898a0428-7981-49df-be54-f8c25c1c6d13	8ab16362-fc81-4096-8a32-b92917a4e5f9	76d115ed-bd2b-432f-a9f3-fef7c37c383a	76d115ed-bd2b-432f-a9f3-fef7c37c383a	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	725	7	2026-09-03 17:25:37.884904+00	\N
0406af22-f913-4e25-8d23-a21d24814d46	898a0428-7981-49df-be54-f8c25c1c6d13	7ebc7f60-be1c-4a63-9d9d-7dce632bf049	df3dee81-d8ae-4135-8ca7-f50b88fdebd5	df3dee81-d8ae-4135-8ca7-f50b88fdebd5	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	741	7	2026-09-03 17:25:58.933134+00	\N
f55c2322-ddb3-4315-b6b5-a7ccb8123b86	898a0428-7981-49df-be54-f8c25c1c6d13	7ebc7f60-be1c-4a63-9d9d-7dce632bf049	7958ed49-1f9b-4818-a7b2-68ca3e4321b4	7958ed49-1f9b-4818-a7b2-68ca3e4321b4	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	743	161	2026-09-03 17:26:09.555899+00	\N
7e60d831-940a-4892-b73b-a97c9f3d4362	898a0428-7981-49df-be54-f8c25c1c6d13	cc974c09-131a-452b-9faf-36683f71c3cc	8fabb3d5-be06-4681-9a11-4259457d091a	8fabb3d5-be06-4681-9a11-4259457d091a	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	736	83	2026-09-03 17:26:33.944023+00	\N
d7120891-3823-4097-8c8c-979b1343d81c	898a0428-7981-49df-be54-f8c25c1c6d13	cc974c09-131a-452b-9faf-36683f71c3cc	33317f47-325b-4731-8974-115c1bf4c739	33317f47-325b-4731-8974-115c1bf4c739	\N	f	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	605	93	2026-09-03 17:26:44.857006+00	\N
fb770c64-308e-42e3-8c0a-66ac2ca9a88d	898a0428-7981-49df-be54-f8c25c1c6d13	cc974c09-131a-452b-9faf-36683f71c3cc	36022e30-73ca-4811-add9-29d376b6a97f	36022e30-73ca-4811-add9-29d376b6a97f	\N	f	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	601	70	2026-09-03 17:26:58.9027+00	\N
bf0fa925-a46b-4fba-bc74-e34a06dfc6e2	898a0428-7981-49df-be54-f8c25c1c6d13	742c88de-a16f-4eed-9301-be5b8a3d800f	9642c2b0-aa60-4294-8a5a-ca7d3461e4e5	9642c2b0-aa60-4294-8a5a-ca7d3461e4e5	\N	f	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	606	98	2026-09-03 17:27:17.800479+00	\N
45c56065-9c5d-49b1-8594-ee766ae55952	898a0428-7981-49df-be54-f8c25c1c6d13	742c88de-a16f-4eed-9301-be5b8a3d800f	e725376f-a811-4559-8f80-b8ab5e28a82b	e725376f-a811-4559-8f80-b8ab5e28a82b	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	735	171	2026-09-03 17:27:24.172956+00	\N
637abb74-2935-4405-92fe-5822b4b9ad4f	898a0428-7981-49df-be54-f8c25c1c6d13	3c6adbec-a8f8-4848-b373-745a41d4b0f4	0b64ae36-2291-46d4-9b9f-4aa66b68c696	0b64ae36-2291-46d4-9b9f-4aa66b68c696	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	758	7	2026-09-03 17:27:50.560027+00	\N
de5169b9-8091-45b5-a1c5-03d059e04443	898a0428-7981-49df-be54-f8c25c1c6d13	3c6adbec-a8f8-4848-b373-745a41d4b0f4	14d741ce-c43f-45ba-bf5f-518a1e3d5015	14d741ce-c43f-45ba-bf5f-518a1e3d5015	\N	f	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	603	79	2026-09-03 17:28:01.64663+00	\N
2689cd34-1061-4dcc-9d14-7ae40dfbcf05	898a0428-7981-49df-be54-f8c25c1c6d13	f04116ec-3343-4814-ba2c-6476774a08fc	80a16b24-c71e-42c0-b41c-5915f9dc9a33	80a16b24-c71e-42c0-b41c-5915f9dc9a33	\N	f	[]	2026-09-03.1	none	none	skipped	no_user_request	\N	\N	2026-09-03 17:49:38.402705+00	\N
d524163b-fb69-496f-9471-e0ebf8d09460	898a0428-7981-49df-be54-f8c25c1c6d13	857f6530-de07-414e-9db6-e90c5c8288a0	43a67e43-a350-4275-b5aa-289cfe057ffa	43a67e43-a350-4275-b5aa-289cfe057ffa	\N	f	[]	2026-09-03.1	none	none	skipped	no_user_request	\N	\N	2026-09-03 17:49:45.079522+00	\N
4f513219-6a3a-4cf7-87b0-9aa17b819265	898a0428-7981-49df-be54-f8c25c1c6d13	8425c356-9eba-40d1-9ec5-71a023eb2774	ef54efad-3ea4-44cd-9861-39fda0d104a2	ef54efad-3ea4-44cd-9861-39fda0d104a2	\N	f	[]	2026-09-03.1	none	none	skipped	no_user_request	\N	\N	2026-09-03 18:33:35.253974+00	\N
d8f2be31-30ca-47bc-afa1-383abb1cfc1b	898a0428-7981-49df-be54-f8c25c1c6d13	00b5c1d5-7be1-434b-a664-c520a613d4ee	7e39abf8-3d51-4e75-b5d5-8acb1fa74c68	7e39abf8-3d51-4e75-b5d5-8acb1fa74c68	\N	f	[]	2026-09-03.1	none	none	skipped	no_user_request	\N	\N	2026-09-03 18:33:42.206936+00	\N
b9f1b80e-7f9b-4396-b7c3-6c5a3e23011a	898a0428-7981-49df-be54-f8c25c1c6d13	1d0d85e9-64eb-4398-9392-1a7fb515c872	5c27d5d1-21e6-41b4-b0dd-ebd88b94ec9d	5c27d5d1-21e6-41b4-b0dd-ebd88b94ec9d	\N	f	[]	2026-09-03.1	none	none	skipped	no_user_request	\N	\N	2026-09-03 18:47:57.747224+00	\N
0dcdf63b-4c09-48a4-80ce-2718afe2f026	1cde4d65-3d8d-4135-859b-2ec318545a24	b0cf4531-7c84-48c9-b9b9-1504b083c0d9	8f93dfd9-9288-4357-864f-6bfcc081d190	8f93dfd9-9288-4357-864f-6bfcc081d190	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	730	91	2026-09-04 02:55:52.445781+00	22
5cdef0f5-2399-48bc-ab35-0efc380daa73	1cde4d65-3d8d-4135-859b-2ec318545a24	fb321bdb-902b-438e-8f47-c751f7c738e5	00ba0e7a-5cc4-41b2-b067-3dc7019249b6	00ba0e7a-5cc4-41b2-b067-3dc7019249b6	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	740	90	2026-09-04 04:01:59.943193+00	22
7e980be4-84ff-4c66-840c-bf82cc43be25	1cde4d65-3d8d-4135-859b-2ec318545a24	9d610dc7-f5b3-473a-aae3-a02704a59380	efc0e1b8-bc9d-4fda-bdef-595cc9a03487	efc0e1b8-bc9d-4fda-bdef-595cc9a03487	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	734	64	2026-09-04 04:02:10.278928+00	20
b0746622-4844-45d0-af19-bde7c877bf3c	1cde4d65-3d8d-4135-859b-2ec318545a24	e092ccc9-1b78-4919-a53e-012e70047461	a37afb78-af75-4918-ac32-146313e9abbc	a37afb78-af75-4918-ac32-146313e9abbc	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-03.2	ok	\N	738	7	2026-09-04 04:09:42.430533+00	17
b3e81cff-3753-4e65-9aa5-062b68a2030e	898a0428-7981-49df-be54-f8c25c1c6d13	76138ddc-9042-469b-a1c7-0cc6df02db33	8c448d9a-87e7-455a-a160-af0f6af3aebc	8c448d9a-87e7-455a-a160-af0f6af3aebc	\N	f	[]	2026-09-03.1	none	none	skipped	no_user_request	\N	\N	2026-09-04 15:58:05.400646+00	\N
d000faa3-90b0-4380-baa5-f0d2f0aa0ad0	898a0428-7981-49df-be54-f8c25c1c6d13	6b4ed876-9a9a-4402-850d-d5d7d86a0efd	6f1b004c-41c1-4b60-b53f-7d8fb090fd4d	6f1b004c-41c1-4b60-b53f-7d8fb090fd4d	\N	f	[]	2026-09-03.1	none	none	skipped	no_user_request	\N	\N	2026-09-04 16:00:58.174599+00	\N
4edabb67-75ad-4d72-a094-0f06882615a6	1cde4d65-3d8d-4135-859b-2ec318545a24	4a63340c-886d-4a54-8b0c-bb3062ce342f	29219a30-ee23-4676-9bb1-b764e59e8c58	29219a30-ee23-4676-9bb1-b764e59e8c58	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-04.1	ok	\N	734	121	2026-09-04 17:49:19.005242+00	24
bb138129-ee96-4f8e-88cd-407216c5c85e	898a0428-7981-49df-be54-f8c25c1c6d13	c5ff95ef-71b8-4263-a9e6-75030bbb18de	26790975-5e6f-4797-babf-fb43109b1607	26790975-5e6f-4797-babf-fb43109b1607	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-04.1	ok	\N	775	7	2026-09-04 18:04:42.016942+00	18
01d181f1-ec16-4596-a5a3-e126ec156024	898a0428-7981-49df-be54-f8c25c1c6d13	c5ff95ef-71b8-4263-a9e6-75030bbb18de	494e88c1-fc77-4cfa-a625-10ffe3332f4a	494e88c1-fc77-4cfa-a625-10ffe3332f4a	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-04.1	ok	\N	767	175	2026-09-04 18:04:43.48381+00	28
ad01addd-12ae-40e0-a43d-9294b001386a	898a0428-7981-49df-be54-f8c25c1c6d13	c5ff95ef-71b8-4263-a9e6-75030bbb18de	c10e04d1-30ec-4a6d-bf9b-559d6299d6f1	c10e04d1-30ec-4a6d-bf9b-559d6299d6f1	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-04.1	ok	\N	768	189	2026-09-04 18:04:43.617274+00	29
95a0859a-c6fa-454c-938e-6d8232d81b78	898a0428-7981-49df-be54-f8c25c1c6d13	c5ff95ef-71b8-4263-a9e6-75030bbb18de	fc661646-bf4a-4c67-8eec-c0de8a9243d2	fc661646-bf4a-4c67-8eec-c0de8a9243d2	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-04.1	ok	\N	779	209	2026-09-04 18:04:43.838108+00	31
1e0e1a69-6ef8-4dde-90db-78bc3aa94fe3	898a0428-7981-49df-be54-f8c25c1c6d13	c5ff95ef-71b8-4263-a9e6-75030bbb18de	a7555336-d59d-4d58-b05f-5766bda0ce86	a7555336-d59d-4d58-b05f-5766bda0ce86	\N	t	["clarify", "test", "compare", "repair"]	2026-09-03.1	deepseek-v4-flash	2026-09-04.1	ok	\N	780	211	2026-09-04 18:04:44.732447+00	31
\.


--
-- Data for Name: advance_suggestion; Type: TABLE DATA; Schema: public; Owner: notary
--

COPY public.advance_suggestion (id, invocation_id, model_suggestion_id, ordinal, move, short_label, prompt, created_at) FROM stdin;
e311a4cc-da86-4273-abf0-8108050db107	9787895e-c8d3-4591-8e43-9647e14c7d0b	s1	0	clarify	Ask for the source excerpt	Please provide the exact quoted excerpt from the source you want me to cite, since the evidence block is empty.	2026-09-03 15:54:36.463399+00
db7eeffd-7053-4333-af8a-034091d8cc50	9619179f-fef3-49fd-a901-b4775936d320	1	0	repair	Revenue growth claim contradicted	The source contradicts the 17% growth figure. Please revise your sentence to reflect what the source actually says about Acme's FY25 revenue growth, without asserting 17%.	2026-09-03 16:01:53.367215+00
a7b9a9c9-44e9-4a2f-a440-4f541161379b	ea0dde95-d4dc-4a8e-a1d7-40e3ec877cdb	s1	0	clarify	Ask for the source excerpt to quote	Please provide the exact quoted excerpt from the source that states Acme's FY25 revenue growth, so I can cite it accurately in the sentence.	2026-09-03 16:02:48.189415+00
4f792fac-d122-4eba-9c94-fcd79d7cdc31	177f5d4f-e068-4e2a-b8d0-6d59a2c6a94c	1	0	clarify	Ask for the actual source excerpt	Please provide the exact quoted excerpt from the source you want me to cite, since the evidence you gave does not include it. Without that, I cannot write the sentence as requested.	2026-09-03 16:03:40.795403+00
a0f3832d-9cea-4c55-ba33-d20b0b3d2d77	177f5d4f-e068-4e2a-b8d0-6d59a2c6a94c	2	1	repair	Flag contradiction before writing	The sealed evidence says the 17% growth claim is contradicted. Please revise your request: either provide a corrected figure or ask me to write the sentence without asserting 17% growth.	2026-09-03 16:03:40.798463+00
d3dcedde-a946-4e24-a1bd-95340af5effa	c93e625a-53c1-4043-a736-caaab0a35b99	s1	0	clarify	Ask Notary to check the actual height	Please ask Notary to check the actual height of the Eiffel Tower, not just the 10m claim, so we can get a definitive source-based answer.	2026-09-03 17:20:35.466423+00
ba7bca71-84f2-462f-a69c-bbbf9eab5fbf	bb97cf4b-49c7-430b-8fc4-38f086a42d34	clarify_claim	0	clarify	Clarify which false fact to check	Please specify the exact false claim about the Great Wall of China you want me to check, since the evidence only mentions one example but your request is general.	2026-09-03 17:25:20.155744+00
bd707752-31da-49c6-9d98-2280d327a506	52eb4742-4fbd-49f2-a46b-01ac70efe3c4	1	0	clarify	Ask for the specific false claim	Please provide the exact false fact about the Great Wall of China you want me to check, including the full sentence or claim as you have it.	2026-09-03 17:25:21.54413+00
76920262-0bca-41b4-9450-0d6df1332df0	cd549626-61dd-4570-9e3d-ee1926eba831	s1	0	clarify	Ask for the specific false claim to check	Please specify the exact false fact about the Moon you want me to check, so I can verify it properly.	2026-09-03 17:25:29.430238+00
18f52d09-96cf-4d61-bc9b-8d46c1b069dc	ddb9b265-e457-4719-9ea9-10773bd747c1	clarify_claim	0	clarify	Clarify which false fact to check	Please specify the exact false claim about Mount Everest you want checked, e.g., its height, location, or first ascent. The current request is too vague to act on.	2026-09-03 17:25:36.927772+00
01685813-aaf6-4641-9d52-fc34144d5a51	f55c2322-ddb3-4315-b6b5-a7ccb8123b86	s1	0	clarify	Clarify which Great Wall length is meant	The claim '5 kilometers long' is ambiguous. Please clarify which section or total length you are referring to (e.g., the Ming dynasty wall, all historical walls combined, or a specific restored section) before checking.	2026-09-03 17:26:09.5593+00
3165a421-4aa9-4bfa-baa9-1a951a468d3d	f55c2322-ddb3-4315-b6b5-a7ccb8123b86	s2	1	test	Test the claim against known lengths	Please check the claim 'The Great Wall of China is 5 kilometers long' by comparing it to commonly cited figures for the wall's total length and major sections, and explain whether 5 km matches any known measurement.	2026-09-03 17:26:09.562283+00
464037a5-162a-4069-88d9-4bf3bffce798	7e60d831-940a-4892-b73b-a97c9f3d4362	s1	0	clarify	Ask for the second part of the claim	The evidence only covers the height part of the claim. Please clarify whether you also want me to check the location part ('in New Zealand') separately, or if you want a combined verdict on the full statement.	2026-09-03 17:26:33.946467+00
fbe34d66-7cff-4adc-b5a6-5a3aac207c67	d7120891-3823-4097-8c8c-979b1343d81c	s1	0	clarify	Ask for clarification on the claim	Could you clarify what you mean by 'check'? Are you asking me to verify the factual accuracy of the statement, or are you asking me to explain why it might be incorrect? Also, please specify if you want me to correct the statement with the actual facts.	2026-09-03 17:26:44.86056+00
c5c58069-485b-46fb-b321-a4d4f8d1961e	fb770c64-308e-42e3-8c0a-66ac2ca9a88d	1	0	clarify	Ask for the source of the claim	Where did you get the claim that Mount Everest is 2,000 meters tall and in New Zealand? Please share the source so we can examine it.	2026-09-03 17:26:58.906484+00
1d58ee5f-2b6e-4809-b5cd-df82dccc5834	bf0fa925-a46b-4fba-bc74-e34a06dfc6e2	s1	0	clarify	Clarify which claim to check first	Please clarify: do you want me to check both claims separately, or focus on one? Also, specify what 'Amazon' refers to (the rainforest, the river, or the company) and what 'discovered by Columbus' means (first European contact, naming, etc.).	2026-09-03 17:27:17.804207+00
105fc070-a8b2-4fa5-b559-7349670aa5aa	45c56065-9c5d-49b1-8594-ee766ae55952	1	0	clarify	Clarify which Amazon and claim details	Please clarify: do you mean the Amazon rainforest or the Amazon River? Also, are you asking about the claim that the Amazon produces 15% of the world's oxygen, and whether Columbus discovered it? Please specify the exact claims you want checked.	2026-09-03 17:27:24.17575+00
1fe18d49-ec0d-46d2-a48e-402a1894c0cf	45c56065-9c5d-49b1-8594-ee766ae55952	2	1	test	Test the oxygen production claim separately	Please check the claim that the Amazon produces 15% of the world's oxygen. Can you find reliable sources that support or refute this percentage? Also, note that the discovery claim has been checked as unsupported, so focus on the oxygen claim.	2026-09-03 17:27:24.177862+00
a832c011-554e-477c-a5c4-647041dad6b1	de5169b9-8091-45b5-a1c5-03d059e04443	s1	0	clarify	Clarify the claim's source or intent	Could you clarify where you heard this claim or what you're trying to verify? It sounds like a myth or joke, but knowing the context will help me give a more useful answer.	2026-09-03 17:28:01.654412+00
f85f07df-c2bf-4367-8265-f0dd3d93506a	0dcdf63b-4c09-48a4-80ce-2718afe2f026	s1	0	repair	Ask assistant to recheck the FY25 revenue growth figure	Please re-examine the FY25 revenue growth figure in my draft. The claim that Acme's revenue grew 17% in FY25 appears to be contradicted. Can you identify the correct figure or flag the discrepancy for correction?	2026-09-04 02:55:52.448981+00
e6a389a9-6350-4e81-842f-da8bdb4b9d79	5cdef0f5-2399-48bc-ab35-0efc380daa73	s1	0	repair	Ask assistant to recheck the FY25 revenue growth figure	Please recheck the FY25 revenue growth figure in my draft. The claim that Acme's revenue grew 17% in FY25 has been flagged as contradicted. Can you verify the correct figure and update the draft accordingly?	2026-09-04 04:01:59.94786+00
8d154a10-130b-415c-90a5-f2b9711a222c	7e980be4-84ff-4c66-840c-bf82cc43be25	1	0	repair	Ask for the correct FY25 revenue growth figure	The FY25 revenue growth figure in my draft appears to be contradicted. Please provide the correct figure or the source data so I can update the draft.	2026-09-04 04:02:10.283837+00
5e605620-c593-47b5-b901-1ee7ac233f58	4edabb67-75ad-4d72-a094-0f06882615a6	1	0	clarify	Ask for the source of the 17% figure	Please show me where the 17% FY25 revenue growth figure comes from in the draft, and what underlying data or calculation it is based on.	2026-09-04 17:49:19.008839+00
89725cff-a3f0-43ae-b417-c349507d6a6e	4edabb67-75ad-4d72-a094-0f06882615a6	2	1	repair	Request a corrected revenue growth figure	Since the 17% figure appears to be contradicted, please help me locate the correct FY25 revenue growth number from the available financial data and update the draft accordingly.	2026-09-04 17:49:19.01129+00
fcadefcd-6038-48fa-8874-475fc879f519	01d181f1-ec16-4596-a5a3-e126ec156024	1	0	clarify	Clarify write pattern and read needs	Before recommending, please ask me to clarify the write pattern (mostly append-only vs. updates/deletes), the read/query patterns (e.g., time-range scans, filtering by entity), and whether strong consistency or only eventual consistency is acceptable for reads.	2026-09-04 18:04:43.487842+00
f931792f-a560-4236-ba3e-44acac9269e5	01d181f1-ec16-4596-a5a3-e126ec156024	2	1	compare	Compare cost models for 7-year retention	Please compare the storage and backup cost implications for Postgres vs. DynamoDB over a 7-year retention period, including how each service charges for storage, backups, and data transfer, and how the 50k writes/sec peak affects provisioning and cost.	2026-09-04 18:04:43.490531+00
0bb5c384-3980-48fc-b876-449892eafe1a	ad01addd-12ae-40e0-a43d-9294b001386a	1	0	clarify	Clarify write pattern and read needs	Before recommending, please clarify: are the 50k writes/sec sustained or bursty, and what are your read/query patterns (e.g., time-range scans, per-entity lookups)? Also, what is the expected data size per write and the acceptable query latency?	2026-09-04 18:04:43.619295+00
ffea355c-8571-48a5-a635-758d5e45a38f	ad01addd-12ae-40e0-a43d-9294b001386a	2	1	compare	Compare cost and retention trade-offs	Please compare Postgres and DynamoDB specifically for a 7-year retention audit log at 50k writes/sec, focusing on storage cost, write throughput cost, and query capabilities. Include how each handles data lifecycle (e.g., partitioning, TTL) and any AWS service limits that might affect this workload.	2026-09-04 18:04:43.621058+00
5019cced-f458-4289-8e7b-ed913d4337f1	95a0859a-c6fa-454c-938e-6d8232d81b78	1	0	clarify	Clarify write pattern and read needs	Before recommending, please clarify: are the 50k writes/sec sustained or peak bursts, and what is the read/query pattern for the audit log (e.g., frequent time-range scans, point lookups, or rare compliance queries)? Also, is the 7-year retention with hot or cold tiering acceptable?	2026-09-04 18:04:43.840187+00
6864e583-f412-4d35-9618-6a6499c599f0	95a0859a-c6fa-454c-938e-6d8232d81b78	2	1	compare	Compare cost and operational trade-offs	Please compare Postgres (RDS/Aurora) vs DynamoDB for this audit log use case, focusing on cost over 7 years, write scaling at 50k/sec, storage growth, and operational burden (e.g., backups, failover, partitioning). Include any AWS-specific features like DynamoDB TTL or Postgres partitioning that affect the decision.	2026-09-04 18:04:43.842036+00
93053467-11a1-4680-ab15-94083d9547fa	1e0e1a69-6ef8-4dde-90db-78bc3aa94fe3	1	0	clarify	Clarify write durability and consistency needs	Before comparing, please clarify the required durability and consistency model for the audit log: is synchronous replication or strong consistency needed, or is async/eventual acceptable? Also specify the expected read pattern (e.g., frequent queries by entity ID vs. time range) and whether you need transactions or secondary indexes.	2026-09-04 18:04:44.734774+00
2329dd8b-6ff8-406c-8433-d454305a2c2f	1e0e1a69-6ef8-4dde-90db-78bc3aa94fe3	2	1	compare	Ask for a cost and operational comparison	Please compare Postgres and DynamoDB for this audit log workload on: estimated monthly cost at 50k writes/sec with 7-year retention (including storage and I/O), operational complexity (e.g., scaling, backups, partitioning), and query flexibility for audit analysis. Also note any AWS managed options like Aurora Postgres vs. DynamoDB with TTL or archival to S3.	2026-09-04 18:04:44.736639+00
\.


--
-- Data for Name: challenge_item; Type: TABLE DATA; Schema: public; Owner: notary
--

COPY public.challenge_item (id, claim_id, ordinal, challenge_type, action, prompt, why_it_matters, model, prompt_version, track1_state, track1_state_reason, created_at) FROM stdin;
\.


--
-- Data for Name: claim; Type: TABLE DATA; Schema: public; Owner: notary
--

COPY public.claim (id, review_id, ordinal, text, decontextualized_form, materiality, state, no_source, state_reason, policy_version, created_at, lifecycle_state, lifecycle_detail) FROM stdin;
b3372b89-969c-4495-8e29-9f5ebda5fc70	75d461bc-384d-4cfa-8ec9-c769bb5adf56	1	The high today in San Francisco was 100F.	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
def18269-2add-4d52-ae0d-1b073754a4cc	9bcbaf02-68e4-4879-abf5-fc9719b38e39	1	The high today in San Francisco was 100°F.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
28bea8f2-ec9b-4fed-aff5-04e88fc38001	f5f37098-227d-42e5-8897-3a4025f5b4e9	1	Acme revenue grew 12% in FY25.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
e3470d36-c828-4ed6-afa0-f84d0ec3ff21	b0b8235e-7b28-4756-8105-7ab58ef833fa	1	Acme revenue grew 12% in FY25.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
c2d506bf-0e5d-4840-b980-7c3c81a27583	e0821f22-0347-46fd-a528-24f50d118d13	1	Acme revenue grew 12% in FY25.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
17a715f6-7f85-4d3a-9dfd-11484df91c57	bac96596-33a1-4855-80d1-1ac40220194f	1	Acme revenue grew 12% in FY25.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
9ffc3c4e-21db-480c-a076-c79cec2c4caa	b2d343d1-5b6a-44b7-8cb7-15afa02394ab	1	Acme revenue grew 12% in FY25.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
9dcdbe4a-3316-43f0-8227-6efa134d5695	7185a77b-abe3-4d7b-9661-4719b4061b66	1	Acme revenue grew 12% in FY25.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
b4f980f1-3546-47da-905d-5690bffcd144	155aab82-9c02-4d68-80d7-81c126e37287	1	Acme revenue grew 12% in FY25.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
c8e86353-a282-4fce-bb98-51ba80ff04d6	c6be0436-a291-4eaf-9c98-e79aa08b348c	1	Acme revenue grew 12% in FY25.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
21c2c6ce-80d9-4089-9f36-bf0ee5789afa	e8059a5f-950b-46d3-9736-55c685422afa	1	Acme revenue grew 12% in FY25.	\N	t	SUPPORTED	f	supporting_applicable_relation	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
04604524-598f-4cf8-8238-e07f99c41c66	d9289d77-c1cb-4d9b-9390-ee558b7e5d9a	1	Acme revenue grew 12% in FY25.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
925a39c7-b1b9-4dcc-b707-53fc6b588969	2822aea3-d109-41b1-980a-84bcfb15f885	1	Acme revenue grew 12% in FY25.	\N	t	SUPPORTED	f	supporting_applicable_relation	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
5ba88fd2-3cb5-45ca-a0ca-d029475e0652	68035d15-9a32-49c1-baf9-23ddf0696fde	1	Acme revenue grew 12% in FY25.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
8a1c842f-ee3b-46ad-b218-eeadcef1e18c	360d7382-e950-4bb3-a5aa-107c1a7b7157	1	Acme revenue grew 12% in FY25.	\N	t	SUPPORTED	f	supporting_applicable_relation	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
2884e496-5da1-47f8-8b9f-2072ffbb7503	3f6de5f2-2821-4b7b-bc0f-8e86e829ab80	1	Acme revenue grew 12% in FY25.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
e078b417-0783-4666-8849-68ccd8a7e70a	f2ca7663-8d2a-431d-a67d-30afe5f77b36	1	Acme revenue grew 12% in FY25.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
981c9cfc-a089-458e-a013-886f542a398f	7296fce3-f86c-4be0-98f1-c9e4a9a9032b	1	Acme revenue grew 12% in FY25.	\N	t	SUPPORTED	f	supporting_applicable_relation	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
e6ab81eb-5bc9-4b31-8bca-63c6467cff29	51437fe3-7560-4865-afde-c5a0f308042f	1	Acme revenue grew 12% in FY25.	\N	t	SUPPORTED	f	supporting_applicable_relation	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
54bf7e1c-d038-42fa-b34c-7d9f96cd1513	f576fc93-8576-474c-bd81-28d73fe7949c	1	Acme revenue grew 12% in FY25.	\N	t	SUPPORTED	f	supporting_applicable_relation	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
d5e6152b-592b-4c23-972e-680788678093	b4966a55-0020-4f79-94b4-8bd049fc9e24	1	Acme revenue grew 12% in FY25.	\N	t	SUPPORTED	f	supporting_applicable_relation	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
26ddf957-d16a-447d-a867-93d69543cab4	b722defc-f2d0-42b2-be4e-2419ea25a220	1	Acme revenue grew 12% in FY25.	\N	t	SUPPORTED	f	supporting_applicable_relation	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
1c0fb905-3b31-4fa4-b653-88759a4ba8aa	e5ff03a0-d51f-4cd1-9720-9d1a266e8dc2	1	Acme revenue grew 12% in FY25.	\N	t	SUPPORTED	f	supporting_applicable_relation	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
93f715ae-ef87-48b7-a360-515c1d44f555	ca0352bd-a23b-47b1-9fbc-b47eae6bbb44	1	Acme revenue grew 12% in FY25.	\N	t	SUPPORTED	f	supporting_applicable_relation	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
9a591dbc-9bd6-4f08-8c36-ce28f3908f1f	57b9dfe3-2ee8-47b5-8304-de9b74fd674c	1	Today's weather is 100 degrees in New York.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
12226b02-2c80-49de-bc46-4e846701ddda	398a80ff-8b73-47e1-8789-175947925390	1	Today the temperature is 100 degrees in New York.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
e4386f48-2845-43ad-bac0-8dcfc6f69650	49980520-b6df-4446-b572-ae6694225e46	1	New York weather is 100 degrees today.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
8bd4f965-03a0-4664-98c3-d2ac15607a94	af816396-305f-4514-ba7d-17dd7abe1d80	1	New York weather is 100 degrees today.	\N	t	CONTRADICTED	f	contradicting_applicable_relation	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
fc41c983-951d-40b9-9f89-3588b57dc252	557d2709-a51d-4a23-a09d-476de5de648f	1	Acme Corp grew revenue 17% in FY25, per their investor letter.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
01f1a727-f013-4477-9001-c21385ebbfb6	6f31c5df-8741-4b70-bef2-ebdb14c0f5d8	1	Acme Corp revenue grew 17% in FY25.	\N	t	SUPPORTED	f	supporting_applicable_relation	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
95811f19-2742-4c36-a005-5b724f071be2	483ac3a9-2e2e-488b-a50d-b8f49c56a51d	1	Acme, Inc. revenue grew 17% in FY25.	\N	t	SUPPORTED	f	supporting_applicable_relation	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
fb99923f-9cec-49ff-86e3-b356e1a43c93	cd0a122c-7aa1-4a6d-bb73-4e3bde864fd8	1	Acme Inc revenue grew 17% in FY25.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
7aa45ffe-3455-4430-8b24-f5a96e47c74c	a7faef25-a927-4eac-886f-20a65ebc9840	1	Acme Inc revenue grew 17% in FY25.	\N	t	CONTRADICTED	f	contradicting_applicable_relation	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
8080a79d-0874-4bf4-8f0a-7a3dfe37e199	ff8af00d-4652-4127-909b-22d3a57023c4	1	Acme's revenue grew 17% in FY25	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
f1bf3149-c98a-4074-a949-a42223b1875b	ff8af00d-4652-4127-909b-22d3a57023c4	2	The overall SaaS market grew 17% in 2025 across all vendors.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
43b2a784-cd80-4631-a69e-c487e5e69c4f	f29b7b2f-7ea3-4378-8ecb-75efd89f55d0	1	Acme's revenue grew 17% in FY25	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
63de3639-a817-4806-9faa-47fddd80726f	f29b7b2f-7ea3-4378-8ecb-75efd89f55d0	2	Acme's FY25 annual report says revenue increased 12% year over year.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
78e2e6a5-afb5-4708-aa8b-653fec62c8bd	3465c010-b3f0-45ee-8bf8-2f31ccc2baf2	1	Acme's revenue grew 17% in FY25.	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
f1abea6f-8c16-458f-9469-6f9f141e14db	73f0050e-90bf-4fdf-9ae0-c8eb89f85ae9	1	Acme's revenue grew 17% in FY25	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
940cc11b-8471-409c-9ff2-67a9c869a117	73f0050e-90bf-4fdf-9ae0-c8eb89f85ae9	2	Acme's FY25 annual report says revenue increased 12% year over year.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
d5de729a-34c7-48a2-85fe-94bb4c7aaf69	3b754d67-11e1-47fe-99eb-42759ad15654	1	Tesla delivered 2 million vehicles in 2024.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
850ba2a0-eed3-490f-a940-6a349c3920b3	f0783aee-647c-4c84-a36d-f754ec6873e8	1	Tesla's market cap is currently around $40 million.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
4f7a8617-c555-4dac-9dd4-4c0c5cc2bdc8	d5968b32-9703-49e8-9642-7692312beeea	1	The Eiffel Tower is 50 meters tall.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
bd20fd78-1189-460b-a00b-98fcf5d77637	2edd9b66-46da-477e-8958-b17b3dcc0f5d	1	The Great Wall of China is 5 kilometers long.	\N	t	CONTRADICTED	f	contradicting_applicable_relation	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
efca469a-10f3-4207-8885-5db131dc3e4c	27aee64d-3c41-4b07-a330-1932b7f2acfc	1	The human body has 600 bones.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
c17d19d2-efac-4be8-947e-4af1de13fce8	5d6b5b15-c4da-461e-b3ac-c702a82b6831	1	Mount Everest is 500 meters tall.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
cfcdfb1d-1808-4356-87a8-32bbe6464bc6	5758bfa1-c74b-480a-873f-42bd3f8e53f7	1	Water boils at 500°C at sea level.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
1f7f854e-f000-4950-8b14-e511c0b33c8d	d37c344a-7dcd-4d69-b0d7-eebd55bd6a49	1	The Amazon River is 50 miles long.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
819cd627-a9cd-49bf-b3f5-6574b39960e9	a16a600d-f76b-4a20-bab3-e91db60ff4e3	1	The Sahara Desert covers 100 square kilometers.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
50a140e4-9895-4259-b88a-cfe945d4f19b	1cdbec9f-2717-4d8b-bd33-35d9b5b01f5f	1	Jupiter has 2 moons.	\N	t	CONTRADICTED	f	contradicting_applicable_relation	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
a3f4f738-bd75-4f99-af36-fc2c39a3c43d	39576b36-9750-476c-80f7-c18eba56f664	1	The Pacific Ocean covers 2% of Earth's surface.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
05f73744-3de9-4b2a-8c62-7b1f96c653bc	8ba60294-2767-44f0-abe5-b776d72ec30a	1	The Great Barrier Reef is 2 kilometers long.	\N	t	SUPPORTED	f	supporting_applicable_relation	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
6023e220-a992-41df-aa3f-d6758530c09b	6ad02183-7e15-411a-b620-14fbff5f44a6	1	Today's weather is 100 degrees in New York.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
c9d7b7ef-62c8-411a-903e-b9a393faf666	ad537204-9bae-4c19-8f60-bb13ef1ea37e	1	The Great Barrier Reef is 2 kilometers long.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
c2df96fa-8e58-469f-ac85-e0b2d5409048	a3409dfe-acfc-41b2-b3d8-c36123e29f1b	1	Today's weather is 100 degrees in New York.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
cf7b3ecb-d99d-4b73-a146-026b3c8e8c77	c578936f-b348-466b-bc53-79ed7bfdcb4d	1	The Great Barrier Reef is 2 kilometers long.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
8559b20f-02a5-4410-a94f-a97c18352c32	4a216943-a359-44a8-88a2-77a781c24905	1	Today's weather is 100 degrees in New York.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
e9902af1-5bd6-4cc2-9e8d-af1cc5eb11b0	516effa8-143c-43c9-ba3d-0f1fa17514b4	1	The Great Barrier Reef is 2 kilometers long.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
d6345568-d835-408b-99b6-add1a29b531b	8c12741e-8c1e-4d4b-b18b-b2c553bfefbb	1	Today's weather is 100 degrees in New York.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
b9de36fb-9cff-4019-84b0-2f03a734997c	911421e1-cb73-4d8f-ae81-9861f98fa0b5	1	The Great Barrier Reef is 2 kilometers long.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 15:03:39.832699+00	completed	\N
fe9bd89a-7cdd-48a3-9c6f-1e8a158fe9ed	5b540531-b318-4747-8bfe-190077d3b34d	1	Acme Corp's revenue grew 12% in fiscal year 2025	\N	t	SUPPORTED	f	supporting_applicable_relation	orchestrator-v1	2026-09-03 15:54:35.166267+00	completed	\N
4a2a3686-c2f8-4359-a334-f2483d078dfd	69afb86d-1071-4543-b11e-d68697e6f68d	1	Acme Corp's revenue grew 17% in fiscal year 2025	\N	t	CONTRADICTED	f	contradicting_applicable_relation	orchestrator-v1	2026-09-03 16:01:51.111183+00	completed	\N
ad3c6ed8-e0a1-4f6c-bebe-5d4bf17f3b5e	a38c7b56-e320-4285-a84c-109fed6c29f4	1	Acme Corp's revenue grew 12 percent in fiscal 2025	\N	t	SUPPORTED	f	supporting_applicable_relation	orchestrator-v1	2026-09-03 16:02:45.883471+00	completed	\N
13a650e0-fcfe-481c-befa-de36f92694c7	62f76753-10b4-4f58-a637-423dd2a28721	1	Acme Corp's revenue grew 17% in fiscal year 2025	\N	t	CONTRADICTED	f	contradicting_applicable_relation	orchestrator-v1	2026-09-03 16:03:37.819451+00	completed	\N
12def89b-920d-4744-ac73-77b2e342605b	4d2dfcff-105d-4d3a-ad02-47bbdca1f3d9	1	The Eiffel Tower is 10 meters tall.	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-03 17:20:34.396239+00	completed	\N
f4c70fca-c8dd-480e-b377-4b14e86e52ee	e8a8a00f-698c-4b17-8341-4fe8055d023e	1	The Great Wall of China is only 5 kilometers long	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-03 17:25:18.843001+00	completed	\N
1f025671-3dec-4fed-811b-933a9252b814	e8a8a00f-698c-4b17-8341-4fe8055d023e	2	and was built entirely in the year 1987.	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-03 17:25:20.170536+00	completed	\N
b3cd9c4f-45ee-4a76-ab3d-a5ac77126da4	e56ac6de-048c-4b5b-8fb4-28b5293295f9	1	The Moon orbits Earth every 3 days	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-03 17:25:28.113461+00	completed	\N
5a062e0a-314b-4889-97cb-9bc2c301753f	e56ac6de-048c-4b5b-8fb4-28b5293295f9	2	and is made primarily of Swiss cheese	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-03 17:25:29.441854+00	completed	\N
eccde565-adea-48d2-9d58-5dc8fab09f03	8ab16362-fc81-4096-8a32-b92917a4e5f9	1	Mount Everest is 2,000 meters tall	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-03 17:25:35.728271+00	completed	\N
76d115ed-bd2b-432f-a9f3-fef7c37c383a	8ab16362-fc81-4096-8a32-b92917a4e5f9	2	is located in New Zealand	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-03 17:25:36.93927+00	completed	\N
df3dee81-d8ae-4135-8ca7-f50b88fdebd5	7ebc7f60-be1c-4a63-9d9d-7dce632bf049	1	The Great Wall of China is only 5 kilometers long.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 17:25:58.109413+00	completed	\N
7958ed49-1f9b-4818-a7b2-68ca3e4321b4	7ebc7f60-be1c-4a63-9d9d-7dce632bf049	2	According to historical records, it was built entirely during the Ming dynasty between 1368-1644 AD.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 17:26:07.967466+00	completed	\N
8fabb3d5-be06-4681-9a11-4259457d091a	cc974c09-131a-452b-9faf-36683f71c3cc	1	Mount Everest is 2,000 meters tall	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 17:26:32.420863+00	completed	\N
33317f47-325b-4731-8974-115c1bf4c739	cc974c09-131a-452b-9faf-36683f71c3cc	2	and is located in New Zealand	\N	t	INDETERMINATE	f	checks_did_not_complete	orchestrator-v1	2026-09-03 17:26:43.65223+00	not_checkable	required_field_unresolved
36022e30-73ca-4811-add9-29d376b6a97f	cc974c09-131a-452b-9faf-36683f71c3cc	3	making it one of the tallest mountains in the Oceania region	\N	t	INDETERMINATE	f	checks_did_not_complete	orchestrator-v1	2026-09-03 17:26:57.803973+00	not_checkable	required_field_unresolved
9642c2b0-aa60-4294-8a5a-ca7d3461e4e5	742c88de-a16f-4eed-9301-be5b8a3d800f	1	The Amazon Rainforest produces 15% of the world's oxygen	\N	t	INDETERMINATE	f	checks_did_not_complete	orchestrator-v1	2026-09-03 17:27:16.30406+00	not_checkable	required_field_unresolved
e725376f-a811-4559-8f80-b8ab5e28a82b	742c88de-a16f-4eed-9301-be5b8a3d800f	2	was discovered by Christopher Columbus in 1502	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 17:27:22.296337+00	completed	\N
0b64ae36-2291-46d4-9b9f-4aa66b68c696	3c6adbec-a8f8-4848-b373-745a41d4b0f4	1	The Statue of Liberty was originally built in Japan and relocated to New York in 1876 by hot air balloon.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 17:27:49.505892+00	completed	\N
14d741ce-c43f-45ba-bf5f-518a1e3d5015	3c6adbec-a8f8-4848-b373-745a41d4b0f4	2	It was designed by Japanese architect Tanaka Yuki.	\N	t	INDETERMINATE	f	checks_did_not_complete	orchestrator-v1	2026-09-03 17:28:00.09426+00	not_checkable	required_field_unresolved
80a16b24-c71e-42c0-b41c-5915f9dc9a33	f04116ec-3343-4814-ba2c-6476774a08fc	1	Today's weather is 100 degrees in New York.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 17:49:38.376159+00	completed	\N
43a67e43-a350-4275-b5aa-289cfe057ffa	857f6530-de07-414e-9db6-e90c5c8288a0	1	The Great Barrier Reef is 2 kilometers long.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 17:49:45.073637+00	completed	\N
ef54efad-3ea4-44cd-9861-39fda0d104a2	8425c356-9eba-40d1-9ec5-71a023eb2774	1	Today's weather is 100 degrees in New York.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 18:33:35.226078+00	completed	\N
7e39abf8-3d51-4e75-b5d5-8acb1fa74c68	00b5c1d5-7be1-434b-a664-c520a613d4ee	1	The Great Barrier Reef is 2 kilometers long.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 18:33:42.200948+00	completed	\N
5c27d5d1-21e6-41b4-b0dd-ebd88b94ec9d	1d0d85e9-64eb-4398-9392-1a7fb515c872	1	The Great Barrier Reef is 2 kilometers long.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-03 18:47:57.720902+00	completed	\N
8f93dfd9-9288-4357-864f-6bfcc081d190	b0cf4531-7c84-48c9-b9b9-1504b083c0d9	1	Acme's revenue grew 17% in FY25.	\N	t	CONTRADICTED	f	contradicting_applicable_relation	orchestrator-v1	2026-09-04 02:55:50.992448+00	completed	\N
00ba0e7a-5cc4-41b2-b067-3dc7019249b6	fb321bdb-902b-438e-8f47-c751f7c738e5	1	Acme's revenue grew 17% in FY25.	\N	t	CONTRADICTED	f	contradicting_applicable_relation	orchestrator-v1	2026-09-04 04:01:58.334689+00	completed	\N
efc0e1b8-bc9d-4fda-bdef-595cc9a03487	9d610dc7-f5b3-473a-aae3-a02704a59380	1	Acme's revenue grew 17% in FY25.	\N	t	CONTRADICTED	f	contradicting_applicable_relation	orchestrator-v1	2026-09-04 04:02:08.734297+00	completed	\N
a37afb78-af75-4918-ac32-146313e9abbc	e092ccc9-1b78-4919-a53e-012e70047461	1	Acme's revenue grew 17% in FY25.	\N	t	CONTRADICTED	f	contradicting_applicable_relation	orchestrator-v1	2026-09-04 04:09:41.340515+00	completed	\N
8c448d9a-87e7-455a-a160-af0f6af3aebc	76138ddc-9042-469b-a1c7-0cc6df02db33	1	Today's weather is 100 degrees in New York.	\N	t	UNSUPPORTED	f	no_support_after_completed_checks	orchestrator-v1	2026-09-04 15:58:05.363958+00	completed	\N
6f1b004c-41c1-4b60-b53f-7d8fb090fd4d	6b4ed876-9a9a-4402-850d-d5d7d86a0efd	1	The Statue of Liberty is 500 feet tall.	\N	t	INDETERMINATE	f	checks_did_not_complete	orchestrator-v1	2026-09-04 16:00:58.143028+00	not_checkable	required_field_unresolved
29219a30-ee23-4676-9bb1-b764e59e8c58	4a63340c-886d-4a54-8b0c-bb3062ce342f	1	Acme's revenue grew 17% in FY25.	\N	t	CONTRADICTED	f	contradicting_applicable_relation	orchestrator-v1	2026-09-04 17:49:17.626791+00	completed	\N
c10e04d1-30ec-4a6d-bf9b-559d6299d6f1	c5ff95ef-71b8-4263-a9e6-75030bbb18de	1	50k writes/sec is exactly what DynamoDB is built for.	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 18:04:41.203053+00	completed	\N
fc661646-bf4a-4c67-8eec-c0de8a9243d2	c5ff95ef-71b8-4263-a9e6-75030bbb18de	3	Managing RDS (or self-hosted) Postgres for 50k writes/sec means monitoring replication lag, managing backup windows, handling failover complexity.	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 18:04:41.2639+00	completed	\N
26790975-5e6f-4797-babf-fb43109b1607	c5ff95ef-71b8-4263-a9e6-75030bbb18de	2	With that write volume, provisioned capacity will be significantly cheaper than running Postgres at the equivalent throughput.	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 18:04:41.371315+00	completed	\N
494e88c1-fc77-4cfa-a625-10ffe3332f4a	c5ff95ef-71b8-4263-a9e6-75030bbb18de	4	7 years of audit data means substantial storage costs plus backup storage.	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 18:04:41.373038+00	completed	\N
a7555336-d59d-4d58-b05f-5766bda0ce86	c5ff95ef-71b8-4263-a9e6-75030bbb18de	5	Postgres writes hit WAL, applies to tables, maintains indexes—more I/O overhead per write than DynamoDB's append model.	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 18:04:42.03201+00	completed	\N
62a625be-9f0a-40c8-9558-fe2fb3ec9846	116aa8c7-287a-4eab-a9c7-c43ec2b30344	1	50k writes/sec is exactly what DynamoDB is built for.	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 18:45:48.05411+00	completed	\N
7abcf23b-10ab-45c9-ab22-c6da36881eb2	116aa8c7-287a-4eab-a9c7-c43ec2b30344	5	7 years of audit data means substantial storage costs plus backup storage.	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 18:45:48.151393+00	completed	\N
d1ea3fc8-8beb-4c83-8d5d-bc8e520351d7	116aa8c7-287a-4eab-a9c7-c43ec2b30344	4	You'd likely need a very large instance	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 18:45:48.158809+00	completed	\N
f8d57eaa-ac67-4a02-a489-e4abf8372396	116aa8c7-287a-4eab-a9c7-c43ec2b30344	2	With that write volume, provisioned capacity will be significantly cheaper than running Postgres at the equivalent throughput.	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 18:45:48.160036+00	completed	\N
b0c9c610-b392-40a5-a499-df5ffdfa37b4	116aa8c7-287a-4eab-a9c7-c43ec2b30344	3	Managing RDS (or self-hosted) Postgres for 50k writes/sec means monitoring replication lag, managing backup windows, handling failover complexity.	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 18:45:48.159221+00	completed	\N
3a7e40ee-39d7-43fa-9a11-443cec3d0a6c	116aa8c7-287a-4eab-a9c7-c43ec2b30344	6	Postgres writes hit WAL, applies to tables, maintains indexes—more I/O overhead per write than DynamoDB's append model.	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 18:45:48.243046+00	completed	\N
4d26b366-8474-4a71-b93e-fb41e0c67dc5	c7605ba0-45de-4a2c-991c-4566ece9fc38	1	50k writes/sec is well within Postgres's capabilities on RDS.	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 19:05:45.125861+00	completed	\N
dbd1d007-393a-4417-bdd0-d8739506e5ce	c7605ba0-45de-4a2c-991c-4566ece9fc38	4	50k writes/sec = 2.16B writes/day = 788B writes/year	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 19:05:45.226088+00	completed	\N
999f842c-197a-4df9-92ed-c5a54176ca90	c7605ba0-45de-4a2c-991c-4566ece9fc38	2	A multi-AZ db.r6i.2xlarge or similar can handle this with proper configuration	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 19:05:45.323855+00	completed	\N
25ed2357-7550-44ea-9c2b-5d446d201d2e	c7605ba0-45de-4a2c-991c-4566ece9fc38	3	DynamoDB can handle it too	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 19:05:45.422276+00	completed	\N
cee7b609-e5bb-477f-8740-136c699a8934	c7605ba0-45de-4a2c-991c-4566ece9fc38	6	Over 7 years: **~$6.9M**.	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 19:05:45.519459+00	completed	\N
d8c74afd-727e-4b17-8a12-df1308b51ee4	c7605ba0-45de-4a2c-991c-4566ece9fc38	7	Add storage costs for 7 years of data, and you're easily over $8M.	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 19:05:45.527827+00	completed	\N
b0be3efa-e4bd-49e1-895c-7cefb2c557bf	c7605ba0-45de-4a2c-991c-4566ece9fc38	8	Instance cost (~$5-15k/month depending on sizing) + storage ($0.10-0.23/GB/month).	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 19:05:45.531751+00	completed	\N
99110886-0a0b-46fe-aa33-ef19c3f0062f	c7605ba0-45de-4a2c-991c-4566ece9fc38	5	At on-demand pricing (~$1.25 per million writes), that's ~$985k/year.	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 19:05:45.531987+00	completed	\N
59723139-d238-4b03-bb25-2e5bb048b933	c7605ba0-45de-4a2c-991c-4566ece9fc38	9	For 7 years of audit log data at reasonable compression, you're looking at **$500k-$1.5M total**	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 19:05:45.535489+00	completed	\N
4dcf162c-f4ec-4847-9c1b-a761e0ebc6c3	c7605ba0-45de-4a2c-991c-4566ece9fc38	10	easily 5-6x cheaper	\N	t	INDETERMINATE	t	no_source	orchestrator-v1	2026-09-04 19:05:45.544126+00	completed	\N
\.


--
-- Data for Name: evidence; Type: TABLE DATA; Schema: public; Owner: notary
--

COPY public.evidence (id, review_id, origin, submitted_url, canonical_url, payload_ref, payload_hash, retrieval_status, retrieved_at, locator_scheme, retention_until, submitted_by, snapshot_reuse_policy, access_revoked_at, resolved_text, created_at, content_kind, text_provenance, canonical_text_hash, parse_status, parse_error, page_ranges) FROM stdin;
7f5f6a99-a8eb-4482-82d2-1a50db00b5f2	9bcbaf02-68e4-4879-abf5-fc9719b38e39	answer_citation	https://example.com/weather	https://example.com/weather	\N	d003f90bc10db991b76e6fb480123cfce2cbb2b2784abe687fccccfa7ecacad8	retrieved	2026-09-01 23:37:03.268912+00	\N	\N	\N	\N	\N	Example Domain Example Domain This domain is for use in documentation examples without needing permission. Avoid use in operations. Learn more	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
57d1fbfd-bf53-4851-afa0-543afd7be0ce	f5f37098-227d-42e5-8897-3a4025f5b4e9	answer_citation	https://example.com/acme-report	https://example.com/acme-report	\N	d003f90bc10db991b76e6fb480123cfce2cbb2b2784abe687fccccfa7ecacad8	retrieved	2026-09-01 23:37:33.131152+00	\N	\N	\N	\N	\N	Example Domain Example Domain This domain is for use in documentation examples without needing permission. Avoid use in operations. Learn more	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
2a12a4af-6923-4dd3-8576-d195923e57f5	b0b8235e-7b28-4756-8105-7ab58ef833fa	answer_citation	https://example.com/acme-report	https://example.com/acme-report	\N	d003f90bc10db991b76e6fb480123cfce2cbb2b2784abe687fccccfa7ecacad8	retrieved	2026-09-01 23:38:40.19721+00	\N	\N	\N	\N	\N	Example Domain Example Domain This domain is for use in documentation examples without needing permission. Avoid use in operations. Learn more	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
951fd461-d350-4b38-8a68-27ed621451f2	e0821f22-0347-46fd-a528-24f50d118d13	answer_citation	\N	\N	\N	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	retrieved	2026-09-01 23:39:16.638+00	\N	\N	\N	\N	\N	Acme FY25 annual report: revenue grew 12%.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
7f89efef-0801-4493-aded-73b1a2ade6ce	bac96596-33a1-4855-80d1-1ac40220194f	answer_citation	\N	\N	\N	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	retrieved	2026-09-01 23:42:14.788+00	\N	\N	\N	\N	\N	Acme FY25 annual report: revenue grew 12%.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
e2ed9539-bba8-4900-b972-bd2623f11816	b2d343d1-5b6a-44b7-8cb7-15afa02394ab	answer_citation	\N	\N	\N	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	retrieved	2026-09-01 23:46:25.183+00	\N	\N	\N	\N	\N	Acme FY25 annual report: revenue grew 12%.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
a84e728d-f27e-4310-95ad-80360f45b065	7185a77b-abe3-4d7b-9661-4719b4061b66	answer_citation	\N	\N	\N	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	retrieved	2026-09-01 23:47:00.512+00	\N	\N	\N	\N	\N	Acme FY25 annual report: revenue grew 12%.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
74549e42-cff5-40b6-ab32-a3e740d9301b	155aab82-9c02-4d68-80d7-81c126e37287	answer_citation	\N	\N	\N	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	retrieved	2026-09-01 23:47:04.931+00	\N	\N	\N	\N	\N	Acme FY25 annual report: revenue grew 12%.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
f9d44f80-b24a-4385-b38d-0303499ad772	c6be0436-a291-4eaf-9c98-e79aa08b348c	answer_citation	\N	\N	\N	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	retrieved	2026-09-01 23:47:08.477+00	\N	\N	\N	\N	\N	Acme FY25 annual report: revenue grew 12%.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
a170d40d-13cd-4aca-a3e4-ad8364780cb7	e8059a5f-950b-46d3-9736-55c685422afa	answer_citation	\N	\N	\N	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	retrieved	2026-09-02 00:17:13.167+00	\N	\N	\N	\N	\N	Acme FY25 annual report: revenue grew 12%.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
2ecc0a9e-2b04-4f10-8ee7-ab5ada54b14f	d9289d77-c1cb-4d9b-9390-ee558b7e5d9a	answer_citation	\N	\N	\N	e42954377fb856812a95c424f17c9cea0ead11aa642ac0877fc37ca02260705f	retrieved	2026-09-02 00:17:28.714+00	\N	\N	\N	\N	\N	Market revenue grew 12% in FY25.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
f973f0e7-2f29-4db5-a13a-0a6f308799f0	2822aea3-d109-41b1-980a-84bcfb15f885	answer_citation	\N	\N	\N	88872f15e1d4fd3f739b592e83d4f5ac3f6ea93eb560b95cbce88ec4dc77d90e	retrieved	2026-09-02 00:17:30.621+00	\N	\N	\N	\N	\N	Acme revenue declined 12% in FY25.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
1e90ec8a-90f5-4fac-8fa5-a57b03b51845	68035d15-9a32-49c1-baf9-23ddf0696fde	answer_citation	\N	\N	\N	88872f15e1d4fd3f739b592e83d4f5ac3f6ea93eb560b95cbce88ec4dc77d90e	retrieved	2026-09-02 00:23:42.741+00	\N	\N	\N	\N	\N	Acme revenue declined 12% in FY25.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
80a3fd94-95ab-44e3-9bbe-fd58e9075ce9	360d7382-e950-4bb3-a5aa-107c1a7b7157	answer_citation	\N	\N	\N	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	retrieved	2026-09-02 00:23:57.36+00	\N	\N	\N	\N	\N	Acme FY25 annual report: revenue grew 12%.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
a6f03968-88c1-4455-adb1-c7f7f31952fe	3f6de5f2-2821-4b7b-bc0f-8e86e829ab80	answer_citation	\N	\N	\N	e42954377fb856812a95c424f17c9cea0ead11aa642ac0877fc37ca02260705f	retrieved	2026-09-02 00:23:59.582+00	\N	\N	\N	\N	\N	Market revenue grew 12% in FY25.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
fd2b3247-e8cb-4ca5-8264-93157f184ed8	f2ca7663-8d2a-431d-a67d-30afe5f77b36	answer_citation	https://example.com/acme	https://example.com/acme	\N	d003f90bc10db991b76e6fb480123cfce2cbb2b2784abe687fccccfa7ecacad8	retrieved	2026-09-02 00:36:57.612396+00	\N	\N	\N	\N	\N	Example Domain Example Domain This domain is for use in documentation examples without needing permission. Avoid use in operations. Learn more	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
587915f1-b2d6-4b0b-ac4a-8ba8379388a7	7296fce3-f86c-4be0-98f1-c9e4a9a9032b	answer_citation	\N	\N	\N	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	retrieved	2026-09-02 00:37:38.766+00	\N	\N	\N	\N	\N	Acme FY25 annual report: revenue grew 12%.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
59903c17-16a2-414a-bdad-7b304b173808	51437fe3-7560-4865-afde-c5a0f308042f	answer_citation	\N	\N	\N	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	retrieved	2026-09-02 00:37:40.813+00	\N	\N	\N	\N	\N	Acme FY25 annual report: revenue grew 12%.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
90868b75-b95c-466e-a43a-164302839db3	f576fc93-8576-474c-bd81-28d73fe7949c	answer_citation	\N	\N	\N	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	retrieved	2026-09-02 00:37:43.025+00	\N	\N	\N	\N	\N	Acme FY25 annual report: revenue grew 12%.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
a8408d56-bf72-4bd1-8f4a-1f8c281d407e	b4966a55-0020-4f79-94b4-8bd049fc9e24	answer_citation	https://example.com/acme	\N	\N	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	retrieved	2026-09-02 00:49:15.198+00	\N	\N	\N	\N	\N	Acme FY25 annual report: revenue grew 12%.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
b1d89b7f-8420-464b-80f4-63179d6ee1cc	b722defc-f2d0-42b2-be4e-2419ea25a220	answer_citation	https://example.com/acme	\N	\N	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	retrieved	2026-09-02 00:53:46.946+00	\N	\N	\N	\N	\N	Acme FY25 annual report: revenue grew 12%.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
370cec08-8d81-49de-922c-1d94d5d59e0f	e5ff03a0-d51f-4cd1-9720-9d1a266e8dc2	answer_citation	https://example.com/acme	\N	\N	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	retrieved	2026-09-02 01:13:21.505+00	\N	\N	\N	\N	\N	Acme FY25 annual report: revenue grew 12%.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
d220ace3-163c-43da-b5d3-99ff1bb80e47	ca0352bd-a23b-47b1-9fbc-b47eae6bbb44	answer_citation	https://example.com/acme	\N	\N	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	retrieved	2026-09-02 01:18:48.39+00	\N	\N	\N	\N	\N	Acme FY25 annual report: revenue grew 12%.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
916be55d-e191-45d9-8327-122ff4bb97d6	57b9dfe3-2ee8-47b5-8304-de9b74fd674c	answer_citation	https://www.accuweather.com/en/us/new-york/10021/weather-forecast/349727	\N	\N	5d00dd4b5794789c0c4f9c6c607226967e45dbee37890a7db4a0b011b04ebd8d	retrieved	2026-09-02 01:25:59.278+00	\N	\N	\N	\N	\N	currently 73°F, forecast high of 81°F today (Tue, Sep 1)	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
c66881ac-b95b-49d4-883d-bdbfc559c158	398a80ff-8b73-47e1-8789-175947925390	answer_citation	https://example.com/weather	\N	\N	cbd9362ae970d4521fcc4b9c1913b3d0fb21f338349719c1ad8f78dc299bff49	retrieved	2026-09-02 01:41:35.293+00	\N	\N	\N	\N	\N	New York weather: currently 73F, high of 81F.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
42c1e176-4107-47f3-8098-4a9256e01acb	49980520-b6df-4446-b572-ae6694225e46	answer_citation	https://www.accuweather.com/en/us/new-york/10021/weather-forecast/349727	\N	\N	5d00dd4b5794789c0c4f9c6c607226967e45dbee37890a7db4a0b011b04ebd8d	retrieved	2026-09-02 02:30:28.248+00	\N	\N	\N	\N	\N	currently 73°F, forecast high of 81°F today (Tue, Sep 1)	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
58cb2a15-ff3a-46a1-b878-6f781e90ab03	af816396-305f-4514-ba7d-17dd7abe1d80	answer_citation	\N	\N	\N	579d15030d37d76985e207ca3330cfbe5dc3f42b0508c99e349b99ab27be04e5	retrieved	2026-09-02 02:38:41.891+00	\N	\N	\N	\N	\N	New York weather today: actual conditions are around 73F with a high near 81F.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
8ce7252f-f491-424f-8e28-7f9be077f7e6	557d2709-a51d-4a23-a09d-476de5de648f	answer_citation	https://example.com/acme-investor-letter	\N	\N	1243e54ca50a5c2744926e84b422f1f0d4c4764a6cebbc76c257af5bd47b9f80	retrieved	2026-09-02 15:32:04.192+00	\N	\N	\N	\N	\N	Acme, Inc. reported that revenue increased seventeen percent year over year in fiscal 2025.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
7caf3f4f-4c28-48a6-b11d-1fc18f75efe7	6f31c5df-8741-4b70-bef2-ebdb14c0f5d8	user_added	\N	\N	\N	800d745620bfe0dc55da8bfa871b036d15c49c5606cd1fca3cd22c24eb601f5a	retrieved	2026-09-02 15:32:31.529+00	\N	\N	\N	\N	\N	Acme Corp revenue grew 17% in FY25.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
c8ef7c34-b899-4abd-8799-9baa7fa24966	483ac3a9-2e2e-488b-a50d-b8f49c56a51d	user_added	\N	\N	\N	0eae2793f714ad2f77c95a8d5475b4a99eddfa919ee65cd1dc4de426b756293b	retrieved	2026-09-02 15:32:42.804+00	\N	\N	\N	\N	\N	Acme Inc revenue increased 17 percent in fiscal 2025.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
a74434d4-eda3-4f63-bcd6-54a37328a9c1	cd0a122c-7aa1-4a6d-bb73-4e3bde864fd8	user_added	\N	\N	\N	32e1f96e675b1d73ed29c4f0359c753d3ecd5f3d50ecfcbd904928c6b4ac62f0	retrieved	2026-09-02 15:32:59.961+00	\N	\N	\N	\N	\N	Acme Inc revenue declined 12 percent in fiscal 2025.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
74d02c0d-4833-4e41-b66b-0b140ac80c1a	a7faef25-a927-4eac-886f-20a65ebc9840	user_added	\N	\N	\N	3d84c1d183f78859c3e39c9e43657fad386a391c15b49633cd9898b040ba98e0	retrieved	2026-09-02 15:33:24.932+00	\N	\N	\N	\N	\N	Acme Inc revenue grew 12% in FY25.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
76554fdd-d7b7-43b8-8381-1e84d9196a17	ff8af00d-4652-4127-909b-22d3a57023c4	answer_citation	\N	\N	\N	4147dfce8f2b12ef99e2da4ee3484bedabc2e5a1d9f4c2181304594a19fd4d78	retrieved	2026-09-03 11:04:09.095+00	\N	\N	\N	\N	\N	The overall SaaS market grew 17% in 2025 across all vendors	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
937f2151-9eb9-40b3-b562-97a1c603a25e	f29b7b2f-7ea3-4378-8ecb-75efd89f55d0	answer_citation	\N	\N	\N	2a6fbcc727db7522a3e35ef0690283d582c1e5633ca076b3f16abb596bc21b4b	retrieved	2026-09-03 11:04:26.32+00	\N	\N	\N	\N	\N	revenue increased 12% year over year	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
ca002f58-57ec-4dcf-a6a4-e5296af7932b	73f0050e-90bf-4fdf-9ae0-c8eb89f85ae9	answer_citation	\N	\N	\N	2a6fbcc727db7522a3e35ef0690283d582c1e5633ca076b3f16abb596bc21b4b	retrieved	2026-09-03 11:05:25.349+00	\N	\N	\N	\N	\N	revenue increased 12% year over year	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
14431bd0-7a42-4fb8-8f13-74afa634a065	3b754d67-11e1-47fe-99eb-42759ad15654	answer_citation	https://cnevpost.com/2025/01/02/tesla-global-deliveries-q4-2024/	\N	\N	dfe31ac235cabec16e8887577581c025ede120244943331dba350b83e6770554	retrieved	2026-09-03 13:21:24.342+00	\N	\N	\N	\N	\N	For the full-year 2024, Tesla delivered 1,789,226 vehicles globally, down 1.07 percent from 1,808,581 in 2023	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
e26a94b9-8fd4-41d1-b17a-0d6cf6ad8f7c	f0783aee-647c-4c84-a36d-f754ec6873e8	answer_citation	https://companiesmarketcap.com/tesla/marketcap/	\N	\N	5704e3b86ce1f499e88c8db20cfb50852f78828f69a8f22ede88235d7caee91e	retrieved	2026-09-03 13:38:34.76+00	\N	\N	\N	\N	\N	As of September 2026 Tesla has a market cap of $1.400 Trillion USD.	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
a6a0554e-0467-4752-b424-2c099b41662e	d5968b32-9703-49e8-9642-7692312beeea	answer_citation	https://en.wikipedia.org/wiki/Eiffel_Tower	\N	\N	2938af6d88399c29b09fda9f7c9f22e23e5ae8efd8b2f6ceb2edb98229bc653f	retrieved	2026-09-03 13:39:55.756+00	\N	\N	\N	\N	\N	The tower is 330 metres (1,083 ft) tall	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
7eb13c1a-8a28-4b9c-8048-6a2aacebb3b1	2edd9b66-46da-477e-8958-b17b3dcc0f5d	answer_citation	https://www.chinahighlights.com/greatwall/fact/great-wall-length.htm	\N	\N	ac5752d03926e6ed628ea87d5cf3c0c24b21649dd05126c19a59f7e4b6f29dbf	retrieved	2026-09-03 13:40:09.417+00	\N	\N	\N	\N	\N	The official length of the Great Wall of China is 21,196.18 kilometers	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
dd90c84a-0016-45d4-9fd8-ae0e8534c614	27aee64d-3c41-4b07-a330-1932b7f2acfc	answer_citation	https://my.clevelandclinic.org/health/body/21048-skeleton	\N	\N	770a4b1201151d574c1de6a4638f9197a09e30f034dce0b944a34aa5daaa6001	retrieved	2026-09-03 13:40:16.709+00	\N	\N	\N	\N	\N	the adult human skeleton is made up of 206 bones	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
933c3dc2-10f0-406c-bd1f-7d66ef985286	5d6b5b15-c4da-461e-b3ac-c702a82b6831	answer_citation	https://en.wikipedia.org/wiki/Mount_Everest	\N	\N	81bb76f0720ba834098e3c4820c4339ea20e459f551b3986ddd164a587eafad8	retrieved	2026-09-03 13:40:23.622+00	\N	\N	\N	\N	\N	Mount Everest stands at 8,849 meters	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
406c5ab5-20cf-4477-8755-77193bf0d48c	5758bfa1-c74b-480a-873f-42bd3f8e53f7	answer_citation	https://en.wikipedia.org/wiki/Boiling_point	\N	\N	7a55b77c4fd8dc7e363d1be72deec5ea5c68a590b7f45bdfc942358971781b70	retrieved	2026-09-03 13:40:31.462+00	\N	\N	\N	\N	\N	water boils at 100°C (212°F) at sea level	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
085503d4-da26-4947-8398-40d35149e591	d37c344a-7dcd-4d69-b0d7-eebd55bd6a49	answer_citation	https://en.wikipedia.org/wiki/Amazon_River	\N	\N	f09b6c4233e1c5f280cd54d8ec65f60c97216c1938eefe9d548e9892dd345ac2	retrieved	2026-09-03 13:41:30.61+00	\N	\N	\N	\N	\N	the Amazon River is about 4,000 miles (6,400 km) long	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
8160e499-67f2-43aa-8b3e-f0f7d4e7c956	a16a600d-f76b-4a20-bab3-e91db60ff4e3	answer_citation	https://en.wikipedia.org/wiki/Sahara	\N	\N	b484738682be49b07f8c6f71ab7a099d320db42b174a4489b9d32756f295df00	retrieved	2026-09-03 13:41:39.279+00	\N	\N	\N	\N	\N	the Sahara covers an area of about 9,200,000 square kilometers	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
909a2f96-7e33-4529-8e7e-ba2d43fe4750	1cdbec9f-2717-4d8b-bd33-35d9b5b01f5f	answer_citation	https://en.wikipedia.org/wiki/Moons_of_Jupiter	\N	\N	6db592e7f783cb9e4b5f7b580d677de2a39e151dedc5a07e4793079c1e15eafa	retrieved	2026-09-03 13:41:47.082+00	\N	\N	\N	\N	\N	Jupiter has 95 confirmed moons	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
5478d6e9-9b21-46c2-b05e-a0d21665fe90	39576b36-9750-476c-80f7-c18eba56f664	answer_citation	https://en.wikipedia.org/wiki/Pacific_Ocean	\N	\N	d1874b7c457fdbab45bac4249a6a8d92d68df812b5a6deb80b721d9c44a2c263	retrieved	2026-09-03 13:41:53.615+00	\N	\N	\N	\N	\N	the Pacific Ocean covers about 30% of the Earth's surface	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
140eb263-20eb-41b0-aa7c-8a6d380deb12	8ba60294-2767-44f0-abe5-b776d72ec30a	answer_citation	https://en.wikipedia.org/wiki/Great_Barrier_Reef	\N	\N	e80e1541adf3c3f8e4c13869476badb91d04264205415a21b18caa89cc7902e6	retrieved	2026-09-03 13:42:02.211+00	\N	\N	\N	\N	\N	the Great Barrier Reef stretches over 2,300 kilometers	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
48371d7e-145c-458c-bc87-ea09b82d7ea9	6ad02183-7e15-411a-b620-14fbff5f44a6	answer_citation	https://www.accuweather.com/en/us/new-york/10021/weather-forecast/349727	\N	\N	5d00dd4b5794789c0c4f9c6c607226967e45dbee37890a7db4a0b011b04ebd8d	retrieved	2026-09-03 13:50:19.999+00	\N	\N	\N	\N	\N	currently 73°F, forecast high of 81°F today (Tue, Sep 1)	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
83d7f497-0a89-48b7-a3e7-97f40f580cd3	ad537204-9bae-4c19-8f60-bb13ef1ea37e	answer_citation	https://en.wikipedia.org/wiki/Great_Barrier_Reef	\N	\N	e80e1541adf3c3f8e4c13869476badb91d04264205415a21b18caa89cc7902e6	retrieved	2026-09-03 13:50:30.672+00	\N	\N	\N	\N	\N	the Great Barrier Reef stretches over 2,300 kilometers	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
abc2af42-4057-450b-8854-5de2f4c9c6ef	a3409dfe-acfc-41b2-b3d8-c36123e29f1b	answer_citation	https://www.accuweather.com/en/us/new-york/10021/weather-forecast/349727	\N	\N	5d00dd4b5794789c0c4f9c6c607226967e45dbee37890a7db4a0b011b04ebd8d	retrieved	2026-09-03 13:56:17.712+00	\N	\N	\N	\N	\N	currently 73°F, forecast high of 81°F today (Tue, Sep 1)	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
a6464235-542f-4d27-a526-3ca47c2c5a3d	c578936f-b348-466b-bc53-79ed7bfdcb4d	answer_citation	https://en.wikipedia.org/wiki/Great_Barrier_Reef	\N	\N	e80e1541adf3c3f8e4c13869476badb91d04264205415a21b18caa89cc7902e6	retrieved	2026-09-03 13:56:29.423+00	\N	\N	\N	\N	\N	the Great Barrier Reef stretches over 2,300 kilometers	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
a4cab3dc-d97e-425d-85d3-8c8662b1253d	4a216943-a359-44a8-88a2-77a781c24905	answer_citation	https://www.accuweather.com/en/us/new-york/10021/weather-forecast/349727	\N	\N	5d00dd4b5794789c0c4f9c6c607226967e45dbee37890a7db4a0b011b04ebd8d	retrieved	2026-09-03 13:56:36.42+00	\N	\N	\N	\N	\N	currently 73°F, forecast high of 81°F today (Tue, Sep 1)	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
9b59a76e-9afd-4ad1-91cb-7b098cc2d9a1	516effa8-143c-43c9-ba3d-0f1fa17514b4	answer_citation	https://en.wikipedia.org/wiki/Great_Barrier_Reef	\N	\N	e80e1541adf3c3f8e4c13869476badb91d04264205415a21b18caa89cc7902e6	retrieved	2026-09-03 13:56:46.602+00	\N	\N	\N	\N	\N	the Great Barrier Reef stretches over 2,300 kilometers	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
bd409ff2-cccb-49eb-8f2d-3589215b63cf	8c12741e-8c1e-4d4b-b18b-b2c553bfefbb	answer_citation	https://www.accuweather.com/en/us/new-york/10021/weather-forecast/349727	\N	\N	5d00dd4b5794789c0c4f9c6c607226967e45dbee37890a7db4a0b011b04ebd8d	retrieved	2026-09-03 13:56:53.615+00	\N	\N	\N	\N	\N	currently 73°F, forecast high of 81°F today (Tue, Sep 1)	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
860d010a-38fc-459a-9905-0012821091f0	911421e1-cb73-4d8f-ae81-9861f98fa0b5	answer_citation	https://en.wikipedia.org/wiki/Great_Barrier_Reef	\N	\N	e80e1541adf3c3f8e4c13869476badb91d04264205415a21b18caa89cc7902e6	retrieved	2026-09-03 13:57:04.095+00	\N	\N	\N	\N	\N	the Great Barrier Reef stretches over 2,300 kilometers	2026-09-03 15:03:39.832699+00	\N	\N	\N	not_attempted	\N	\N
7be93562-2d55-49f7-b32b-6011bc9062bb	5b540531-b318-4747-8bfe-190077d3b34d	answer_citation	https://example.com/acme-fy25	\N	\N	419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b	retrieved	2026-09-03 15:54:35.131+00	\N	\N	\N	\N	\N	Acme Corp's revenue increased 12% in fiscal year 2025, driven by strong enterprise demand.	2026-09-03 15:54:35.132322+00	inline_excerpt	caller_supplied	419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b	parsed	\N	\N
14e7da3d-8ddd-4e2d-8a28-c5fe7e5b1af1	69afb86d-1071-4543-b11e-d68697e6f68d	answer_citation	https://example.com/acme-fy25	\N	\N	419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b	retrieved	2026-09-03 16:01:41.384+00	\N	\N	\N	\N	\N	Acme Corp's revenue increased 12% in fiscal year 2025, driven by strong enterprise demand.	2026-09-03 16:01:41.385001+00	inline_excerpt	caller_supplied	419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b	parsed	\N	\N
8ca2c6f0-3a47-4328-a117-c2f592f79f1e	a38c7b56-e320-4285-a84c-109fed6c29f4	answer_citation	https://example.com/acme-fy25	\N	\N	419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b	retrieved	2026-09-03 16:02:43.425+00	\N	\N	\N	\N	\N	Acme Corp's revenue increased 12% in fiscal year 2025, driven by strong enterprise demand.	2026-09-03 16:02:43.425994+00	inline_excerpt	caller_supplied	419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b	parsed	\N	\N
601e972d-2fa9-45f7-b9aa-09f97723f143	62f76753-10b4-4f58-a637-423dd2a28721	answer_citation	https://example.com/acme-fy25	\N	\N	419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b	retrieved	2026-09-03 16:03:35.266+00	\N	\N	\N	\N	\N	Acme Corp's revenue increased 12% in fiscal year 2025, driven by strong enterprise demand.	2026-09-03 16:03:35.267274+00	inline_excerpt	caller_supplied	419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b	parsed	\N	\N
3d43e18d-50f0-45cb-8dd1-4b57a3bacc3d	7ebc7f60-be1c-4a63-9d9d-7dce632bf049	answer_citation	https://www.britannica.com/topic/Great-Wall-of-China	\N	\N	ab20db47cd8d5e5cde0bad9e0821afe2ee84fe967c60b4b55b9c066774a360d1	retrieved	2026-09-03 17:25:52.784+00	\N	\N	\N	\N	\N	The wall constructed during the Ming dynasty, the most well-preserved section, is about 8,850 kilometers (5,499 miles) long.	2026-09-03 17:25:52.784812+00	inline_excerpt	caller_supplied	ab20db47cd8d5e5cde0bad9e0821afe2ee84fe967c60b4b55b9c066774a360d1	parsed	\N	\N
cfb6578c-1414-4e61-b8a1-1584742e640d	cc974c09-131a-452b-9faf-36683f71c3cc	answer_citation	https://www.britannica.com/place/Mount-Everest	\N	\N	8a69cdd3917d8b8a5bbe2bd490b0e18e91f40b0ea920258688aee932ccd1474d	retrieved	2026-09-03 17:26:22.443+00	\N	\N	\N	\N	\N	Reaching an elevation of 29,032 feet (8,849 meters), Mount Everest is the highest mountain in the world.	2026-09-03 17:26:22.444182+00	inline_excerpt	caller_supplied	8a69cdd3917d8b8a5bbe2bd490b0e18e91f40b0ea920258688aee932ccd1474d	parsed	\N	\N
06c10384-f90f-4ee2-9921-8e456e379e60	cc974c09-131a-452b-9faf-36683f71c3cc	answer_citation	https://education.nationalgeographic.org/resource/mount-everest/	\N	\N	4c0458d9a72962f3d1510da18d9969ed51bf7b9054188ddec5ba6be74122b014	retrieved	2026-09-03 17:26:22.474+00	\N	\N	\N	\N	\N	It is located between Nepal and Tibet, an autonomous region of China.	2026-09-03 17:26:22.474946+00	inline_excerpt	caller_supplied	4c0458d9a72962f3d1510da18d9969ed51bf7b9054188ddec5ba6be74122b014	parsed	\N	\N
a11e452b-fd43-4bab-b066-2232e5aac4d8	742c88de-a16f-4eed-9301-be5b8a3d800f	answer_citation	https://www.nationalgeographic.com/environment/article/why-amazon-doesnt-produce-20-percent-worlds-oxygen	\N	\N	d61ae048bece6d20b61a06a46afb5f6a32d737d71cfd4441a47ebbae24082d1e	retrieved	2026-09-03 17:27:10.236+00	\N	\N	\N	\N	\N	Scientists estimate the percentage is closer to 6 to 9%	2026-09-03 17:27:10.237436+00	inline_excerpt	caller_supplied	d61ae048bece6d20b61a06a46afb5f6a32d737d71cfd4441a47ebbae24082d1e	parsed	\N	\N
2fee08b5-ce15-4f67-814f-f2e758ff000e	3c6adbec-a8f8-4848-b373-745a41d4b0f4	answer_citation	https://www.britannica.com/art/How-Was-the-Statue-of-Liberty-Built	\N	\N	2879bd758a0f38bc3f9d9c225473923f92a1f5671fd861ca0103dd7877c1d3cd	retrieved	2026-09-03 17:27:36.746+00	\N	\N	\N	\N	\N	The Statue of Liberty was constructed in France between 1875 and 1884 under the supervision of sculptor Frédéric-Auguste Bartholdi	2026-09-03 17:27:36.747418+00	inline_excerpt	caller_supplied	2879bd758a0f38bc3f9d9c225473923f92a1f5671fd861ca0103dd7877c1d3cd	parsed	\N	\N
f0258114-16d1-46c9-bc48-d463d324efe4	3c6adbec-a8f8-4848-b373-745a41d4b0f4	answer_citation	https://www.statueofliberty.org/statue-of-liberty/overview-history/	\N	\N	e1f71b3ce2dc67ea52335a00ad14d20d76c6fd461e79657f33cb795db669997b	retrieved	2026-09-03 17:27:36.774+00	\N	\N	\N	\N	\N	The ship arrived in New York Harbor on June 17, 1885	2026-09-03 17:27:36.775381+00	inline_excerpt	caller_supplied	e1f71b3ce2dc67ea52335a00ad14d20d76c6fd461e79657f33cb795db669997b	parsed	\N	\N
2dc5a0f4-d57e-4a66-a191-623ea274a30f	f04116ec-3343-4814-ba2c-6476774a08fc	answer_citation	https://www.accuweather.com/en/us/new-york/10021/weather-forecast/349727	\N	\N	5d00dd4b5794789c0c4f9c6c607226967e45dbee37890a7db4a0b011b04ebd8d	retrieved	2026-09-03 17:49:31.95+00	\N	\N	\N	\N	\N	currently 73°F, forecast high of 81°F today (Tue, Sep 1)	2026-09-03 17:49:31.951065+00	inline_excerpt	caller_supplied	5d00dd4b5794789c0c4f9c6c607226967e45dbee37890a7db4a0b011b04ebd8d	parsed	\N	\N
1a7fc520-0ffa-4d8f-a856-2fe7d4053a1b	857f6530-de07-414e-9db6-e90c5c8288a0	answer_citation	https://en.wikipedia.org/wiki/Great_Barrier_Reef	\N	\N	e80e1541adf3c3f8e4c13869476badb91d04264205415a21b18caa89cc7902e6	retrieved	2026-09-03 17:49:43.551+00	\N	\N	\N	\N	\N	the Great Barrier Reef stretches over 2,300 kilometers	2026-09-03 17:49:43.552+00	inline_excerpt	caller_supplied	e80e1541adf3c3f8e4c13869476badb91d04264205415a21b18caa89cc7902e6	parsed	\N	\N
fa2362f0-542c-456c-97e6-bdfd9cbb6883	8425c356-9eba-40d1-9ec5-71a023eb2774	answer_citation	https://www.accuweather.com/en/us/new-york/10021/weather-forecast/349727	\N	\N	5d00dd4b5794789c0c4f9c6c607226967e45dbee37890a7db4a0b011b04ebd8d	retrieved	2026-09-03 18:33:28.426+00	\N	\N	\N	\N	\N	currently 73°F, forecast high of 81°F today (Tue, Sep 1)	2026-09-03 18:33:28.426737+00	inline_excerpt	caller_supplied	5d00dd4b5794789c0c4f9c6c607226967e45dbee37890a7db4a0b011b04ebd8d	parsed	\N	\N
548a8f7f-251e-43d2-a798-0b5d3574f553	00b5c1d5-7be1-434b-a664-c520a613d4ee	answer_citation	https://en.wikipedia.org/wiki/Great_Barrier_Reef	\N	\N	e80e1541adf3c3f8e4c13869476badb91d04264205415a21b18caa89cc7902e6	retrieved	2026-09-03 18:33:40.7+00	\N	\N	\N	\N	\N	the Great Barrier Reef stretches over 2,300 kilometers	2026-09-03 18:33:40.701277+00	inline_excerpt	caller_supplied	e80e1541adf3c3f8e4c13869476badb91d04264205415a21b18caa89cc7902e6	parsed	\N	\N
3f36684d-5179-4f38-9884-aeaabe6b9115	1d0d85e9-64eb-4398-9392-1a7fb515c872	answer_citation	https://en.wikipedia.org/wiki/Great_Barrier_Reef	\N	\N	e80e1541adf3c3f8e4c13869476badb91d04264205415a21b18caa89cc7902e6	retrieved	2026-09-03 18:47:56.297+00	\N	\N	\N	\N	\N	the Great Barrier Reef stretches over 2,300 kilometers	2026-09-03 18:47:56.297934+00	inline_excerpt	caller_supplied	e80e1541adf3c3f8e4c13869476badb91d04264205415a21b18caa89cc7902e6	parsed	\N	\N
20727d9f-1593-4ea6-89a1-20d61909d2b6	b0cf4531-7c84-48c9-b9b9-1504b083c0d9	answer_citation	\N	\N	\N	e3a49dc96ac218ad3cdacc70471e78d6407763d373937e0945ca6e3c07692fc6	retrieved	2026-09-04 02:55:49.214+00	\N	\N	\N	\N	\N	Acme Corp FY25 results. Revenue increased 12% year over year in FY25.	2026-09-04 02:55:49.214876+00	inline_excerpt	caller_supplied	e3a49dc96ac218ad3cdacc70471e78d6407763d373937e0945ca6e3c07692fc6	parsed	\N	\N
5aefc719-245a-460c-b889-dff389e74bf6	fb321bdb-902b-438e-8f47-c751f7c738e5	answer_citation	\N	\N	\N	f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21	retrieved	2026-09-04 04:01:54.95+00	\N	\N	\N	\N	\N	Acme Corp FY25 results. Revenue declined 12 percent in fiscal 2025.	2026-09-04 04:01:54.952066+00	inline_excerpt	caller_supplied	f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21	parsed	\N	\N
5d80a2ec-e0d8-4e27-b7d3-30ef174699c3	9d610dc7-f5b3-473a-aae3-a02704a59380	answer_citation	\N	\N	\N	e3a49dc96ac218ad3cdacc70471e78d6407763d373937e0945ca6e3c07692fc6	retrieved	2026-09-04 04:02:07.022+00	\N	\N	\N	\N	\N	Acme Corp FY25 results. Revenue increased 12% year over year in FY25.	2026-09-04 04:02:07.022947+00	inline_excerpt	caller_supplied	e3a49dc96ac218ad3cdacc70471e78d6407763d373937e0945ca6e3c07692fc6	parsed	\N	\N
8b13ab29-8ca0-4f81-9f55-27998793c9e3	e092ccc9-1b78-4919-a53e-012e70047461	answer_citation	\N	\N	\N	f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21	retrieved	2026-09-04 04:09:38.525+00	\N	\N	\N	\N	\N	Acme Corp FY25 results. Revenue declined 12 percent in fiscal 2025.	2026-09-04 04:09:38.526035+00	inline_excerpt	caller_supplied	f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21	parsed	\N	\N
8fa7380c-c6cc-4a06-b47b-e4abba69b682	76138ddc-9042-469b-a1c7-0cc6df02db33	answer_citation	https://www.accuweather.com/en/us/new-york/10021/weather-forecast/349727	\N	\N	5d00dd4b5794789c0c4f9c6c607226967e45dbee37890a7db4a0b011b04ebd8d	retrieved	2026-09-04 15:57:58.643+00	\N	\N	\N	\N	\N	currently 73°F, forecast high of 81°F today (Tue, Sep 1)	2026-09-04 15:57:58.644489+00	inline_excerpt	caller_supplied	5d00dd4b5794789c0c4f9c6c607226967e45dbee37890a7db4a0b011b04ebd8d	parsed	\N	\N
b9fb9991-8ace-4692-b9e3-9c2ed69c1eaa	6b4ed876-9a9a-4402-850d-d5d7d86a0efd	answer_citation	https://en.wikipedia.org/wiki/Statue_of_Liberty	\N	\N	c27615703bb32ef9f1a00993f9bb3a86fe8aa826265adf95a7fbd3fdcd28194b	retrieved	2026-09-04 16:00:54.485+00	\N	\N	\N	\N	\N	Height of copper statue (to torch): 151 feet 1 inch (46 meters); From ground level to torch: 305 feet 1 inch (93 meters)	2026-09-04 16:00:54.48676+00	inline_excerpt	caller_supplied	c27615703bb32ef9f1a00993f9bb3a86fe8aa826265adf95a7fbd3fdcd28194b	parsed	\N	\N
e43705eb-be37-4f6d-861e-15f629db6ffa	4a63340c-886d-4a54-8b0c-bb3062ce342f	answer_citation	\N	\N	\N	f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21	retrieved	2026-09-04 17:49:14.775+00	\N	\N	\N	\N	\N	Acme Corp FY25 results. Revenue declined 12 percent in fiscal 2025.	2026-09-04 17:49:14.775691+00	inline_excerpt	caller_supplied	f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21	parsed	\N	\N
\.


--
-- Data for Name: evidence_match; Type: TABLE DATA; Schema: public; Owner: notary
--

COPY public.evidence_match (id, claim_id, evidence_id, locator, resolved_text_hash, excerpt_ref, applicability_json, relation, method, evaluator_version, evaluated_at, locator_json, locator_resolved, locator_resolved_at, payload_revoked_at) FROM stdin;
0c3041b9-7902-4817-89d1-42fb0b338470	21c2c6ce-80d9-4089-9f36-bf0ee5789afa	a170d40d-13cd-4aca-a3e4-ad8364780cb7	inline:1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	\N	{"fields": [{"rule": "safe-syntax-v1", "field": "entity", "status": "matched", "claimed": "Acme", "evidence": "Acme", "normalizedClaimed": "acme", "normalizedEvidence": "acme"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "FY25", "evidence": "FY25", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"field": "measure", "status": "matched"}, {"field": "comparatorBaseline", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "modality", "status": "matched", "claimed": "actual", "evidence": "actual", "normalizedClaimed": "actual", "normalizedEvidence": "actual"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "status": "matched", "claimed": "12 %", "evidence": "12 %", "normalizedClaimed": "12 %", "normalizedEvidence": "12 %"}], "matched": ["entity", "period", "measure", "comparatorBaseline", "modality", "scope", "valueUnit"], "applicable": true, "mismatched": [], "valueConflicts": false}	supports	entailed	deepseek-v4-flash:judge-field-extraction-v1	2026-09-02 00:17:15.026681+00	\N	f	\N	\N
b45af193-b927-4857-994f-abb47e0e9870	925a39c7-b1b9-4dcc-b707-53fc6b588969	f973f0e7-2f29-4db5-a13a-0a6f308799f0	inline:88872f15e1d4fd3f739b592e83d4f5ac3f6ea93eb560b95cbce88ec4dc77d90e	88872f15e1d4fd3f739b592e83d4f5ac3f6ea93eb560b95cbce88ec4dc77d90e	\N	{"fields": [{"rule": "safe-syntax-v1", "field": "entity", "status": "matched", "claimed": "Acme", "evidence": "Acme", "normalizedClaimed": "acme", "normalizedEvidence": "acme"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "FY25", "evidence": "FY25", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"field": "measure", "status": "matched"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "status": "matched", "claimed": "12 %", "evidence": "12 %", "normalizedClaimed": "12 %", "normalizedEvidence": "12 %"}], "matched": ["entity", "period", "measure", "comparatorBaseline", "modality", "scope", "valueUnit"], "applicable": true, "mismatched": [], "valueConflicts": false}	supports	quoted_or_computed	deterministic-only	2026-09-02 00:17:30.809289+00	\N	f	\N	\N
97070aa7-c62e-4101-8339-13d730715383	8a1c842f-ee3b-46ad-b218-eeadcef1e18c	80a3fd94-95ab-44e3-9bbe-fd58e9075ce9	inline:1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	\N	{"fields": [{"rule": "safe-syntax-v1", "field": "entity", "status": "matched", "claimed": "Acme", "evidence": "Acme", "normalizedClaimed": "acme", "normalizedEvidence": "acme"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "FY25", "evidence": "FY25", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "revenue", "evidence": "revenue", "normalizedClaimed": "revenue", "normalizedEvidence": "revenue"}, {"rule": "safe-syntax-v1", "field": "operator", "status": "matched", "claimed": "increase", "evidence": "increase", "normalizedClaimed": "increase", "normalizedEvidence": "increase"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "status": "matched", "claimed": "12 %", "evidence": "12 %", "normalizedClaimed": "12 %", "normalizedEvidence": "12 %"}], "matched": ["entity", "period", "metric", "operator", "comparatorBaseline", "modality", "scope", "valueUnit"], "applicable": true, "mismatched": [], "valueConflicts": false}	supports	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-02 00:23:59.088563+00	\N	f	\N	\N
8c472dff-4064-47e8-9ac1-5aaa0cd764ce	981c9cfc-a089-458e-a013-886f542a398f	587915f1-b2d6-4b0b-ac4a-8ba8379388a7	inline:1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	\N	{"fields": [{"rule": "safe-syntax-v1", "field": "entity", "status": "matched", "claimed": "Acme", "evidence": "Acme", "normalizedClaimed": "acme", "normalizedEvidence": "acme"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "FY25", "evidence": "FY25", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "revenue", "evidence": "revenue", "normalizedClaimed": "revenue", "normalizedEvidence": "revenue"}, {"rule": "safe-syntax-v1", "field": "operator", "status": "matched", "claimed": "increase", "evidence": "increase", "normalizedClaimed": "increase", "normalizedEvidence": "increase"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "status": "matched", "claimed": "12 %", "evidence": "12 %", "normalizedClaimed": "12 %", "normalizedEvidence": "12 %"}], "matched": ["entity", "period", "metric", "operator", "comparatorBaseline", "modality", "scope", "valueUnit"], "applicable": true, "mismatched": [], "valueConflicts": false}	supports	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-02 00:37:40.222633+00	\N	f	\N	\N
9dc7b846-d92b-4ac9-bd85-86760e8f040a	e6ab81eb-5bc9-4b31-8bca-63c6467cff29	59903c17-16a2-414a-bdad-7b304b173808	inline:1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	\N	{"fields": [{"rule": "safe-syntax-v1", "field": "entity", "status": "matched", "claimed": "Acme", "evidence": "Acme", "normalizedClaimed": "acme", "normalizedEvidence": "acme"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "FY25", "evidence": "FY25", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "revenue", "evidence": "revenue", "normalizedClaimed": "revenue", "normalizedEvidence": "revenue"}, {"rule": "safe-syntax-v1", "field": "operator", "status": "matched", "claimed": "increase", "evidence": "increase", "normalizedClaimed": "increase", "normalizedEvidence": "increase"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "status": "matched", "claimed": "12 %", "evidence": "12 %", "normalizedClaimed": "12 %", "normalizedEvidence": "12 %"}], "matched": ["entity", "period", "metric", "operator", "comparatorBaseline", "modality", "scope", "valueUnit"], "applicable": true, "mismatched": [], "valueConflicts": false}	supports	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-02 00:37:42.541175+00	\N	f	\N	\N
c3783001-60c2-4f69-978e-847a25b66b62	54bf7e1c-d038-42fa-b34c-7d9f96cd1513	90868b75-b95c-466e-a43a-164302839db3	inline:1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	\N	{"fields": [{"rule": "safe-syntax-v1", "field": "entity", "status": "matched", "claimed": "Acme", "evidence": "Acme", "normalizedClaimed": "acme", "normalizedEvidence": "acme"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "FY25", "evidence": "FY25", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "revenue", "evidence": "revenue", "normalizedClaimed": "revenue", "normalizedEvidence": "revenue"}, {"rule": "safe-syntax-v1", "field": "operator", "status": "matched", "claimed": "increase", "evidence": "increase", "normalizedClaimed": "increase", "normalizedEvidence": "increase"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "status": "matched", "claimed": "12 %", "evidence": "12 %", "normalizedClaimed": "12 %", "normalizedEvidence": "12 %"}], "matched": ["entity", "period", "metric", "operator", "comparatorBaseline", "modality", "scope", "valueUnit"], "applicable": true, "mismatched": [], "valueConflicts": false}	supports	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-02 00:37:44.569454+00	\N	f	\N	\N
30af3b26-515f-4093-bbd2-ebda2a7dff7a	d5e6152b-592b-4c23-972e-680788678093	a8408d56-bf72-4bd1-8f4a-1f8c281d407e	https://example.com/acme	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	\N	{"fields": [{"rule": "safe-syntax-v1", "field": "entity", "status": "matched", "claimed": "Acme", "evidence": "Acme", "normalizedClaimed": "acme", "normalizedEvidence": "acme"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "FY25", "evidence": "FY25", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "revenue", "evidence": "revenue", "normalizedClaimed": "revenue", "normalizedEvidence": "revenue"}, {"rule": "safe-syntax-v1", "field": "operator", "status": "matched", "claimed": "increase", "evidence": "increase", "normalizedClaimed": "increase", "normalizedEvidence": "increase"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "status": "matched", "claimed": "12 %", "evidence": "12 %", "normalizedClaimed": "12 %", "normalizedEvidence": "12 %"}], "matched": ["entity", "period", "metric", "operator", "comparatorBaseline", "modality", "scope", "valueUnit"], "applicable": true, "mismatched": [], "valueConflicts": false}	supports	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-02 00:49:16.695882+00	\N	f	\N	\N
348fe566-7f21-4e8f-a131-91b6ae9b6358	26ddf957-d16a-447d-a867-93d69543cab4	b1d89b7f-8420-464b-80f4-63179d6ee1cc	https://example.com/acme	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	\N	{"fields": [{"rule": "safe-syntax-v1", "field": "entity", "status": "matched", "claimed": "Acme", "evidence": "Acme", "normalizedClaimed": "acme", "normalizedEvidence": "acme"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "FY25", "evidence": "FY25", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "revenue", "evidence": "revenue", "normalizedClaimed": "revenue", "normalizedEvidence": "revenue"}, {"rule": "safe-syntax-v1", "field": "operator", "status": "matched", "claimed": "increase", "evidence": "increase", "normalizedClaimed": "increase", "normalizedEvidence": "increase"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "status": "matched", "claimed": "12 %", "evidence": "12 %", "normalizedClaimed": "12 %", "normalizedEvidence": "12 %"}], "matched": ["entity", "period", "metric", "operator", "comparatorBaseline", "modality", "scope", "valueUnit"], "applicable": true, "mismatched": [], "valueConflicts": false}	supports	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-02 00:53:48.616067+00	\N	f	\N	\N
c1e36ca0-9876-4e07-9c78-b295df301b85	1c0fb905-3b31-4fa4-b653-88759a4ba8aa	370cec08-8d81-49de-922c-1d94d5d59e0f	https://example.com/acme	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	\N	{"fields": [{"rule": "safe-syntax-v1", "field": "entity", "status": "matched", "claimed": "Acme", "evidence": "Acme", "normalizedClaimed": "acme", "normalizedEvidence": "acme"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "FY25", "evidence": "FY25", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "revenue", "evidence": "revenue", "normalizedClaimed": "revenue", "normalizedEvidence": "revenue"}, {"rule": "safe-syntax-v1", "field": "operator", "status": "matched", "claimed": "increase", "evidence": "increase", "normalizedClaimed": "increase", "normalizedEvidence": "increase"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "status": "matched", "claimed": "12 %", "evidence": "12 %", "normalizedClaimed": "12 %", "normalizedEvidence": "12 %"}], "matched": ["entity", "period", "metric", "operator", "comparatorBaseline", "modality", "scope", "valueUnit"], "applicable": true, "mismatched": [], "valueConflicts": false}	supports	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-02 01:13:23.070964+00	\N	f	\N	\N
b815e381-4ab1-48ce-941a-00296525cdff	93f715ae-ef87-48b7-a360-515c1d44f555	d220ace3-163c-43da-b5d3-99ff1bb80e47	https://example.com/acme	1e21faa72a40c02c9742093408a197b30f26cf02f18ac3d259a4d2915e54299b	\N	{"fields": [{"rule": "safe-syntax-v1", "field": "entity", "status": "matched", "claimed": "Acme", "evidence": "Acme", "normalizedClaimed": "acme", "normalizedEvidence": "acme"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "FY25", "evidence": "FY25", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "revenue", "evidence": "revenue", "normalizedClaimed": "revenue", "normalizedEvidence": "revenue"}, {"rule": "safe-syntax-v1", "field": "operator", "status": "matched", "claimed": "increase", "evidence": "increase", "normalizedClaimed": "increase", "normalizedEvidence": "increase"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "status": "matched", "claimed": "12 %", "evidence": "12 %", "normalizedClaimed": "12 %", "normalizedEvidence": "12 %"}], "matched": ["entity", "period", "metric", "operator", "comparatorBaseline", "modality", "scope", "valueUnit"], "applicable": true, "mismatched": [], "valueConflicts": false}	supports	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-02 01:18:49.939187+00	\N	f	\N	\N
b63565c9-b1db-4cce-9d26-8184357b72f5	8bd4f965-03a0-4664-98c3-d2ac15607a94	58cb2a15-ff3a-46a1-b878-6f781e90ab03	inline:579d15030d37d76985e207ca3330cfbe5dc3f42b0508c99e349b99ab27be04e5	579d15030d37d76985e207ca3330cfbe5dc3f42b0508c99e349b99ab27be04e5	\N	{"fields": [{"rule": "safe-syntax-v1", "field": "entity", "status": "matched", "claimed": "New York", "evidence": "New York", "normalizedClaimed": "new york", "normalizedEvidence": "new york"}, {"rule": "safe-syntax-v1", "field": "period", "status": "matched", "claimed": "today", "evidence": "today", "normalizedClaimed": "today", "normalizedEvidence": "today"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "temperature", "evidence": "temperature", "normalizedClaimed": "temperature", "normalizedEvidence": "temperature"}, {"field": "operator", "status": "matched"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "detail": "value conflict: \\"100\\" vs \\"73\\"", "status": "value_conflict", "claimed": "100 F", "evidence": "73 F", "normalizedClaimed": "100 f", "normalizedEvidence": "73 f"}], "matched": ["entity", "period", "metric", "operator", "comparatorBaseline", "modality", "scope"], "applicable": true, "mismatched": [], "valueConflicts": true}	contradicts	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-02 02:38:48.630383+00	\N	f	\N	\N
4e451737-2b74-48fe-bf6a-1e5a2674bcbe	01f1a727-f013-4477-9001-c21385ebbfb6	7caf3f4f-4c28-48a6-b11d-1fc18f75efe7	inline:800d745620bfe0dc55da8bfa871b036d15c49c5606cd1fca3cd22c24eb601f5a	800d745620bfe0dc55da8bfa871b036d15c49c5606cd1fca3cd22c24eb601f5a	\N	{"fields": [{"rule": "entity-corporate-suffix-v1", "field": "entity", "status": "matched", "claimed": "Acme Corp", "evidence": "Acme Corp", "normalizedClaimed": "acme corp", "normalizedEvidence": "acme corp"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "FY25", "evidence": "FY25", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "revenue", "evidence": "revenue", "normalizedClaimed": "revenue", "normalizedEvidence": "revenue"}, {"rule": "safe-syntax-v1", "field": "operator", "status": "matched", "claimed": "increase", "evidence": "increase", "normalizedClaimed": "increase", "normalizedEvidence": "increase"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "status": "matched", "claimed": "17 %", "evidence": "17 %", "normalizedClaimed": "17 %", "normalizedEvidence": "17 %"}], "matched": ["entity", "period", "metric", "operator", "comparatorBaseline", "modality", "scope", "valueUnit"], "applicable": true, "mismatched": [], "valueConflicts": false}	supports	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-02 15:32:32.916995+00	\N	f	\N	\N
f297c3d6-993d-4023-ba09-0f6b375943bf	95811f19-2742-4c36-a005-5b724f071be2	c8ef7c34-b899-4abd-8799-9baa7fa24966	inline:0eae2793f714ad2f77c95a8d5475b4a99eddfa919ee65cd1dc4de426b756293b	0eae2793f714ad2f77c95a8d5475b4a99eddfa919ee65cd1dc4de426b756293b	\N	{"fields": [{"rule": "entity-corporate-suffix-v1", "field": "entity", "status": "matched", "claimed": "Acme, Inc.", "evidence": "Acme Inc", "normalizedClaimed": "acme inc", "normalizedEvidence": "acme inc"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "FY25", "evidence": "fiscal 2025", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "revenue", "evidence": "revenue", "normalizedClaimed": "revenue", "normalizedEvidence": "revenue"}, {"rule": "safe-syntax-v1", "field": "operator", "status": "matched", "claimed": "increase", "evidence": "increase", "normalizedClaimed": "increase", "normalizedEvidence": "increase"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "status": "matched", "claimed": "17 %", "evidence": "17 %", "normalizedClaimed": "17 %", "normalizedEvidence": "17 %"}], "matched": ["entity", "period", "metric", "operator", "comparatorBaseline", "modality", "scope", "valueUnit"], "applicable": true, "mismatched": [], "valueConflicts": false}	supports	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-02 15:32:45.919624+00	\N	f	\N	\N
f7ccaac6-cc7d-4d42-9cb5-88e8c2073821	7aa45ffe-3455-4430-8b24-f5a96e47c74c	74d02c0d-4833-4e41-b66b-0b140ac80c1a	inline:3d84c1d183f78859c3e39c9e43657fad386a391c15b49633cd9898b040ba98e0	3d84c1d183f78859c3e39c9e43657fad386a391c15b49633cd9898b040ba98e0	\N	{"fields": [{"rule": "entity-corporate-suffix-v1", "field": "entity", "status": "matched", "claimed": "Acme Inc", "evidence": "Acme Inc", "normalizedClaimed": "acme inc", "normalizedEvidence": "acme inc"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "FY25", "evidence": "FY25", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "revenue", "evidence": "revenue", "normalizedClaimed": "revenue", "normalizedEvidence": "revenue"}, {"rule": "safe-syntax-v1", "field": "operator", "status": "matched", "claimed": "increase", "evidence": "increase", "normalizedClaimed": "increase", "normalizedEvidence": "increase"}, {"field": "comparatorBaseline", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "modality", "status": "matched", "claimed": "actual", "evidence": "actual", "normalizedClaimed": "actual", "normalizedEvidence": "actual"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "detail": "value conflict: \\"17\\" vs \\"12\\"", "status": "value_conflict", "claimed": "17 %", "evidence": "12 %", "normalizedClaimed": "17 %", "normalizedEvidence": "12 %"}], "matched": ["entity", "period", "metric", "operator", "comparatorBaseline", "modality", "scope"], "applicable": true, "mismatched": [], "valueConflicts": true}	contradicts	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-02 15:33:29.241545+00	\N	f	\N	\N
84c01d78-9aac-4f5c-ac7a-c251ac0f0adc	bd20fd78-1189-460b-a00b-98fcf5d77637	7eb13c1a-8a28-4b9c-8048-6a2aacebb3b1	https://www.chinahighlights.com/greatwall/fact/great-wall-length.htm	ac5752d03926e6ed628ea87d5cf3c0c24b21649dd05126c19a59f7e4b6f29dbf	\N	{"fields": [{"rule": "safe-syntax-v1", "field": "entity", "status": "matched", "claimed": "The Great Wall of China", "evidence": "The Great Wall of China", "normalizedClaimed": "the great wall of china", "normalizedEvidence": "the great wall of china"}, {"field": "period", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "length", "evidence": "length", "normalizedClaimed": "length", "normalizedEvidence": "length"}, {"field": "operator", "status": "matched"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "detail": "value conflict: \\"5\\" vs \\"21196.18\\"", "status": "value_conflict", "claimed": "5 kilometers", "evidence": "21196.18 kilometers", "normalizedClaimed": "5 kilometers", "normalizedEvidence": "21196.18 kilometers"}], "matched": ["entity", "period", "metric", "operator", "comparatorBaseline", "modality", "scope"], "applicable": true, "mismatched": [], "valueConflicts": true}	contradicts	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-03 13:40:10.739278+00	\N	f	\N	\N
37f4c43d-63f5-46d9-af1e-087cf1a5a622	50a140e4-9895-4259-b88a-cfe945d4f19b	909a2f96-7e33-4529-8e7e-ba2d43fe4750	https://en.wikipedia.org/wiki/Moons_of_Jupiter	6db592e7f783cb9e4b5f7b580d677de2a39e151dedc5a07e4793079c1e15eafa	\N	{"fields": [{"rule": "safe-syntax-v1", "field": "entity", "status": "matched", "claimed": "Jupiter", "evidence": "Jupiter", "normalizedClaimed": "jupiter", "normalizedEvidence": "jupiter"}, {"field": "period", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "moons", "evidence": "moons", "normalizedClaimed": "moons", "normalizedEvidence": "moons"}, {"field": "operator", "status": "matched"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "detail": "value conflict: \\"2\\" vs \\"95\\"", "status": "value_conflict", "claimed": "2", "evidence": "95 confirmed moons", "normalizedClaimed": "2", "normalizedEvidence": "95 confirmed moons"}], "matched": ["entity", "period", "metric", "operator", "comparatorBaseline", "modality", "scope"], "applicable": true, "mismatched": [], "valueConflicts": true}	contradicts	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-03 13:41:48.44656+00	\N	f	\N	\N
89a3d69c-1629-4831-8a46-60b846a6e411	05f73744-3de9-4b2a-8c62-7b1f96c653bc	140eb263-20eb-41b0-aa7c-8a6d380deb12	https://en.wikipedia.org/wiki/Great_Barrier_Reef	e80e1541adf3c3f8e4c13869476badb91d04264205415a21b18caa89cc7902e6	\N	{"fields": [{"rule": "safe-syntax-v1", "field": "entity", "status": "matched", "claimed": "The Great Barrier Reef", "evidence": "The Great Barrier Reef", "normalizedClaimed": "the great barrier reef", "normalizedEvidence": "the great barrier reef"}, {"field": "period", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "length", "evidence": "length", "normalizedClaimed": "length", "normalizedEvidence": "length"}, {"field": "operator", "status": "matched"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "status": "matched", "claimed": "2 kilometers", "evidence": "2 kilometers", "normalizedClaimed": "2 kilometers", "normalizedEvidence": "2 kilometers"}], "matched": ["entity", "period", "metric", "operator", "comparatorBaseline", "modality", "scope", "valueUnit"], "applicable": true, "mismatched": [], "valueConflicts": false}	supports	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-03 13:42:03.578436+00	\N	f	\N	\N
f4c0ae4e-0838-42ab-990a-a09ec15fe2a4	fe9bd89a-7cdd-48a3-9c6f-1e8a158fe9ed	7be93562-2d55-49f7-b32b-6011bc9062bb	caller-excerpt:419bef2144cf604e#chars=0-9	419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b	\N	{"fields": [{"rule": "entity-corporate-suffix-v1", "field": "entity", "status": "matched", "claimed": "Acme Corp", "evidence": "Acme Corp", "normalizedClaimed": "acme corp", "normalizedEvidence": "acme corp"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "fiscal year 2025", "evidence": "fiscal year 2025", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "revenue", "evidence": "revenue", "normalizedClaimed": "revenue", "normalizedEvidence": "revenue"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "operator", "status": "matched", "claimed": "increase", "evidence": "increase", "normalizedClaimed": "increase", "normalizedEvidence": "increase"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "status": "matched", "claimed": "12 %", "evidence": "12 %", "normalizedClaimed": "12 %", "normalizedEvidence": "12 %"}], "matched": ["entity", "period", "metric", "comparatorBaseline", "modality", "scope", "operator", "valueUnit"], "applicable": true, "mismatched": [], "valueConflicts": false}	supports	quoted_or_computed	deterministic-only	2026-09-03 15:54:35.166267+00	{"fields": [{"field": "entity", "source": "deterministic", "locator": {"end": 9, "kind": "text_offsets", "quote": "Acme Corp", "start": 0, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}, {"field": "period", "source": "deterministic", "locator": {"end": 53, "kind": "text_offsets", "quote": "fiscal year 2025", "start": 37, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}, {"field": "metric", "source": "deterministic", "locator": {"end": 19, "kind": "text_offsets", "quote": "revenue", "start": 12, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}, {"field": "operator", "source": "deterministic", "locator": {"end": 28, "kind": "text_offsets", "quote": "increase", "start": 20, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}, {"field": "valueUnit", "source": "deterministic", "locator": {"end": 32, "kind": "text_offsets", "quote": "12", "start": 30, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}], "primary": {"end": 9, "kind": "text_offsets", "quote": "Acme Corp", "start": 0, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}	t	2026-09-03 15:54:35.166267+00	\N
f76a78a6-fe75-491d-ac53-2202258b4e83	4a2a3686-c2f8-4359-a334-f2483d078dfd	14e7da3d-8ddd-4e2d-8a28-c5fe7e5b1af1	caller-excerpt:419bef2144cf604e#chars=0-9	419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b	\N	{"fields": [{"rule": "entity-corporate-suffix-v1", "field": "entity", "status": "matched", "claimed": "Acme Corp", "evidence": "Acme Corp", "normalizedClaimed": "acme corp", "normalizedEvidence": "acme corp"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "fiscal year 2025", "evidence": "fiscal year 2025", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "revenue", "evidence": "revenue", "normalizedClaimed": "revenue", "normalizedEvidence": "revenue"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "operator", "status": "matched", "claimed": "increase", "evidence": "increase", "normalizedClaimed": "increase", "normalizedEvidence": "increase"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "detail": "value conflict: \\"17\\" vs \\"12\\"", "status": "value_conflict", "claimed": "17 %", "evidence": "12 %", "normalizedClaimed": "17 %", "normalizedEvidence": "12 %"}], "matched": ["entity", "period", "metric", "comparatorBaseline", "modality", "scope", "operator"], "applicable": true, "mismatched": [], "valueConflicts": true}	contradicts	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-03 16:01:51.111183+00	{"fields": [{"field": "entity", "source": "deterministic", "locator": {"end": 9, "kind": "text_offsets", "quote": "Acme Corp", "start": 0, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}, {"field": "period", "source": "deterministic", "locator": {"end": 53, "kind": "text_offsets", "quote": "fiscal year 2025", "start": 37, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}, {"field": "metric", "source": "deterministic", "locator": {"end": 19, "kind": "text_offsets", "quote": "revenue", "start": 12, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}, {"field": "operator", "source": "deterministic", "locator": {"end": 28, "kind": "text_offsets", "quote": "increase", "start": 20, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}, {"field": "valueUnit", "source": "judge", "locator": {"end": 33, "kind": "text_offsets", "quote": "revenue increased 12%", "start": 12, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}], "primary": {"end": 9, "kind": "text_offsets", "quote": "Acme Corp", "start": 0, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}	t	2026-09-03 16:01:51.111183+00	\N
0fead6d4-900f-4bdf-98c8-e510cc2042ae	ad3c6ed8-e0a1-4f6c-bebe-5d4bf17f3b5e	8ca2c6f0-3a47-4328-a117-c2f592f79f1e	caller-excerpt:419bef2144cf604e#chars=0-9	419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b	\N	{"fields": [{"rule": "entity-corporate-suffix-v1", "field": "entity", "status": "matched", "claimed": "Acme Corp", "evidence": "Acme Corp", "normalizedClaimed": "acme corp", "normalizedEvidence": "acme corp"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "fiscal 2025", "evidence": "fiscal year 2025", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "revenue", "evidence": "revenue", "normalizedClaimed": "revenue", "normalizedEvidence": "revenue"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "operator", "status": "matched", "claimed": "increase", "evidence": "increase", "normalizedClaimed": "increase", "normalizedEvidence": "increase"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "status": "matched", "claimed": "12 percent", "evidence": "12 percent", "normalizedClaimed": "12 %", "normalizedEvidence": "12 %"}], "matched": ["entity", "period", "metric", "comparatorBaseline", "modality", "scope", "operator", "valueUnit"], "applicable": true, "mismatched": [], "valueConflicts": false}	supports	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-03 16:02:45.883471+00	{"fields": [{"field": "entity", "source": "deterministic", "locator": {"end": 9, "kind": "text_offsets", "quote": "Acme Corp", "start": 0, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}, {"field": "period", "source": "judge", "locator": {"end": 53, "kind": "text_offsets", "quote": "in fiscal year 2025", "start": 34, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}, {"field": "metric", "source": "deterministic", "locator": {"end": 19, "kind": "text_offsets", "quote": "revenue", "start": 12, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}, {"field": "operator", "source": "deterministic", "locator": {"end": 28, "kind": "text_offsets", "quote": "increase", "start": 20, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}, {"field": "valueUnit", "source": "deterministic", "locator": {"end": 32, "kind": "text_offsets", "quote": "12", "start": 30, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}], "primary": {"end": 9, "kind": "text_offsets", "quote": "Acme Corp", "start": 0, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}	t	2026-09-03 16:02:45.883471+00	\N
f656459b-e287-4e99-a01a-bb8e771245f6	13a650e0-fcfe-481c-befa-de36f92694c7	601e972d-2fa9-45f7-b9aa-09f97723f143	caller-excerpt:419bef2144cf604e#chars=0-9	419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b	\N	{"fields": [{"rule": "entity-corporate-suffix-v1", "field": "entity", "status": "matched", "claimed": "Acme Corp", "evidence": "Acme Corp", "normalizedClaimed": "acme corp", "normalizedEvidence": "acme corp"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "fiscal year 2025", "evidence": "fiscal year 2025", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "revenue", "evidence": "revenue", "normalizedClaimed": "revenue", "normalizedEvidence": "revenue"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "operator", "status": "matched", "claimed": "increase", "evidence": "increase", "normalizedClaimed": "increase", "normalizedEvidence": "increase"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "detail": "value conflict: \\"17\\" vs \\"12\\"", "status": "value_conflict", "claimed": "17 %", "evidence": "12 %", "normalizedClaimed": "17 %", "normalizedEvidence": "12 %"}], "matched": ["entity", "period", "metric", "comparatorBaseline", "modality", "scope", "operator"], "applicable": true, "mismatched": [], "valueConflicts": true}	contradicts	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-03 16:03:37.819451+00	{"fields": [{"field": "entity", "source": "deterministic", "locator": {"end": 9, "kind": "text_offsets", "quote": "Acme Corp", "start": 0, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}, {"field": "period", "source": "deterministic", "locator": {"end": 53, "kind": "text_offsets", "quote": "fiscal year 2025", "start": 37, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}, {"field": "metric", "source": "deterministic", "locator": {"end": 19, "kind": "text_offsets", "quote": "revenue", "start": 12, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}, {"field": "operator", "source": "deterministic", "locator": {"end": 28, "kind": "text_offsets", "quote": "increase", "start": 20, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}, {"field": "valueUnit", "source": "judge", "locator": {"end": 33, "kind": "text_offsets", "quote": "revenue increased 12%", "start": 12, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}], "primary": {"end": 9, "kind": "text_offsets", "quote": "Acme Corp", "start": 0, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": "https://example.com/acme-fy25", "canonicalTextHash": "419bef2144cf604ea95222dae90b1012a2cb11154d06c85fb825d3dc8155654b"}}	t	2026-09-03 16:03:37.819451+00	\N
38198445-33ad-4b09-8e5d-25e7867ae9f1	8f93dfd9-9288-4357-864f-6bfcc081d190	20727d9f-1593-4ea6-89a1-20d61909d2b6	caller-excerpt:e3a49dc96ac218ad#chars=0-4	e3a49dc96ac218ad3cdacc70471e78d6407763d373937e0945ca6e3c07692fc6	\N	{"fields": [{"rule": "safe-syntax-v1", "field": "entity", "status": "matched", "claimed": "Acme", "evidence": "Acme", "normalizedClaimed": "acme", "normalizedEvidence": "acme"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "FY25", "evidence": "FY25", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "revenue", "evidence": "revenue", "normalizedClaimed": "revenue", "normalizedEvidence": "revenue"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "operator", "status": "matched", "claimed": "increase", "evidence": "increase", "normalizedClaimed": "increase", "normalizedEvidence": "increase"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "detail": "value conflict: \\"17\\" vs \\"12\\"", "status": "value_conflict", "claimed": "17 %", "evidence": "12 %", "normalizedClaimed": "17 %", "normalizedEvidence": "12 %"}], "matched": ["entity", "period", "metric", "comparatorBaseline", "modality", "scope", "operator"], "applicable": true, "mismatched": [], "valueConflicts": true}	contradicts	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-04 02:55:50.992448+00	{"fields": [{"field": "entity", "source": "deterministic", "locator": {"end": 4, "kind": "text_offsets", "quote": "Acme", "start": 0, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "e3a49dc96ac218ad3cdacc70471e78d6407763d373937e0945ca6e3c07692fc6"}}, {"field": "period", "source": "deterministic", "locator": {"end": 14, "kind": "text_offsets", "quote": "FY25", "start": 10, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "e3a49dc96ac218ad3cdacc70471e78d6407763d373937e0945ca6e3c07692fc6"}}, {"field": "metric", "source": "deterministic", "locator": {"end": 31, "kind": "text_offsets", "quote": "Revenue", "start": 24, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "e3a49dc96ac218ad3cdacc70471e78d6407763d373937e0945ca6e3c07692fc6"}}, {"field": "operator", "source": "deterministic", "locator": {"end": 40, "kind": "text_offsets", "quote": "increase", "start": 32, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "e3a49dc96ac218ad3cdacc70471e78d6407763d373937e0945ca6e3c07692fc6"}}, {"field": "valueUnit", "source": "judge", "locator": {"end": 69, "kind": "text_offsets", "quote": "Revenue increased 12% year over year in FY25.", "start": 24, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "e3a49dc96ac218ad3cdacc70471e78d6407763d373937e0945ca6e3c07692fc6"}}], "primary": {"end": 4, "kind": "text_offsets", "quote": "Acme", "start": 0, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "e3a49dc96ac218ad3cdacc70471e78d6407763d373937e0945ca6e3c07692fc6"}}	t	2026-09-04 02:55:50.992448+00	\N
c44703a6-2400-4ae2-8d21-164ca819a6fd	00ba0e7a-5cc4-41b2-b067-3dc7019249b6	5aefc719-245a-460c-b889-dff389e74bf6	caller-excerpt:f2ad9136c14cae60#chars=0-4	f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21	\N	{"fields": [{"rule": "safe-syntax-v1", "field": "entity", "status": "matched", "claimed": "Acme", "evidence": "Acme", "normalizedClaimed": "acme", "normalizedEvidence": "acme"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "FY25", "evidence": "FY25", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "revenue", "evidence": "revenue", "normalizedClaimed": "revenue", "normalizedEvidence": "revenue"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "operator", "detail": "operator conflict: \\"increase\\" vs \\"decrease\\"", "status": "value_conflict", "claimed": "increase", "evidence": "decrease", "normalizedClaimed": "increase", "normalizedEvidence": "decrease"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "detail": "value conflict: \\"17\\" vs \\"12\\"", "status": "value_conflict", "claimed": "17 %", "evidence": "12 percent", "normalizedClaimed": "17 %", "normalizedEvidence": "12 %"}], "matched": ["entity", "period", "metric", "comparatorBaseline", "modality", "scope"], "applicable": true, "mismatched": [], "valueConflicts": true}	contradicts	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-04 04:01:58.334689+00	{"fields": [{"field": "entity", "source": "deterministic", "locator": {"end": 4, "kind": "text_offsets", "quote": "Acme", "start": 0, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21"}}, {"field": "period", "source": "deterministic", "locator": {"end": 14, "kind": "text_offsets", "quote": "FY25", "start": 10, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21"}}, {"field": "metric", "source": "deterministic", "locator": {"end": 31, "kind": "text_offsets", "quote": "Revenue", "start": 24, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21"}}, {"field": "operator", "source": "judge", "locator": {"end": 67, "kind": "text_offsets", "quote": "Revenue declined 12 percent in fiscal 2025.", "start": 24, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21"}}, {"field": "valueUnit", "source": "judge", "locator": {"end": 67, "kind": "text_offsets", "quote": "Revenue declined 12 percent in fiscal 2025.", "start": 24, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21"}}], "primary": {"end": 4, "kind": "text_offsets", "quote": "Acme", "start": 0, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21"}}	t	2026-09-04 04:01:58.334689+00	\N
16e3e0d9-3e8c-4df9-a1ac-4c387c441549	efc0e1b8-bc9d-4fda-bdef-595cc9a03487	5d80a2ec-e0d8-4e27-b7d3-30ef174699c3	caller-excerpt:e3a49dc96ac218ad#chars=0-4	e3a49dc96ac218ad3cdacc70471e78d6407763d373937e0945ca6e3c07692fc6	\N	{"fields": [{"rule": "safe-syntax-v1", "field": "entity", "status": "matched", "claimed": "Acme", "evidence": "Acme", "normalizedClaimed": "acme", "normalizedEvidence": "acme"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "FY25", "evidence": "FY25", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "revenue", "evidence": "revenue", "normalizedClaimed": "revenue", "normalizedEvidence": "revenue"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "operator", "status": "matched", "claimed": "increase", "evidence": "increase", "normalizedClaimed": "increase", "normalizedEvidence": "increase"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "detail": "value conflict: \\"17\\" vs \\"12\\"", "status": "value_conflict", "claimed": "17 %", "evidence": "12 %", "normalizedClaimed": "17 %", "normalizedEvidence": "12 %"}], "matched": ["entity", "period", "metric", "comparatorBaseline", "modality", "scope", "operator"], "applicable": true, "mismatched": [], "valueConflicts": true}	contradicts	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-04 04:02:08.734297+00	{"fields": [{"field": "entity", "source": "deterministic", "locator": {"end": 4, "kind": "text_offsets", "quote": "Acme", "start": 0, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "e3a49dc96ac218ad3cdacc70471e78d6407763d373937e0945ca6e3c07692fc6"}}, {"field": "period", "source": "deterministic", "locator": {"end": 14, "kind": "text_offsets", "quote": "FY25", "start": 10, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "e3a49dc96ac218ad3cdacc70471e78d6407763d373937e0945ca6e3c07692fc6"}}, {"field": "metric", "source": "deterministic", "locator": {"end": 31, "kind": "text_offsets", "quote": "Revenue", "start": 24, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "e3a49dc96ac218ad3cdacc70471e78d6407763d373937e0945ca6e3c07692fc6"}}, {"field": "operator", "source": "deterministic", "locator": {"end": 40, "kind": "text_offsets", "quote": "increase", "start": 32, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "e3a49dc96ac218ad3cdacc70471e78d6407763d373937e0945ca6e3c07692fc6"}}, {"field": "valueUnit", "source": "judge", "locator": {"end": 69, "kind": "text_offsets", "quote": "Revenue increased 12% year over year in FY25.", "start": 24, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "e3a49dc96ac218ad3cdacc70471e78d6407763d373937e0945ca6e3c07692fc6"}}], "primary": {"end": 4, "kind": "text_offsets", "quote": "Acme", "start": 0, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "e3a49dc96ac218ad3cdacc70471e78d6407763d373937e0945ca6e3c07692fc6"}}	t	2026-09-04 04:02:08.734297+00	\N
4848b8d8-41ca-41c9-9dc3-a9417860f608	a37afb78-af75-4918-ac32-146313e9abbc	8b13ab29-8ca0-4f81-9f55-27998793c9e3	caller-excerpt:f2ad9136c14cae60#chars=0-4	f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21	\N	{"fields": [{"rule": "safe-syntax-v1", "field": "entity", "status": "matched", "claimed": "Acme", "evidence": "Acme", "normalizedClaimed": "acme", "normalizedEvidence": "acme"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "FY25", "evidence": "FY25", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "revenue", "evidence": "revenue", "normalizedClaimed": "revenue", "normalizedEvidence": "revenue"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "operator", "detail": "operator conflict: \\"increase\\" vs \\"decrease\\"", "status": "value_conflict", "claimed": "increase", "evidence": "decrease", "normalizedClaimed": "increase", "normalizedEvidence": "decrease"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "detail": "value conflict: \\"17\\" vs \\"12\\"", "status": "value_conflict", "claimed": "17 %", "evidence": "12 percent", "normalizedClaimed": "17 %", "normalizedEvidence": "12 %"}], "matched": ["entity", "period", "metric", "comparatorBaseline", "modality", "scope"], "applicable": true, "mismatched": [], "valueConflicts": true}	contradicts	entailed	deepseek-v4-flash:judge-field-extraction-v2	2026-09-04 04:09:41.340515+00	{"fields": [{"field": "entity", "source": "deterministic", "locator": {"end": 4, "kind": "text_offsets", "quote": "Acme", "start": 0, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21"}}, {"field": "period", "source": "deterministic", "locator": {"end": 14, "kind": "text_offsets", "quote": "FY25", "start": 10, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21"}}, {"field": "metric", "source": "deterministic", "locator": {"end": 31, "kind": "text_offsets", "quote": "Revenue", "start": 24, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21"}}, {"field": "operator", "source": "judge", "locator": {"end": 67, "kind": "text_offsets", "quote": "Revenue declined 12 percent in fiscal 2025.", "start": 24, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21"}}, {"field": "valueUnit", "source": "judge", "locator": {"end": 67, "kind": "text_offsets", "quote": "Revenue declined 12 percent in fiscal 2025.", "start": 24, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21"}}], "primary": {"end": 4, "kind": "text_offsets", "quote": "Acme", "start": 0, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21"}}	t	2026-09-04 04:09:41.340515+00	\N
b6505d92-91f5-42d5-bcfd-63d279be075d	29219a30-ee23-4676-9bb1-b764e59e8c58	e43705eb-be37-4f6d-861e-15f629db6ffa	caller-excerpt:f2ad9136c14cae60#chars=0-4	f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21	\N	{"fields": [{"rule": "safe-syntax-v1", "field": "entity", "status": "matched", "claimed": "Acme", "evidence": "Acme", "normalizedClaimed": "acme", "normalizedEvidence": "acme"}, {"rule": "period-fiscal-label-v1", "field": "period", "status": "matched", "claimed": "FY25", "evidence": "FY25", "normalizedClaimed": "fy2025", "normalizedEvidence": "fy2025"}, {"rule": "safe-syntax-v1", "field": "metric", "status": "matched", "claimed": "revenue", "evidence": "revenue", "normalizedClaimed": "revenue", "normalizedEvidence": "revenue"}, {"field": "comparatorBaseline", "status": "matched"}, {"field": "modality", "status": "matched"}, {"field": "scope", "status": "matched"}, {"rule": "safe-syntax-v1", "field": "operator", "detail": "operator conflict: \\"increase\\" vs \\"decrease\\"", "status": "value_conflict", "claimed": "increase", "evidence": "decrease", "normalizedClaimed": "increase", "normalizedEvidence": "decrease"}, {"rule": "safe-syntax-v1", "field": "valueUnit", "detail": "value conflict: \\"17\\" vs \\"12\\"", "status": "value_conflict", "claimed": "17 %", "evidence": "12 percent", "normalizedClaimed": "17 %", "normalizedEvidence": "12 %"}], "matched": ["entity", "period", "metric", "comparatorBaseline", "modality", "scope"], "applicable": true, "mismatched": [], "valueConflicts": true}	contradicts	entailed	deepseek-v4-flash:judge-field-extraction-v3	2026-09-04 17:49:17.626791+00	{"fields": [{"field": "entity", "source": "deterministic", "locator": {"end": 4, "kind": "text_offsets", "quote": "Acme", "start": 0, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21"}}, {"field": "period", "source": "deterministic", "locator": {"end": 14, "kind": "text_offsets", "quote": "FY25", "start": 10, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21"}}, {"field": "metric", "source": "deterministic", "locator": {"end": 31, "kind": "text_offsets", "quote": "Revenue", "start": 24, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21"}}, {"field": "operator", "source": "judge", "locator": {"end": 67, "kind": "text_offsets", "quote": "Revenue declined 12 percent in fiscal 2025.", "start": 24, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21"}}, {"field": "valueUnit", "source": "judge", "locator": {"end": 67, "kind": "text_offsets", "quote": "Revenue declined 12 percent in fiscal 2025.", "start": 24, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21"}}], "primary": {"end": 4, "kind": "text_offsets", "quote": "Acme", "start": 0, "provenance": "caller_supplied", "contentKind": "inline_excerpt", "associatedUrl": null, "canonicalTextHash": "f2ad9136c14cae6010d23963f7bbfa1d2cb1dcaa7f55f2724e48f2a1455cda21"}}	t	2026-09-04 17:49:17.626791+00	\N
\.


--
-- Data for Name: organization; Type: TABLE DATA; Schema: public; Owner: notary
--

COPY public.organization (id, name, plan, stripe_customer_id, stripe_subscription_id, clerk_user_id, entitlement_status, track2_enabled, advance_enabled) FROM stdin;
1cde4d65-3d8d-4135-859b-2ec318545a24	Notary (production)	starter	\N	\N	\N	active	f	t
898a0428-7981-49df-be54-f8c25c1c6d13	Notary user user_3Ip9iXL	starter	\N	\N	user_3Ip9iXLPNppPn2iFThzddgn3TYs	active	f	t
\.


--
-- Data for Name: organization_api_key; Type: TABLE DATA; Schema: public; Owner: notary
--

COPY public.organization_api_key (id, organization_id, key_hash, key_prefix, created_at, revoked_at) FROM stdin;
2a78f63c-06eb-4c64-a5de-cb3a147d9835	1cde4d65-3d8d-4135-859b-2ec318545a24	157cb0effcf097d4f7f822d190c19c7b628a0c6d43cc56a3b00306a8ba78d986	nk_live_015f81de	2026-09-01 22:24:06.01745+00	\N
a71f4747-5f0e-42b9-9211-2ccd4da24b3f	898a0428-7981-49df-be54-f8c25c1c6d13	28431774fdd4da0bb9d2b79c0a7c77233b6019e4c528e7a83ca0ff7dbe39e3bd	nk_live_116f3a0f	2026-09-03 15:54:32.377637+00	\N
cbbd4db5-e1f4-4548-a138-bd7d9991a3d3	898a0428-7981-49df-be54-f8c25c1c6d13	0853a8fd30ec2173564e6e89ca2ff5f6ec14e3327d0ea54c26f0b6a2979969c1	nk_live_59345341	2026-09-03 17:17:29.623702+00	\N
4899a238-af29-40c0-ae56-85059282ca9b	898a0428-7981-49df-be54-f8c25c1c6d13	a030c073e3221f11399e5b69333187ad65de9f89b211a3f91e7628757f164ce4	nk_live_97952329	2026-09-03 17:49:29.434522+00	\N
158caef9-8c10-475b-ac62-accef83a6be9	898a0428-7981-49df-be54-f8c25c1c6d13	6291185177cfec41e295e74779c1cce1e17b54c782a656b587c90225c7e14efc	nk_live_eca15e4e	2026-09-03 18:33:25.835918+00	\N
af67749d-e8cf-46e0-a915-bcb4e243fc05	1cde4d65-3d8d-4135-859b-2ec318545a24	ba9aa6033c7f7fa2486b4a28016d5c7ad0116419de1eff59573ccb4dc6a1ef44	nk_live_04e4b01f	2026-09-04 02:55:30.428456+00	\N
71856755-646b-4824-912a-fb7e193059fc	1cde4d65-3d8d-4135-859b-2ec318545a24	0caf265de5a5295c61dd57bb8e027626c244e0c11b96d71df15f5327d4e7e58f	nk_live_bf52dd70	2026-09-04 02:55:48.977667+00	\N
ff3cb67e-a99a-4e38-a46e-30ccdcbccc9c	1cde4d65-3d8d-4135-859b-2ec318545a24	7cb959f0bc0f08a8cd109d1008033afd16d00b159adb209d7e7a7d0a3edfb887	nk_live_2466b194	2026-09-04 04:01:54.545601+00	\N
b0713695-aad8-4d87-976e-81ecdb8c92d4	1cde4d65-3d8d-4135-859b-2ec318545a24	f8826c1e8464ec9bcb2b3bec99df929dbe172ec7bce4f5b7eba3f45e3cb2b27c	nk_live_1c916d82	2026-09-04 04:02:06.692074+00	\N
48f34828-b861-470c-b28d-7847e6a9330f	1cde4d65-3d8d-4135-859b-2ec318545a24	909de32c3bd3f4c9edc9887906ba14647fec2e06fc690524ef13bdd571456c7b	nk_live_1fa4d6b5	2026-09-04 04:09:38.091433+00	\N
0bfbdcc1-9773-4373-91fa-9d6194e91b86	1cde4d65-3d8d-4135-859b-2ec318545a24	bd2c2d8c5b9ace8d6092cd197c8bb4eea9db16f0eb17cefcab360292d56bc101	nk_live_cbb97a99	2026-09-04 15:09:33.452124+00	\N
741612bd-ebbc-4bbb-a52f-230138ab530c	898a0428-7981-49df-be54-f8c25c1c6d13	79ae24d375043a42681bdb1f720ff4915f644e8853b21345325039063885b9d3	nk_live_b36055f7	2026-09-04 15:57:56.374769+00	\N
2459ff03-28ca-479e-a105-534e5a4b6559	1cde4d65-3d8d-4135-859b-2ec318545a24	b3c7f6d5d5a6df5a3c067c74092802b9b09e1173954526d8b0ad9c26a6b6a2b4	nk_live_f9ca4a95	2026-09-04 17:49:03.968306+00	\N
a358c12b-01bf-422b-a6c4-1c55c1d832a2	1cde4d65-3d8d-4135-859b-2ec318545a24	0eae1a3a1d774850ae25d3ceb40bbcbecb354266c75154610c900efe808fbb5f	nk_live_720d8db6	2026-09-04 17:49:14.462762+00	\N
9e5743e6-5a91-4f97-b2ab-a5b36caf88ae	898a0428-7981-49df-be54-f8c25c1c6d13	71a1f8509aef563eec216cb864148428a18676591f85925c68f61039b2460221	nk_live_9e5f87e0	2026-09-04 18:04:33.295493+00	\N
5ef8d88e-f84b-478b-bf80-7d34b43d753d	898a0428-7981-49df-be54-f8c25c1c6d13	30350fc2b970e73305767d3b5a5c922d8c5102509ea754afba58a1d3cd7c0d14	nk_live_75ee1cd6	2026-09-04 18:45:39.2606+00	\N
96bb5504-50af-4ba1-b5d1-45a7fe7dd29b	1cde4d65-3d8d-4135-859b-2ec318545a24	7f58f4cc153a25ad465912999f416897ac0d59040a942939df88a7e1e2c29286	nk_live_942408c4	2026-09-04 19:00:36.778433+00	\N
fe743f39-9eaf-42f9-9fd7-f3e230858cd2	1cde4d65-3d8d-4135-859b-2ec318545a24	ef7e84f374bc97a37475b65642d595d2b60727c5f86327c0cc81ef3d5413e138	nk_live_67adba68	2026-09-04 19:01:13.896547+00	\N
77f51248-c635-4cbd-a3f1-cc2f741008e8	898a0428-7981-49df-be54-f8c25c1c6d13	461031d6982c3f2c70fd9a1bf63fe82f22a07cdf8ae499802f7675f135342655	nk_live_ea91e44a	2026-09-04 19:05:35.312453+00	\N
\.


--
-- Data for Name: review; Type: TABLE DATA; Schema: public; Owner: notary
--

COPY public.review (id, organization_id, idempotency_key, status, created_at, completed_at) FROM stdin;
75d461bc-384d-4cfa-8ec9-c769bb5adf56	1cde4d65-3d8d-4135-859b-2ec318545a24	5e4990af-c9fe-4bf6-8e5e-5d04d24b5994	processing	2026-09-01 23:35:34.585227+00	\N
9bcbaf02-68e4-4879-abf5-fc9719b38e39	1cde4d65-3d8d-4135-859b-2ec318545a24	5b9ee172-acaf-4f44-b2ed-b4ef77212d54	processing	2026-09-01 23:37:03.185+00	\N
f5f37098-227d-42e5-8897-3a4025f5b4e9	1cde4d65-3d8d-4135-859b-2ec318545a24	e172f9ce-e585-4358-b01e-d61bf7cfe3f3	processing	2026-09-01 23:37:33.044034+00	\N
b0b8235e-7b28-4756-8105-7ab58ef833fa	1cde4d65-3d8d-4135-859b-2ec318545a24	c1ea015f-2f45-4e30-84ff-7f4311f2ceea	processing	2026-09-01 23:38:40.065898+00	\N
e0821f22-0347-46fd-a528-24f50d118d13	1cde4d65-3d8d-4135-859b-2ec318545a24	test-1788305954	processing	2026-09-01 23:39:15.222264+00	\N
bac96596-33a1-4855-80d1-1ac40220194f	1cde4d65-3d8d-4135-859b-2ec318545a24	test-modality-1788306134	processing	2026-09-01 23:42:14.580949+00	\N
b2d343d1-5b6a-44b7-8cb7-15afa02394ab	1cde4d65-3d8d-4135-859b-2ec318545a24	test-modality-v3-1788306384	processing	2026-09-01 23:46:24.88393+00	\N
7185a77b-abe3-4d7b-9661-4719b4061b66	1cde4d65-3d8d-4135-859b-2ec318545a24	test-measure-1-1788306420	processing	2026-09-01 23:47:00.313352+00	\N
155aab82-9c02-4d68-80d7-81c126e37287	1cde4d65-3d8d-4135-859b-2ec318545a24	test-measure-2-1788306424	processing	2026-09-01 23:47:04.581193+00	\N
c6be0436-a291-4eaf-9c98-e79aa08b348c	1cde4d65-3d8d-4135-859b-2ec318545a24	test-measure-3-1788306428	processing	2026-09-01 23:47:08.255082+00	\N
e8059a5f-950b-46d3-9736-55c685422afa	1cde4d65-3d8d-4135-859b-2ec318545a24	test-metric-op-1788308232	processing	2026-09-02 00:17:12.987397+00	\N
d9289d77-c1cb-4d9b-9390-ee558b7e5d9a	1cde4d65-3d8d-4135-859b-2ec318545a24	test-wrong-entity-1788308248	processing	2026-09-02 00:17:28.538566+00	\N
2822aea3-d109-41b1-980a-84bcfb15f885	1cde4d65-3d8d-4135-859b-2ec318545a24	test-direction-1788308250	processing	2026-09-02 00:17:30.439662+00	\N
68035d15-9a32-49c1-baf9-23ddf0696fde	1cde4d65-3d8d-4135-859b-2ec318545a24	test-direction-v4-1788308621	processing	2026-09-02 00:23:42.448388+00	\N
360d7382-e950-4bb3-a5aa-107c1a7b7157	1cde4d65-3d8d-4135-859b-2ec318545a24	test-fix-v4-1788308636	processing	2026-09-02 00:23:57.059439+00	\N
3f6de5f2-2821-4b7b-bc0f-8e86e829ab80	1cde4d65-3d8d-4135-859b-2ec318545a24	test-wrongent-v4-1788308638	processing	2026-09-02 00:23:59.381928+00	\N
f2ca7663-8d2a-431d-a67d-30afe5f77b36	1cde4d65-3d8d-4135-859b-2ec318545a24	9545dead-daa4-4432-b162-83a3327c002c	processing	2026-09-02 00:36:57.566728+00	\N
7296fce3-f86c-4be0-98f1-c9e4a9a9032b	1cde4d65-3d8d-4135-859b-2ec318545a24	test-repro-1-1788309458	processing	2026-09-02 00:37:38.557734+00	\N
51437fe3-7560-4865-afde-c5a0f308042f	1cde4d65-3d8d-4135-859b-2ec318545a24	test-repro-2-1788309460	processing	2026-09-02 00:37:40.632331+00	\N
f576fc93-8576-474c-bd81-28d73fe7949c	1cde4d65-3d8d-4135-859b-2ec318545a24	test-repro-3-1788309462	processing	2026-09-02 00:37:42.818986+00	\N
b4966a55-0020-4f79-94b4-8bd049fc9e24	1cde4d65-3d8d-4135-859b-2ec318545a24	566d597d-c787-45bb-a045-75bf188b52af	processing	2026-09-02 00:49:15.182977+00	\N
b722defc-f2d0-42b2-be4e-2419ea25a220	1cde4d65-3d8d-4135-859b-2ec318545a24	edf3b181-9f6b-4f47-93cc-4bb99aa8d0af	processing	2026-09-02 00:53:46.926593+00	\N
e5ff03a0-d51f-4cd1-9720-9d1a266e8dc2	1cde4d65-3d8d-4135-859b-2ec318545a24	1855d2cb-c9a8-418d-921e-f927b6033c62	processing	2026-09-02 01:13:21.492683+00	\N
ca0352bd-a23b-47b1-9fbc-b47eae6bbb44	1cde4d65-3d8d-4135-859b-2ec318545a24	f0817079-98bc-40a0-a94d-8160ab9b1a11	processing	2026-09-02 01:18:48.37451+00	\N
57b9dfe3-2ee8-47b5-8304-de9b74fd674c	1cde4d65-3d8d-4135-859b-2ec318545a24	cafbf326-18a8-4aa9-a464-468bfe661432	processing	2026-09-02 01:25:59.2649+00	\N
398a80ff-8b73-47e1-8789-175947925390	1cde4d65-3d8d-4135-859b-2ec318545a24	5db65efb-f2b8-4bcf-85b6-bfe8531ac39c	processing	2026-09-02 01:41:35.277063+00	\N
49980520-b6df-4446-b572-ae6694225e46	1cde4d65-3d8d-4135-859b-2ec318545a24	b4e971f4-0969-4afd-9a1e-d4c90520d644	processing	2026-09-02 02:30:28.236034+00	\N
af816396-305f-4514-ba7d-17dd7abe1d80	1cde4d65-3d8d-4135-859b-2ec318545a24	test-weather-detail-1788316721	processing	2026-09-02 02:38:41.668614+00	\N
557d2709-a51d-4a23-a09d-476de5de648f	1cde4d65-3d8d-4135-859b-2ec318545a24	02468a0d-6bd3-40bc-85c6-ab2dcaad134f	processing	2026-09-02 15:32:04.16779+00	\N
6f31c5df-8741-4b70-bef2-ebdb14c0f5d8	1cde4d65-3d8d-4135-859b-2ec318545a24	7a4eed2b-4caa-4230-8c2d-78d7a99b65e1	processing	2026-09-02 15:32:31.517424+00	\N
483ac3a9-2e2e-488b-a50d-b8f49c56a51d	1cde4d65-3d8d-4135-859b-2ec318545a24	93ff8d65-a1b4-4f26-8038-ce1693857227	processing	2026-09-02 15:32:42.793739+00	\N
cd0a122c-7aa1-4a6d-bb73-4e3bde864fd8	1cde4d65-3d8d-4135-859b-2ec318545a24	82eed651-c023-41b4-a5c6-2f46765a0d46	processing	2026-09-02 15:32:59.950845+00	\N
a7faef25-a927-4eac-886f-20a65ebc9840	1cde4d65-3d8d-4135-859b-2ec318545a24	0e77c33c-ce74-4117-a785-c1bad8823a16	processing	2026-09-02 15:33:24.920233+00	\N
ff8af00d-4652-4127-909b-22d3a57023c4	1cde4d65-3d8d-4135-859b-2ec318545a24	14f4cebd-f724-4b17-b7f9-a354ed504eb7	processing	2026-09-03 11:04:09.082482+00	\N
f29b7b2f-7ea3-4378-8ecb-75efd89f55d0	1cde4d65-3d8d-4135-859b-2ec318545a24	ea313b42-902e-45ed-bad7-ec77c5ae5da1	processing	2026-09-03 11:04:26.310771+00	\N
3465c010-b3f0-45ee-8bf8-2f31ccc2baf2	1cde4d65-3d8d-4135-859b-2ec318545a24	371b3b1d-8e68-4fb8-964e-d2b8b8b9915a	processing	2026-09-03 11:04:38.673475+00	\N
73f0050e-90bf-4fdf-9ae0-c8eb89f85ae9	1cde4d65-3d8d-4135-859b-2ec318545a24	d1e5a592-b349-4a97-95b3-9ac410213d91	processing	2026-09-03 11:05:25.338672+00	\N
3b754d67-11e1-47fe-99eb-42759ad15654	1cde4d65-3d8d-4135-859b-2ec318545a24	70445b60-5f30-4274-b0f1-d4116a28795c	processing	2026-09-03 13:21:24.328371+00	\N
f0783aee-647c-4c84-a36d-f754ec6873e8	1cde4d65-3d8d-4135-859b-2ec318545a24	02d0066e-330d-41ce-9808-4693fe430153	processing	2026-09-03 13:38:34.747248+00	\N
d5968b32-9703-49e8-9642-7692312beeea	1cde4d65-3d8d-4135-859b-2ec318545a24	f5279518-db02-48d3-b98c-3b2cbbb5efd4	processing	2026-09-03 13:39:55.744978+00	\N
2edd9b66-46da-477e-8958-b17b3dcc0f5d	1cde4d65-3d8d-4135-859b-2ec318545a24	e79995db-8828-4f8a-8425-f242b6e0c67a	processing	2026-09-03 13:40:09.403269+00	\N
27aee64d-3c41-4b07-a330-1932b7f2acfc	1cde4d65-3d8d-4135-859b-2ec318545a24	380c7ae9-8129-46ce-b767-fc2d19781b61	processing	2026-09-03 13:40:16.699253+00	\N
5d6b5b15-c4da-461e-b3ac-c702a82b6831	1cde4d65-3d8d-4135-859b-2ec318545a24	8eba58da-047a-4677-8faf-9d7bd56d264a	processing	2026-09-03 13:40:23.609409+00	\N
5758bfa1-c74b-480a-873f-42bd3f8e53f7	1cde4d65-3d8d-4135-859b-2ec318545a24	5e56d471-76ce-4503-8a42-15c081fc64ca	processing	2026-09-03 13:40:31.452948+00	\N
d37c344a-7dcd-4d69-b0d7-eebd55bd6a49	1cde4d65-3d8d-4135-859b-2ec318545a24	ddd06e6e-2367-4ebb-b137-89a8ffd3b3ea	processing	2026-09-03 13:41:30.597985+00	\N
a16a600d-f76b-4a20-bab3-e91db60ff4e3	1cde4d65-3d8d-4135-859b-2ec318545a24	43f289a2-8a4b-499a-9e97-a2a8f025e43b	processing	2026-09-03 13:41:39.26889+00	\N
1cdbec9f-2717-4d8b-bd33-35d9b5b01f5f	1cde4d65-3d8d-4135-859b-2ec318545a24	959744ff-40e9-4417-b420-4f9baac9b6b2	processing	2026-09-03 13:41:47.07203+00	\N
39576b36-9750-476c-80f7-c18eba56f664	1cde4d65-3d8d-4135-859b-2ec318545a24	8e87a7c6-979e-4f8f-9b6b-7bbed19a2939	processing	2026-09-03 13:41:53.605008+00	\N
8ba60294-2767-44f0-abe5-b776d72ec30a	1cde4d65-3d8d-4135-859b-2ec318545a24	76f8644c-1c6d-4762-a37e-81930424d3de	processing	2026-09-03 13:42:02.1769+00	\N
6ad02183-7e15-411a-b620-14fbff5f44a6	1cde4d65-3d8d-4135-859b-2ec318545a24	206695c1-6866-49a7-827b-40b9a72df2ce	processing	2026-09-03 13:50:19.986316+00	\N
ad537204-9bae-4c19-8f60-bb13ef1ea37e	1cde4d65-3d8d-4135-859b-2ec318545a24	4a3781d7-351e-49cb-8041-a3921a775a67	processing	2026-09-03 13:50:30.664104+00	\N
a3409dfe-acfc-41b2-b3d8-c36123e29f1b	1cde4d65-3d8d-4135-859b-2ec318545a24	2cec7d0f-5461-467e-b531-e21be468a190	processing	2026-09-03 13:56:17.700261+00	\N
c578936f-b348-466b-bc53-79ed7bfdcb4d	1cde4d65-3d8d-4135-859b-2ec318545a24	2ea5ac49-6d4f-47ab-9f3e-534f7951a8c5	processing	2026-09-03 13:56:29.41472+00	\N
4a216943-a359-44a8-88a2-77a781c24905	1cde4d65-3d8d-4135-859b-2ec318545a24	72fc28c5-736b-469a-9b08-676a66659289	processing	2026-09-03 13:56:36.410666+00	\N
516effa8-143c-43c9-ba3d-0f1fa17514b4	1cde4d65-3d8d-4135-859b-2ec318545a24	3ee1c39c-94d3-4d46-835a-6265e69dfe53	processing	2026-09-03 13:56:46.593295+00	\N
8c12741e-8c1e-4d4b-b18b-b2c553bfefbb	1cde4d65-3d8d-4135-859b-2ec318545a24	988fe3b4-acdd-4127-be89-a042bf80ec00	processing	2026-09-03 13:56:53.606597+00	\N
911421e1-cb73-4d8f-ae81-9861f98fa0b5	1cde4d65-3d8d-4135-859b-2ec318545a24	4cb11acc-bda5-4d61-819b-278bf279a9e4	processing	2026-09-03 13:57:04.084298+00	\N
5fd822c4-16de-45f5-8877-3c57de2b837f	1cde4d65-3d8d-4135-859b-2ec318545a24	deploy-smoke-test-1	processing	2026-09-03 15:16:57.950439+00	\N
5b540531-b318-4747-8bfe-190077d3b34d	898a0428-7981-49df-be54-f8c25c1c6d13	5ea55fca-4827-481c-8630-8b0a3f38bf97	processing	2026-09-03 15:54:35.117264+00	\N
69afb86d-1071-4543-b11e-d68697e6f68d	1cde4d65-3d8d-4135-859b-2ec318545a24	repro-track2-test-2	processing	2026-09-03 16:00:52.483755+00	\N
a38c7b56-e320-4285-a84c-109fed6c29f4	898a0428-7981-49df-be54-f8c25c1c6d13	3a4fefe4-2f68-46b8-ae15-da22c12412a2	processing	2026-09-03 16:02:43.413296+00	\N
62f76753-10b4-4f58-a637-423dd2a28721	898a0428-7981-49df-be54-f8c25c1c6d13	47bdde70-3cec-40ae-99c1-0720caaf5bea	processing	2026-09-03 16:03:35.252594+00	\N
4d2dfcff-105d-4d3a-ad02-47bbdca1f3d9	898a0428-7981-49df-be54-f8c25c1c6d13	08da0e41-c0a9-4f90-b1e2-ee2142b2c591	processing	2026-09-03 17:20:34.379336+00	\N
e8a8a00f-698c-4b17-8341-4fe8055d023e	898a0428-7981-49df-be54-f8c25c1c6d13	dd48ff7d-5b7c-4cf0-a268-1904996c79da	processing	2026-09-03 17:25:18.829544+00	\N
e56ac6de-048c-4b5b-8fb4-28b5293295f9	898a0428-7981-49df-be54-f8c25c1c6d13	68bac2d1-cfd1-4794-80f6-c9af9734d198	processing	2026-09-03 17:25:28.101431+00	\N
8ab16362-fc81-4096-8a32-b92917a4e5f9	898a0428-7981-49df-be54-f8c25c1c6d13	27a0098a-f6dd-47bd-8daf-4d9103c16993	processing	2026-09-03 17:25:35.716519+00	\N
7ebc7f60-be1c-4a63-9d9d-7dce632bf049	898a0428-7981-49df-be54-f8c25c1c6d13	74f3394d-eb49-4842-a991-1bbf49e5471e	processing	2026-09-03 17:25:52.771114+00	\N
cc974c09-131a-452b-9faf-36683f71c3cc	898a0428-7981-49df-be54-f8c25c1c6d13	a2bf4b2e-b864-462e-b37c-ed6946900829	processing	2026-09-03 17:26:22.433049+00	\N
742c88de-a16f-4eed-9301-be5b8a3d800f	898a0428-7981-49df-be54-f8c25c1c6d13	20ac5b24-185f-47d9-9db2-2921c8c82c3c	processing	2026-09-03 17:27:10.22668+00	\N
3c6adbec-a8f8-4848-b373-745a41d4b0f4	898a0428-7981-49df-be54-f8c25c1c6d13	7fec9333-987b-419c-9fca-cf4a18f8ad52	processing	2026-09-03 17:27:36.737221+00	\N
f04116ec-3343-4814-ba2c-6476774a08fc	898a0428-7981-49df-be54-f8c25c1c6d13	24ce3e1b-31d3-40c3-960a-51c30ece8406	processing	2026-09-03 17:49:31.937598+00	\N
857f6530-de07-414e-9db6-e90c5c8288a0	898a0428-7981-49df-be54-f8c25c1c6d13	0f33a0a6-fff7-4ed1-b557-5e9eb5112699	processing	2026-09-03 17:49:43.540446+00	\N
8425c356-9eba-40d1-9ec5-71a023eb2774	898a0428-7981-49df-be54-f8c25c1c6d13	7d3411ea-2288-4fd6-8bec-f3e80dfffdf4	processing	2026-09-03 18:33:28.41366+00	\N
00b5c1d5-7be1-434b-a664-c520a613d4ee	898a0428-7981-49df-be54-f8c25c1c6d13	816dc44b-fee5-4003-9f5f-ebd404ad766d	processing	2026-09-03 18:33:40.685762+00	\N
1d0d85e9-64eb-4398-9392-1a7fb515c872	898a0428-7981-49df-be54-f8c25c1c6d13	07481722-82b2-482b-a9a9-b4e2111c8677	processing	2026-09-03 18:47:56.285976+00	\N
b0cf4531-7c84-48c9-b9b9-1504b083c0d9	1cde4d65-3d8d-4135-859b-2ec318545a24	smoke-1788490548887	processing	2026-09-04 02:55:49.126965+00	\N
fb321bdb-902b-438e-8f47-c751f7c738e5	1cde4d65-3d8d-4135-859b-2ec318545a24	smoke-1788494514519	processing	2026-09-04 04:01:54.853935+00	\N
9d610dc7-f5b3-473a-aae3-a02704a59380	1cde4d65-3d8d-4135-859b-2ec318545a24	smoke-1788494526667	processing	2026-09-04 04:02:06.874573+00	\N
e092ccc9-1b78-4919-a53e-012e70047461	1cde4d65-3d8d-4135-859b-2ec318545a24	smoke-1788494978071	processing	2026-09-04 04:09:38.436691+00	\N
e1f6dcf9-bcaa-47ed-a795-8940b177edf0	1cde4d65-3d8d-4135-859b-2ec318545a24	detect-1788534573402	processing	2026-09-04 15:09:33.770287+00	\N
76138ddc-9042-469b-a1c7-0cc6df02db33	898a0428-7981-49df-be54-f8c25c1c6d13	ab3b0d5a-1c8f-42bc-80ec-91a771dc9bbf	processing	2026-09-04 15:57:58.627799+00	\N
6b4ed876-9a9a-4402-850d-d5d7d86a0efd	898a0428-7981-49df-be54-f8c25c1c6d13	c2f66f7f-1498-486d-9de3-9ef1abdb2721	processing	2026-09-04 16:00:54.47151+00	\N
7f1e488f-0ec4-488a-941e-69d00e9ede2c	1cde4d65-3d8d-4135-859b-2ec318545a24	detect-1788544143916	processing	2026-09-04 17:49:04.270921+00	\N
4a63340c-886d-4a54-8b0c-bb3062ce342f	1cde4d65-3d8d-4135-859b-2ec318545a24	smoke-1788544154410	processing	2026-09-04 17:49:14.640134+00	\N
c5ff95ef-71b8-4263-a9e6-75030bbb18de	898a0428-7981-49df-be54-f8c25c1c6d13	56def0ec-2e89-49b2-bdc5-02e650dec21b	processing	2026-09-04 18:04:41.185504+00	\N
116aa8c7-287a-4eab-a9c7-c43ec2b30344	898a0428-7981-49df-be54-f8c25c1c6d13	8eaf9ace-d3cd-468f-9544-f5d0f98fb752	processing	2026-09-04 18:45:48.004154+00	\N
cd93f5f8-90f9-4ead-8fc0-3363534f0e99	1cde4d65-3d8d-4135-859b-2ec318545a24	detect-1788548436777	processing	2026-09-04 19:00:37.232989+00	\N
c1307978-64f7-470e-a866-2011b489b7d2	1cde4d65-3d8d-4135-859b-2ec318545a24	detect-1788548473904	processing	2026-09-04 19:01:14.140314+00	\N
c7605ba0-45de-4a2c-991c-4566ece9fc38	898a0428-7981-49df-be54-f8c25c1c6d13	c0737d1d-897e-41df-9c7b-ad7698ac83d6	processing	2026-09-04 19:05:45.059792+00	\N
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: notary
--

COPY public.schema_migrations (version, applied_at) FROM stdin;
0001_initial_schema.sql	2026-09-01 21:26:12.158908+00
0002_seed_dev.sql	2026-09-01 21:26:12.363987+00
0003_claims_and_matches.sql	2026-09-01 21:26:12.537144+00
0004_auth_usage.sql	2026-09-01 21:26:12.813224+00
0005_billing.sql	2026-09-01 21:26:13.017888+00
0006_review_orchestrator.sql	2026-09-01 21:26:13.207891+00
0007_clerk_organization_link.sql	2026-09-03 15:03:39.671031+00
0008_dashboard_reads.sql	2026-09-03 15:03:39.832699+00
0009_waitlist.sql	2026-09-03 15:03:39.99863+00
0010_entitlement.sql	2026-09-03 15:03:40.163859+00
0011_locators_lifecycle_revocation.sql	2026-09-03 15:03:40.315236+00
0012_track2_challenge.sql	2026-09-03 15:03:40.474695+00
0013_advance.sql	2026-09-03 15:03:40.640089+00
0014_advance_flag.sql	2026-09-04 02:45:58.240322+00
0015_cost_millicents.sql	2026-09-04 02:45:58.348074+00
\.


--
-- Data for Name: usage_event; Type: TABLE DATA; Schema: public; Owner: notary
--

COPY public.usage_event (id, organization_id, user_id, review_id, event_type, input_tokens, output_tokens, fetch_bytes, created_at, estimated_cost_millicents) FROM stdin;
79a97d81-246b-4109-b8b6-6f50b339eed0	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	9bcbaf02-68e4-4879-abf5-fc9719b38e39	judge_call	966	150	0	2026-09-01 23:37:06.122748+00	0
68fa5048-81ab-46fd-8693-0349517d293c	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	9bcbaf02-68e4-4879-abf5-fc9719b38e39	judge_call	952	122	0	2026-09-01 23:37:08.578799+00	0
2f5cb53f-2321-4e91-bc34-a6d99b8eba06	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	9bcbaf02-68e4-4879-abf5-fc9719b38e39	judge_call	935	105	0	2026-09-01 23:37:11.048428+00	0
af74b7ca-a0e6-435b-8ed6-3ea6bd8879cc	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	9bcbaf02-68e4-4879-abf5-fc9719b38e39	judge_call	972	111	0	2026-09-01 23:37:12.793683+00	0
72b29b67-6365-4aa5-ad0d-296bdd376651	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	f5f37098-227d-42e5-8897-3a4025f5b4e9	judge_call	968	150	0	2026-09-01 23:37:35.73248+00	0
6cf8bf9c-8900-453b-af51-9822b26759bf	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	f5f37098-227d-42e5-8897-3a4025f5b4e9	judge_call	952	117	0	2026-09-01 23:37:38.078949+00	0
f08bd9da-2c14-41c4-ab24-4f583c82e4e9	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	f5f37098-227d-42e5-8897-3a4025f5b4e9	judge_call	933	104	0	2026-09-01 23:37:40.437424+00	0
97541347-5644-4f3d-922b-4def9ac005d9	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	f5f37098-227d-42e5-8897-3a4025f5b4e9	judge_call	958	102	0	2026-09-01 23:37:42.511675+00	0
bd6bfc93-cc37-400b-b263-b04d46316328	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	f5f37098-227d-42e5-8897-3a4025f5b4e9	judge_call	968	54	0	2026-09-01 23:37:44.53952+00	0
c9791035-1749-4d80-8e03-f6bde226f482	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	b0b8235e-7b28-4756-8105-7ab58ef833fa	judge_call	968	139	0	2026-09-01 23:38:42.181268+00	0
2bedad92-1b2a-456c-9135-87e8c2d4fe7c	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	b0b8235e-7b28-4756-8105-7ab58ef833fa	judge_call	950	94	0	2026-09-01 23:38:43.907657+00	0
b9ddd9ff-2800-4132-a2d5-a6ab164db9da	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	b0b8235e-7b28-4756-8105-7ab58ef833fa	judge_call	935	82	0	2026-09-01 23:38:46.009157+00	0
5e4de6ac-ba9b-46ce-bfcc-7c5c68cdf579	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	b0b8235e-7b28-4756-8105-7ab58ef833fa	judge_call	960	114	0	2026-09-01 23:38:48.107983+00	0
911213cf-7506-47c5-93f7-1c5e6be4d596	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	b0b8235e-7b28-4756-8105-7ab58ef833fa	judge_call	968	108	0	2026-09-01 23:38:49.295001+00	0
d2c6b493-0226-4788-b021-c71c2702c520	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	e0821f22-0347-46fd-a528-24f50d118d13	judge_call	917	131	0	2026-09-01 23:39:19.104923+00	0
3c2ce867-4e8b-4881-9406-a09e0ba99cd4	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	e0821f22-0347-46fd-a528-24f50d118d13	judge_call	944	166	0	2026-09-01 23:39:21.299891+00	0
37d36ddd-49a6-4eb7-b003-ab392d66b15e	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	bac96596-33a1-4855-80d1-1ac40220194f	judge_call	917	131	0	2026-09-01 23:42:16.780132+00	0
d876dd54-76e2-4646-b749-ef36302161be	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	bac96596-33a1-4855-80d1-1ac40220194f	judge_call	950	161	0	2026-09-01 23:42:18.617616+00	0
f8ed1ccb-7675-4d58-b191-386f9368783c	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	b2d343d1-5b6a-44b7-8cb7-15afa02394ab	judge_call	921	120	0	2026-09-01 23:46:27.836942+00	0
a208c5a2-5056-4a9f-af35-00a39e440f95	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	b2d343d1-5b6a-44b7-8cb7-15afa02394ab	judge_call	1028	159	0	2026-09-01 23:46:29.716551+00	0
364b35ad-52a1-4a63-bd6b-26a9be1f3eb9	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	7185a77b-abe3-4d7b-9661-4719b4061b66	judge_call	917	132	0	2026-09-01 23:47:02.149796+00	0
0c7e5d4d-1812-4c7e-965e-f645a648ef52	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	7185a77b-abe3-4d7b-9661-4719b4061b66	judge_call	1032	165	0	2026-09-01 23:47:04.374684+00	0
19d972de-21d4-4019-bf0c-86728ce6cdd5	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	155aab82-9c02-4d68-80d7-81c126e37287	judge_call	923	127	0	2026-09-01 23:47:06.440813+00	0
accc9de4-f73f-4457-bcee-ea7e49806785	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	155aab82-9c02-4d68-80d7-81c126e37287	judge_call	1032	161	0	2026-09-01 23:47:08.050789+00	0
5aca8044-8b53-4230-a3ef-d79cbc01f928	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	c6be0436-a291-4eaf-9c98-e79aa08b348c	judge_call	917	138	0	2026-09-01 23:47:10.39971+00	0
53bea259-a829-45ca-9c32-6ac5d4631bfe	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	c6be0436-a291-4eaf-9c98-e79aa08b348c	judge_call	1032	161	0	2026-09-01 23:47:11.968165+00	0
ae0bb0d5-e9a2-4751-a554-9e83f3bf23b6	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	e8059a5f-950b-46d3-9736-55c685422afa	judge_call	1032	149	0	2026-09-02 00:17:15.022383+00	0
84a40ca3-d42c-4199-b6a2-0dfb4384c42e	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	d9289d77-c1cb-4d9b-9390-ee558b7e5d9a	judge_call	952	123	0	2026-09-02 00:17:30.182861+00	0
89e29a99-a77c-409d-8378-fe0c5faebf4e	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	68035d15-9a32-49c1-baf9-23ddf0696fde	judge_call	1077	103	0	2026-09-02 00:23:44.287162+00	0
57f46163-fe7c-4f8d-a800-b7da493f8e56	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	360d7382-e950-4bb3-a5aa-107c1a7b7157	judge_call	1074	125	0	2026-09-02 00:23:59.085006+00	0
a02f6cd6-1cd9-4b42-84b4-9552006ebb4a	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	3f6de5f2-2821-4b7b-bc0f-8e86e829ab80	judge_call	956	139	0	2026-09-02 00:24:01.305298+00	0
01c9d2fb-c0f5-49d5-a4aa-872133fbe90c	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	3f6de5f2-2821-4b7b-bc0f-8e86e829ab80	judge_call	1072	87	0	2026-09-02 00:24:02.668567+00	0
b8d24691-2d60-4bae-a075-859067d8702a	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	f2ca7663-8d2a-431d-a67d-30afe5f77b36	judge_call	972	102	0	2026-09-02 00:36:59.125585+00	0
9935d700-e8d4-46b3-addb-066eaac26dcf	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	f2ca7663-8d2a-431d-a67d-30afe5f77b36	judge_call	952	123	0	2026-09-02 00:37:00.689096+00	0
802dd085-c9c5-4437-b21a-020443682179	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	f2ca7663-8d2a-431d-a67d-30afe5f77b36	judge_call	950	71	0	2026-09-02 00:37:01.807696+00	0
3ad10abf-d290-4fa7-89f3-b15b0330be92	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	f2ca7663-8d2a-431d-a67d-30afe5f77b36	judge_call	1088	92	0	2026-09-02 00:37:03.39647+00	0
76e5930a-5e23-405a-b156-045a87b5b527	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	f2ca7663-8d2a-431d-a67d-30afe5f77b36	judge_call	970	76	0	2026-09-02 00:37:04.53904+00	0
9ca88a65-4d87-4cb9-ae1d-2fab645ea28f	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	7296fce3-f86c-4be0-98f1-c9e4a9a9032b	judge_call	1078	128	0	2026-09-02 00:37:40.219045+00	0
a47353ba-7846-4ecf-993e-7fad4a3c398d	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	51437fe3-7560-4865-afde-c5a0f308042f	judge_call	1078	109	0	2026-09-02 00:37:42.538029+00	0
102e4227-756f-4ec5-9934-a459b407a065	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	f576fc93-8576-474c-bd81-28d73fe7949c	judge_call	1080	109	0	2026-09-02 00:37:44.566631+00	0
7625458f-5337-44ca-ba8e-a3810266c6ee	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	b4966a55-0020-4f79-94b4-8bd049fc9e24	judge_call	1074	111	0	2026-09-02 00:49:16.692582+00	0
d12d6ece-bf32-4558-a0ca-87b425117ebd	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	b722defc-f2d0-42b2-be4e-2419ea25a220	judge_call	1074	109	0	2026-09-02 00:53:48.505483+00	0
2ea1cd4d-e027-4753-9fb7-4751d23c82b9	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	e5ff03a0-d51f-4cd1-9720-9d1a266e8dc2	judge_call	1080	118	0	2026-09-02 01:13:23.067606+00	0
2898f7f0-c379-44ca-a8cf-28b69d31788b	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	ca0352bd-a23b-47b1-9fbc-b47eae6bbb44	judge_call	1080	137	0	2026-09-02 01:18:49.935868+00	0
359fd69b-7ce6-4cf8-b9da-a9d972f6ec0e	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	57b9dfe3-2ee8-47b5-8304-de9b74fd674c	judge_call	969	168	0	2026-09-02 01:26:01.119297+00	0
0cc5711f-7cd4-41ff-9b51-b9621af06c25	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	57b9dfe3-2ee8-47b5-8304-de9b74fd674c	judge_call	951	202	0	2026-09-02 01:26:03.290718+00	0
e32ffb35-3f17-46da-8279-2e3a9406888e	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	57b9dfe3-2ee8-47b5-8304-de9b74fd674c	judge_call	940	165	0	2026-09-02 01:26:05.059289+00	0
c81511e2-8c28-4c9d-b5b8-9bcaf3dc0cf6	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	57b9dfe3-2ee8-47b5-8304-de9b74fd674c	judge_call	963	119	0	2026-09-02 01:26:06.503515+00	0
7fee80a6-c84c-4a05-b36a-94c21881adf7	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	398a80ff-8b73-47e1-8789-175947925390	judge_call	945	167	0	2026-09-02 01:41:37.340847+00	0
fd65cb5a-2bfe-4770-8f8d-0827d7d92352	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	398a80ff-8b73-47e1-8789-175947925390	judge_call	943	220	0	2026-09-02 01:41:39.935328+00	0
2fda53f0-d9e5-4448-a859-fee3d68fd299	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	398a80ff-8b73-47e1-8789-175947925390	judge_call	953	100	0	2026-09-02 01:41:41.402837+00	0
cb304373-d51e-45b7-8703-c8d355a8080b	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	49980520-b6df-4446-b572-ae6694225e46	judge_call	961	148	0	2026-09-02 02:30:30.251661+00	0
41ddbc99-0100-4789-bab6-5bb0874f3e1d	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	49980520-b6df-4446-b572-ae6694225e46	judge_call	949	149	0	2026-09-02 02:30:32.202275+00	0
9b2c4c91-e4be-411c-bf62-a135695e732a	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	49980520-b6df-4446-b572-ae6694225e46	judge_call	969	167	0	2026-09-02 02:30:34.338683+00	0
60574afc-0a75-4411-b2e9-a0ac1efcee60	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	af816396-305f-4514-ba7d-17dd7abe1d80	judge_call	950	150	0	2026-09-02 02:38:46.643453+00	0
dd3032ec-1681-4342-a72f-01f9ec725d7e	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	af816396-305f-4514-ba7d-17dd7abe1d80	judge_call	968	165	0	2026-09-02 02:38:48.627222+00	0
6b8f0533-4a9c-4d94-a525-1b5e2a87cc7d	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	557d2709-a51d-4a23-a09d-476de5de648f	judge_call	962	132	0	2026-09-02 15:32:05.803455+00	0
d8a976fa-e9a6-46cf-b079-fdd70993b249	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	557d2709-a51d-4a23-a09d-476de5de648f	judge_call	948	123	0	2026-09-02 15:32:07.135827+00	0
d4a46c05-f3bf-4dbc-9638-ea11f594ddfa	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	557d2709-a51d-4a23-a09d-476de5de648f	judge_call	1040	178	0	2026-09-02 15:32:09.066488+00	0
6f0fd96b-f62e-48ea-9663-21789c02936b	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	557d2709-a51d-4a23-a09d-476de5de648f	judge_call	966	170	0	2026-09-02 15:32:11.022104+00	0
d89533b5-0637-4ba4-bdc3-6da3ed7bcce8	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	6f31c5df-8741-4b70-bef2-ebdb14c0f5d8	judge_call	1080	89	0	2026-09-02 15:32:32.913592+00	0
11690a50-e2bd-4d5d-a6cc-cff222fd271a	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	483ac3a9-2e2e-488b-a50d-b8f49c56a51d	judge_call	960	127	0	2026-09-02 15:32:44.303503+00	0
69077f20-f616-4697-a8eb-7700d79f72d2	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	483ac3a9-2e2e-488b-a50d-b8f49c56a51d	judge_call	940	112	0	2026-09-02 15:32:45.916999+00	0
36ac6409-1e95-4fa9-bb92-38a46d3dd340	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	cd0a122c-7aa1-4a6d-bb73-4e3bde864fd8	judge_call	946	111	0	2026-09-02 15:33:01.430662+00	0
3306d74f-e1cb-40bd-8aa5-ae54171638f1	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	cd0a122c-7aa1-4a6d-bb73-4e3bde864fd8	judge_call	1078	102	0	2026-09-02 15:33:02.837331+00	0
c068d87b-b7f1-4860-9ec3-830b02816a3c	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	cd0a122c-7aa1-4a6d-bb73-4e3bde864fd8	judge_call	958	133	0	2026-09-02 15:33:04.222235+00	0
0a96d481-9ae6-45a0-85ba-6d7e5ad0dba9	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	a7faef25-a927-4eac-886f-20a65ebc9840	judge_call	1080	89	0	2026-09-02 15:33:26.277065+00	0
0cc0faeb-a2a4-469c-be48-51aa0fbef498	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	a7faef25-a927-4eac-886f-20a65ebc9840	judge_call	1032	149	0	2026-09-02 15:33:27.668489+00	0
1de7cf96-0245-4dbb-9425-f84fbc97e731	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	a7faef25-a927-4eac-886f-20a65ebc9840	judge_call	960	101	0	2026-09-02 15:33:29.238671+00	0
dc520e71-ada9-46c4-83aa-bdfddbe11af0	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	ff8af00d-4652-4127-909b-22d3a57023c4	judge_call	958	153	0	2026-09-03 11:04:10.652878+00	0
68701454-be54-4dc0-bcdc-f79c82437410	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	ff8af00d-4652-4127-909b-22d3a57023c4	judge_call	942	111	0	2026-09-03 11:04:11.989449+00	0
8a7c24eb-e513-4685-90f3-bd903b2c3991	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	ff8af00d-4652-4127-909b-22d3a57023c4	judge_call	948	141	0	2026-09-03 11:04:13.615719+00	0
efc6195b-115b-4f72-becc-46b121762dda	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	ff8af00d-4652-4127-909b-22d3a57023c4	judge_call	1082	118	0	2026-09-03 11:04:14.934868+00	0
10bf8c99-840c-45c4-969c-f789eb0d0d12	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	ff8af00d-4652-4127-909b-22d3a57023c4	judge_call	946	134	0	2026-09-03 11:04:16.330419+00	0
e0f1f6c2-4a47-4f71-bb20-ed992c89cc20	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	ff8af00d-4652-4127-909b-22d3a57023c4	judge_call	1084	145	0	2026-09-03 11:04:17.906652+00	0
686a4ad7-89d9-4552-8faa-27fe99eb0bd7	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	f29b7b2f-7ea3-4378-8ecb-75efd89f55d0	judge_call	952	84	0	2026-09-03 11:04:27.647192+00	0
f88d694e-d23a-47eb-ae4e-8c91f0802b6e	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	f29b7b2f-7ea3-4378-8ecb-75efd89f55d0	judge_call	940	141	0	2026-09-03 11:04:29.020023+00	0
d0b13e38-f9b6-4f18-a9ff-1acea6e53532	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	f29b7b2f-7ea3-4378-8ecb-75efd89f55d0	judge_call	956	120	0	2026-09-03 11:04:30.389288+00	0
3aba1c96-d87c-42eb-aa92-61253a75f0b1	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	f29b7b2f-7ea3-4378-8ecb-75efd89f55d0	judge_call	954	103	0	2026-09-03 11:04:31.645323+00	0
3b6ada02-1bc4-4d92-9a14-baeb12fa1324	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	f29b7b2f-7ea3-4378-8ecb-75efd89f55d0	judge_call	940	104	0	2026-09-03 11:04:32.711578+00	0
3e369a19-52fc-40cf-9ef9-16f32a3f53cc	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	73f0050e-90bf-4fdf-9ae0-c8eb89f85ae9	judge_call	952	119	0	2026-09-03 11:05:26.900909+00	0
e8b7ca9b-7850-4852-baf3-ed860f942252	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	73f0050e-90bf-4fdf-9ae0-c8eb89f85ae9	judge_call	942	104	0	2026-09-03 11:05:27.947334+00	0
ddbf3c0a-069e-4beb-ad63-e23ff7571ef0	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	73f0050e-90bf-4fdf-9ae0-c8eb89f85ae9	judge_call	956	116	0	2026-09-03 11:05:29.532285+00	0
de343bc4-da2a-4c39-af2a-e8a01918f191	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	73f0050e-90bf-4fdf-9ae0-c8eb89f85ae9	judge_call	956	123	0	2026-09-03 11:05:30.986689+00	0
6cdde9dc-4d27-4918-bf0a-d2b1a4ef52cc	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	73f0050e-90bf-4fdf-9ae0-c8eb89f85ae9	judge_call	938	121	0	2026-09-03 11:05:32.186424+00	0
f7884e50-b0b3-48ca-adbf-821b887bcaee	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	3b754d67-11e1-47fe-99eb-42759ad15654	judge_call	967	157	0	2026-09-03 13:21:25.994923+00	0
813898c0-c33c-4652-9d42-38b88c2f1a34	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	3b754d67-11e1-47fe-99eb-42759ad15654	judge_call	1057	196	0	2026-09-03 13:21:27.718546+00	0
f6aa210e-b8bb-4fd3-9a0a-3cad8ab7ced5	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	f0783aee-647c-4c84-a36d-f754ec6873e8	judge_call	948	167	0	2026-09-03 13:38:36.533155+00	0
a14b3ece-b120-441f-9999-6b8bf1ab4ce3	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	f0783aee-647c-4c84-a36d-f754ec6873e8	judge_call	1042	187	0	2026-09-03 13:38:38.139051+00	0
da1eae30-bb04-4a44-80eb-785c2e8a8b8b	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	d5968b32-9703-49e8-9642-7692312beeea	judge_call	962	160	0	2026-09-03 13:39:57.27703+00	0
cd644102-479f-47cf-b1f4-8e2d5188e4fa	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	d5968b32-9703-49e8-9642-7692312beeea	judge_call	942	168	0	2026-09-03 13:39:58.949116+00	0
8a8a523e-99a3-4812-b276-c87b006c6e78	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	d5968b32-9703-49e8-9642-7692312beeea	judge_call	958	171	0	2026-09-03 13:40:00.577145+00	0
ac474e69-5f8d-4421-bad1-d257814cad6e	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	2edd9b66-46da-477e-8958-b17b3dcc0f5d	judge_call	960	130	0	2026-09-03 13:40:10.736026+00	0
4cc841da-e5ae-41e4-8b6a-a7a750d494e1	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	27aee64d-3c41-4b07-a330-1932b7f2acfc	judge_call	952	98	0	2026-09-03 13:40:17.772302+00	0
a4636898-ae94-4c7f-8663-085120f04800	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	27aee64d-3c41-4b07-a330-1932b7f2acfc	judge_call	956	107	0	2026-09-03 13:40:18.903487+00	0
285d9fda-58b9-409b-9abe-86bd43b8cb6e	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	5d6b5b15-c4da-461e-b3ac-c702a82b6831	judge_call	940	99	0	2026-09-03 13:40:24.842529+00	0
5c85267b-8505-4f55-98ea-a21fe0b874d1	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	5d6b5b15-c4da-461e-b3ac-c702a82b6831	judge_call	950	97	0	2026-09-03 13:40:25.939554+00	0
cb65608b-abc5-46aa-904b-735dd7570de4	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	5758bfa1-c74b-480a-873f-42bd3f8e53f7	judge_call	940	117	0	2026-09-03 13:40:32.824046+00	0
7bd1fb8d-fdb1-4f8a-94a7-28f3990ee7e5	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	5758bfa1-c74b-480a-873f-42bd3f8e53f7	judge_call	962	153	0	2026-09-03 13:40:34.263662+00	0
13c8df50-10a7-444a-96ad-ad660e94ab95	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	d37c344a-7dcd-4d69-b0d7-eebd55bd6a49	judge_call	946	116	0	2026-09-03 13:41:31.971765+00	0
28e883bb-1277-4ca0-9f56-d3b779e924f3	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	d37c344a-7dcd-4d69-b0d7-eebd55bd6a49	judge_call	962	164	0	2026-09-03 13:41:33.704532+00	0
a174a4d6-1106-4a87-b694-27f626f158e6	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	a16a600d-f76b-4a20-bab3-e91db60ff4e3	judge_call	962	103	0	2026-09-03 13:41:40.817224+00	0
59c21620-c427-4253-bf0c-9990c415a541	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	a16a600d-f76b-4a20-bab3-e91db60ff4e3	judge_call	960	132	0	2026-09-03 13:41:42.096414+00	0
5e2f830a-0234-4d5b-9b69-f17d4827fa5c	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	1cdbec9f-2717-4d8b-bd33-35d9b5b01f5f	judge_call	956	123	0	2026-09-03 13:41:48.443741+00	0
550047e4-4db9-429f-af54-f27b653b04e4	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	39576b36-9750-476c-80f7-c18eba56f664	judge_call	944	138	0	2026-09-03 13:41:55.196582+00	0
bde9ea9d-023b-477b-b085-2cac1a1887c1	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	39576b36-9750-476c-80f7-c18eba56f664	judge_call	956	113	0	2026-09-03 13:41:56.817435+00	0
635ca706-a592-4219-bd09-2eaf91c872ff	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	8ba60294-2767-44f0-abe5-b776d72ec30a	judge_call	940	109	0	2026-09-03 13:42:03.575495+00	0
c6699788-3c35-4197-bd25-5ac95d524dca	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	6ad02183-7e15-411a-b620-14fbff5f44a6	judge_call	963	158	0	2026-09-03 13:50:21.575911+00	0
0b8ce3ed-a830-4fca-a24f-388785857000	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	6ad02183-7e15-411a-b620-14fbff5f44a6	judge_call	947	150	0	2026-09-03 13:50:23.371459+00	0
5d5a80d3-b7a3-415f-abde-b173e427c0af	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	6ad02183-7e15-411a-b620-14fbff5f44a6	judge_call	967	143	0	2026-09-03 13:50:24.756835+00	0
22e70540-ae36-4d9c-8248-da4831b0eed0	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	ad537204-9bae-4c19-8f60-bb13ef1ea37e	judge_call	942	133	0	2026-09-03 13:50:32.191983+00	0
97d65dc9-31c6-468e-9387-e4aca1c6736b	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	a3409dfe-acfc-41b2-b3d8-c36123e29f1b	judge_call	963	171	0	2026-09-03 13:56:19.597838+00	0
0df2d2b8-a134-4140-b03d-2e29bf750e76	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	a3409dfe-acfc-41b2-b3d8-c36123e29f1b	judge_call	953	127	0	2026-09-03 13:56:21.17302+00	0
7b1fd9f1-4598-4c6c-948f-e396c129a445	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	a3409dfe-acfc-41b2-b3d8-c36123e29f1b	judge_call	932	126	0	2026-09-03 13:56:22.779726+00	0
e2a36adf-1c71-4e00-a424-a79f0f8ccd58	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	a3409dfe-acfc-41b2-b3d8-c36123e29f1b	judge_call	963	169	0	2026-09-03 13:56:24.452143+00	0
d9435c00-3415-4969-a1e6-76a74122de9f	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	c578936f-b348-466b-bc53-79ed7bfdcb4d	judge_call	944	154	0	2026-09-03 13:56:31.221141+00	0
fb855084-d2a3-474f-8f7e-c4e91517a593	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	4a216943-a359-44a8-88a2-77a781c24905	judge_call	963	165	0	2026-09-03 13:56:38.229427+00	0
91797e9e-ef6f-4fa6-837e-787b5918c91d	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	4a216943-a359-44a8-88a2-77a781c24905	judge_call	951	141	0	2026-09-03 13:56:39.701882+00	0
251fc6a0-799c-4a40-acb7-3fb1cdf51b0d	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	4a216943-a359-44a8-88a2-77a781c24905	judge_call	963	170	0	2026-09-03 13:56:41.67006+00	0
a39dd4b6-4138-43a8-a754-8fc8985862c3	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	516effa8-143c-43c9-ba3d-0f1fa17514b4	judge_call	940	118	0	2026-09-03 13:56:48.322487+00	0
c21847e0-d342-45d6-8afb-e609f0a7b0fb	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	8c12741e-8c1e-4d4b-b18b-b2c553bfefbb	judge_call	967	155	0	2026-09-03 13:56:55.493014+00	0
f15faddf-6933-4a30-a040-8d7a84ca1ffd	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	8c12741e-8c1e-4d4b-b18b-b2c553bfefbb	judge_call	947	163	0	2026-09-03 13:56:57.180089+00	0
5031237c-ffba-4a04-8140-6a5138ac821c	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	8c12741e-8c1e-4d4b-b18b-b2c553bfefbb	judge_call	967	169	0	2026-09-03 13:56:59.046752+00	0
286a310c-efdb-427c-b248-4510a26b4a0a	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	911421e1-cb73-4d8f-ae81-9861f98fa0b5	judge_call	936	223	0	2026-09-03 13:57:06.322425+00	0
656033e2-3ba1-4577-ba23-3d243555a9a4	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1630	346	0	2026-09-03 15:54:35.101567+00	0
2c7c57ce-fdea-481f-a2c1-34e8002633ef	898a0428-7981-49df-be54-f8c25c1c6d13	\N	5b540531-b318-4747-8bfe-190077d3b34d	advance_generation	636	60	0	2026-09-03 15:54:36.454186+00	0
cca548cf-266a-4faf-9f01-bfac018561e8	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1630	356	0	2026-09-03 15:55:39.608925+00	0
7ee570a2-6e19-41b9-9c26-bd6e28d77dd0	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	\N	claim_extraction	1630	329	0	2026-09-03 16:00:21.651262+00	0
0a36dee4-94f0-4144-9386-403e8e8dd2ef	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	69afb86d-1071-4543-b11e-d68697e6f68d	judge_call	962	130	0	2026-09-03 16:01:51.107771+00	0
dbca8fe4-2bab-4b02-a447-4e0cbc37ceb5	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	69afb86d-1071-4543-b11e-d68697e6f68d	advance_generation	755	73	0	2026-09-03 16:01:53.358905+00	0
72f7d18f-10b3-4e02-a4e0-c9f9258aa8ce	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1629	353	0	2026-09-03 16:02:43.400958+00	0
ce5b3907-3564-4ede-a227-af9aa670e9ac	898a0428-7981-49df-be54-f8c25c1c6d13	\N	a38c7b56-e320-4285-a84c-109fed6c29f4	judge_call	952	115	0	2026-09-03 16:02:45.880162+00	0
c2304364-82d5-4f94-a995-0648af420412	898a0428-7981-49df-be54-f8c25c1c6d13	\N	a38c7b56-e320-4285-a84c-109fed6c29f4	advance_generation	655	69	0	2026-09-03 16:02:48.18108+00	0
a2ae8ec3-0344-4d40-af30-c9f2110154ad	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1630	358	0	2026-09-03 16:03:35.239621+00	0
c62b2bff-bd72-46cc-950a-05a6f711cb8e	898a0428-7981-49df-be54-f8c25c1c6d13	\N	62f76753-10b4-4f58-a637-423dd2a28721	judge_call	974	127	0	2026-09-03 16:03:37.81649+00	0
721acfdf-f521-4840-a49e-f0cf6e187c86	898a0428-7981-49df-be54-f8c25c1c6d13	\N	62f76753-10b4-4f58-a637-423dd2a28721	advance_generation	788	141	0	2026-09-03 16:03:40.787096+00	0
cd6f9463-8fd2-4387-9c8a-9987f5ccd8b5	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1669	1024	0	2026-09-03 17:17:35.38805+00	0
7e1d491f-abc4-4682-b06c-e4d7e659fdb1	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1607	266	0	2026-09-03 17:20:34.363131+00	0
4cc4c10e-377a-4069-8a77-825f40befbee	898a0428-7981-49df-be54-f8c25c1c6d13	\N	4d2dfcff-105d-4d3a-ad02-47bbdca1f3d9	advance_generation	733	75	0	2026-09-03 17:20:35.458214+00	0
945b9c6a-7b2d-4403-b935-8b773ad305d0	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1717	1024	0	2026-09-03 17:22:50.028361+00	0
84f263be-5030-4a90-ae65-8f660c9130fe	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1618	544	0	2026-09-03 17:25:18.813413+00	0
6aa5af15-e086-46d3-ae11-0b894b02f85f	898a0428-7981-49df-be54-f8c25c1c6d13	\N	e8a8a00f-698c-4b17-8341-4fe8055d023e	advance_generation	732	74	0	2026-09-03 17:25:20.147276+00	0
a21d041c-f6a7-418a-8aac-436aa7daea1b	898a0428-7981-49df-be54-f8c25c1c6d13	\N	e8a8a00f-698c-4b17-8341-4fe8055d023e	advance_generation	729	67	0	2026-09-03 17:25:21.538374+00	0
43e991ca-e685-4a42-b95d-759b194b3392	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1612	674	0	2026-09-03 17:25:28.089454+00	0
754fc8c8-86d8-4ffb-948d-9c6d506db204	898a0428-7981-49df-be54-f8c25c1c6d13	\N	e56ac6de-048c-4b5b-8fb4-28b5293295f9	advance_generation	726	63	0	2026-09-03 17:25:29.425491+00	0
2aaa1dc9-7c1a-4d62-83f1-35b90d310b7b	898a0428-7981-49df-be54-f8c25c1c6d13	\N	e56ac6de-048c-4b5b-8fb4-28b5293295f9	advance_generation	723	7	0	2026-09-03 17:25:30.477782+00	0
9d841ca0-8689-4493-8f6d-1763417af10e	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1612	428	0	2026-09-03 17:25:35.70543+00	0
fad10c38-d6a3-4116-a888-4b2359aa6051	898a0428-7981-49df-be54-f8c25c1c6d13	\N	8ab16362-fc81-4096-8a32-b92917a4e5f9	advance_generation	717	78	0	2026-09-03 17:25:36.922895+00	0
6b39572a-cd9a-4cc9-a053-1717973ae20e	898a0428-7981-49df-be54-f8c25c1c6d13	\N	8ab16362-fc81-4096-8a32-b92917a4e5f9	advance_generation	725	7	0	2026-09-03 17:25:37.882548+00	0
0a4267e4-e716-4d76-b79e-500ce7472f88	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1630	720	0	2026-09-03 17:25:52.756217+00	0
f789af79-e3b7-49be-a690-beee3dfb32cf	898a0428-7981-49df-be54-f8c25c1c6d13	\N	7ebc7f60-be1c-4a63-9d9d-7dce632bf049	judge_call	980	199	0	2026-09-03 17:25:54.678294+00	0
05067be1-8898-4a89-9294-c6609ee4bf24	898a0428-7981-49df-be54-f8c25c1c6d13	\N	7ebc7f60-be1c-4a63-9d9d-7dce632bf049	judge_call	958	131	0	2026-09-03 17:25:56.299252+00	0
8cfdf1b3-b954-4950-a623-6a80f7e7af18	898a0428-7981-49df-be54-f8c25c1c6d13	\N	7ebc7f60-be1c-4a63-9d9d-7dce632bf049	judge_call	1050	177	0	2026-09-03 17:25:58.105414+00	0
ce4a0ba9-b25f-41e5-809d-fd0fccee8d75	898a0428-7981-49df-be54-f8c25c1c6d13	\N	7ebc7f60-be1c-4a63-9d9d-7dce632bf049	advance_generation	741	7	0	2026-09-03 17:25:58.928897+00	0
9fc7c110-f4fa-4da4-a7ae-0c3d796d411e	898a0428-7981-49df-be54-f8c25c1c6d13	\N	7ebc7f60-be1c-4a63-9d9d-7dce632bf049	judge_call	972	285	0	2026-09-03 17:26:01.501017+00	0
3e0431df-1cb4-495b-8687-cf17ada378b3	898a0428-7981-49df-be54-f8c25c1c6d13	\N	7ebc7f60-be1c-4a63-9d9d-7dce632bf049	judge_call	956	151	0	2026-09-03 17:26:02.825234+00	0
3d590702-ee1b-43a5-8d4d-ee3529ea8f89	898a0428-7981-49df-be54-f8c25c1c6d13	\N	7ebc7f60-be1c-4a63-9d9d-7dce632bf049	judge_call	952	116	0	2026-09-03 17:26:04.416833+00	0
e585e1b5-42fe-4b93-9fdf-3feb15abe3c0	898a0428-7981-49df-be54-f8c25c1c6d13	\N	7ebc7f60-be1c-4a63-9d9d-7dce632bf049	judge_call	1048	176	0	2026-09-03 17:26:06.156086+00	0
795977ee-c004-4890-ba74-33c948e8d9cf	898a0428-7981-49df-be54-f8c25c1c6d13	\N	7ebc7f60-be1c-4a63-9d9d-7dce632bf049	judge_call	945	198	0	2026-09-03 17:26:07.964873+00	0
bafb8a2e-ce0a-4f01-8bde-2de5d55821b2	898a0428-7981-49df-be54-f8c25c1c6d13	\N	7ebc7f60-be1c-4a63-9d9d-7dce632bf049	advance_generation	743	161	0	2026-09-03 17:26:09.553407+00	0
3d92ebd3-e08a-4242-8340-61b39a2f3e94	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1625	939	0	2026-09-03 17:26:22.422478+00	0
01be9d43-baa6-4d32-a8d4-20d41107f889	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	956	171	0	2026-09-03 17:26:24.2107+00	0
443548d7-adb5-4532-b881-f76e3cea1bea	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	1044	174	0	2026-09-03 17:26:25.841425+00	0
903b3139-7f42-4b15-bade-fab43cc44fac	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	974	184	0	2026-09-03 17:26:27.58321+00	0
9138dc7c-29fd-439a-867a-306d88d025d9	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	958	107	0	2026-09-03 17:26:29.100063+00	0
f6431a6d-1aae-4154-9aff-62a5844458e1	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	942	83	0	2026-09-03 17:26:30.272898+00	0
2440acb9-b817-4562-bc0c-8d6c1d2b7f67	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	1036	68	0	2026-09-03 17:26:31.268412+00	0
b0c51f95-f575-451f-bb91-fda83daf5dce	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	956	83	0	2026-09-03 17:26:32.418299+00	0
c986d5b6-69c4-41bc-9063-78bd95926153	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	advance_generation	736	83	0	2026-09-03 17:26:33.941672+00	0
7ca07b30-3ada-4a7e-9727-d7896a652bfe	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	950	113	0	2026-09-03 17:26:35.319592+00	0
6a950622-5c6b-4876-b66f-4409e67c712d	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	1050	183	0	2026-09-03 17:26:36.888932+00	0
8050243a-a4ce-4960-8ee5-6eea9d4dbb51	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	974	165	0	2026-09-03 17:26:38.516921+00	0
ce8086d3-e853-4349-a7a9-085ff7f0ed60	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	956	120	0	2026-09-03 17:26:40.11056+00	0
29eeec16-7b46-4e0d-b528-741e0eeaa809	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	946	83	0	2026-09-03 17:26:41.234046+00	0
5dd68e38-4d20-43fb-bef4-2b5a768c2e9b	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	1036	106	0	2026-09-03 17:26:42.507546+00	0
2b4cfe05-e27a-475d-9a3b-f4a1550f3b93	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	954	97	0	2026-09-03 17:26:43.649964+00	0
84d9f7e9-61f6-4858-be39-6b389a7cb693	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	advance_generation	605	93	0	2026-09-03 17:26:44.852692+00	0
56daeb5a-b474-4a05-a57d-5c9b8770c059	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	952	134	0	2026-09-03 17:26:46.625409+00	0
e7312e41-7f50-4af5-aa0d-f8a268ddac71	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	942	128	0	2026-09-03 17:26:48.258106+00	0
b55d9527-446b-485a-ad27-4726b9d31531	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	1044	179	0	2026-09-03 17:26:49.653241+00	0
f2e4a421-827d-4d99-85ba-728c5efc1ae2	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	941	92	0	2026-09-03 17:26:50.916412+00	0
4546fb7d-14bd-4a2f-adda-6767e91bf2eb	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	960	115	0	2026-09-03 17:26:52.413176+00	0
e8d49b76-db52-43c6-9c6b-f29ac5da991f	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	946	86	0	2026-09-03 17:26:53.690413+00	0
15896bec-8c6e-4b26-b5ef-0857a6ab7a5b	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	932	112	0	2026-09-03 17:26:55.042697+00	0
70cc15d3-9528-418f-b039-acf1152bd1f0	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	1030	112	0	2026-09-03 17:26:56.512998+00	0
41a06728-6d72-4def-9910-1f07c01cc220	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	judge_call	927	106	0	2026-09-03 17:26:57.801591+00	0
22026627-81eb-42a0-8344-420ca9bfcc6f	898a0428-7981-49df-be54-f8c25c1c6d13	\N	cc974c09-131a-452b-9faf-36683f71c3cc	advance_generation	601	70	0	2026-09-03 17:26:58.898426+00	0
60728c83-2ea6-4a6b-8880-6307466cdaa5	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1620	626	0	2026-09-03 17:27:10.213812+00	0
f2959013-348a-4a77-a64e-266a82e2272a	898a0428-7981-49df-be54-f8c25c1c6d13	\N	742c88de-a16f-4eed-9301-be5b8a3d800f	judge_call	957	123	0	2026-09-03 17:27:11.67343+00	0
b2f8483b-30b1-4a30-a433-e451085dd460	898a0428-7981-49df-be54-f8c25c1c6d13	\N	742c88de-a16f-4eed-9301-be5b8a3d800f	judge_call	945	127	0	2026-09-03 17:27:13.332939+00	0
501645b8-d3d0-4f08-99be-11c9740c1f50	898a0428-7981-49df-be54-f8c25c1c6d13	\N	742c88de-a16f-4eed-9301-be5b8a3d800f	judge_call	928	105	0	2026-09-03 17:27:14.74894+00	0
af33625f-4ffb-4176-8287-6e5413693d91	898a0428-7981-49df-be54-f8c25c1c6d13	\N	742c88de-a16f-4eed-9301-be5b8a3d800f	judge_call	961	143	0	2026-09-03 17:27:16.301174+00	0
a8e24822-9cc4-4f5f-a209-cb13e3102d70	898a0428-7981-49df-be54-f8c25c1c6d13	\N	742c88de-a16f-4eed-9301-be5b8a3d800f	advance_generation	606	98	0	2026-09-03 17:27:17.796177+00	0
8512366c-073f-4242-b5a6-8fce242cd2d5	898a0428-7981-49df-be54-f8c25c1c6d13	\N	742c88de-a16f-4eed-9301-be5b8a3d800f	judge_call	957	156	0	2026-09-03 17:27:19.502111+00	0
680cab20-6d13-4eab-a901-4add4693b1b9	898a0428-7981-49df-be54-f8c25c1c6d13	\N	742c88de-a16f-4eed-9301-be5b8a3d800f	judge_call	941	119	0	2026-09-03 17:27:21.020513+00	0
67a0a947-4b71-464a-9826-6e74ce91f1ab	898a0428-7981-49df-be54-f8c25c1c6d13	\N	742c88de-a16f-4eed-9301-be5b8a3d800f	judge_call	941	116	0	2026-09-03 17:27:22.293794+00	0
435df50a-1515-4981-b159-23bd60bda1e1	898a0428-7981-49df-be54-f8c25c1c6d13	\N	742c88de-a16f-4eed-9301-be5b8a3d800f	advance_generation	735	171	0	2026-09-03 17:27:24.170536+00	0
3200a96f-49b1-4472-be27-6ec22b40ca5c	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1630	700	0	2026-09-03 17:27:36.726619+00	0
ae181607-bf5c-4022-87a1-0a987752ad01	898a0428-7981-49df-be54-f8c25c1c6d13	\N	3c6adbec-a8f8-4848-b373-745a41d4b0f4	judge_call	967	124	0	2026-09-03 17:27:38.471966+00	0
be81c8c2-e719-4edc-9da1-96c2ad3ac830	898a0428-7981-49df-be54-f8c25c1c6d13	\N	3c6adbec-a8f8-4848-b373-745a41d4b0f4	judge_call	959	122	0	2026-09-03 17:27:40.210244+00	0
283a47cf-8363-42c3-8054-7f72dedd48d0	898a0428-7981-49df-be54-f8c25c1c6d13	\N	3c6adbec-a8f8-4848-b373-745a41d4b0f4	judge_call	1047	172	0	2026-09-03 17:27:42.110713+00	0
0f3fdf28-ee82-4986-bf58-41cea264c6e2	898a0428-7981-49df-be54-f8c25c1c6d13	\N	3c6adbec-a8f8-4848-b373-745a41d4b0f4	judge_call	962	148	0	2026-09-03 17:27:44.001089+00	0
31e37831-a72b-4ab8-9175-6de5c19d2977	898a0428-7981-49df-be54-f8c25c1c6d13	\N	3c6adbec-a8f8-4848-b373-745a41d4b0f4	judge_call	948	139	0	2026-09-03 17:27:45.98775+00	0
14c8b56b-48c8-440a-9196-978fa77e2d74	898a0428-7981-49df-be54-f8c25c1c6d13	\N	3c6adbec-a8f8-4848-b373-745a41d4b0f4	judge_call	942	101	0	2026-09-03 17:27:47.714419+00	0
3e4d20b3-23f4-41c2-ac7a-aacfed82d72a	898a0428-7981-49df-be54-f8c25c1c6d13	\N	3c6adbec-a8f8-4848-b373-745a41d4b0f4	judge_call	1036	147	0	2026-09-03 17:27:49.503526+00	0
96dfedd6-f5b9-416b-bfea-d69d13862a46	898a0428-7981-49df-be54-f8c25c1c6d13	\N	3c6adbec-a8f8-4848-b373-745a41d4b0f4	advance_generation	758	7	0	2026-09-03 17:27:50.555434+00	0
c04ff11d-30be-4042-b5c7-6e1bd1d22fc4	898a0428-7981-49df-be54-f8c25c1c6d13	\N	3c6adbec-a8f8-4848-b373-745a41d4b0f4	judge_call	957	193	0	2026-09-03 17:27:52.717266+00	0
2e69de03-49d1-4f19-b91b-4902b370e3ef	898a0428-7981-49df-be54-f8c25c1c6d13	\N	3c6adbec-a8f8-4848-b373-745a41d4b0f4	judge_call	1045	168	0	2026-09-03 17:27:54.595756+00	0
418f3137-724a-4302-b939-f3d089f93bec	898a0428-7981-49df-be54-f8c25c1c6d13	\N	3c6adbec-a8f8-4848-b373-745a41d4b0f4	judge_call	962	172	0	2026-09-03 17:27:56.908828+00	0
4771d432-afaf-4a9e-82c1-507fa98fb482	898a0428-7981-49df-be54-f8c25c1c6d13	\N	3c6adbec-a8f8-4848-b373-745a41d4b0f4	judge_call	950	100	0	2026-09-03 17:27:58.485096+00	0
2b769a78-9b4e-45ed-a63d-4259ed470bec	898a0428-7981-49df-be54-f8c25c1c6d13	\N	3c6adbec-a8f8-4848-b373-745a41d4b0f4	judge_call	1032	141	0	2026-09-03 17:28:00.08955+00	0
690ee3c8-ca0e-418e-ac33-be5cc542c297	898a0428-7981-49df-be54-f8c25c1c6d13	\N	3c6adbec-a8f8-4848-b373-745a41d4b0f4	advance_generation	603	79	0	2026-09-03 17:28:01.631881+00	0
cf5f447e-09ba-474d-a225-f46673c341c1	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1607	279	0	2026-09-03 17:49:31.926007+00	0
a4d38698-5e50-447f-9b0b-67dddb10d4c8	898a0428-7981-49df-be54-f8c25c1c6d13	\N	f04116ec-3343-4814-ba2c-6476774a08fc	judge_call	967	165	0	2026-09-03 17:49:33.34348+00	0
5a91ff2a-9ea7-4097-8a2b-22e425e14598	898a0428-7981-49df-be54-f8c25c1c6d13	\N	f04116ec-3343-4814-ba2c-6476774a08fc	judge_call	951	153	0	2026-09-03 17:49:35.001172+00	0
f4e50fb8-99b0-4006-834c-2f1233a98864	898a0428-7981-49df-be54-f8c25c1c6d13	\N	f04116ec-3343-4814-ba2c-6476774a08fc	judge_call	932	165	0	2026-09-03 17:49:36.833206+00	0
9e614a54-a01c-4da7-b10c-1272e7e2563d	898a0428-7981-49df-be54-f8c25c1c6d13	\N	f04116ec-3343-4814-ba2c-6476774a08fc	judge_call	961	113	0	2026-09-03 17:49:38.372576+00	0
cac6db7a-912b-47d4-860d-82d9516f9766	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1606	236	0	2026-09-03 17:49:43.525416+00	0
7a4b0ca1-9349-476c-81cb-e6e34c38aa81	898a0428-7981-49df-be54-f8c25c1c6d13	\N	857f6530-de07-414e-9db6-e90c5c8288a0	judge_call	938	140	0	2026-09-03 17:49:45.070466+00	0
73c0b326-7fbe-429a-a7df-0a68cd77895a	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1607	265	0	2026-09-03 18:33:28.402286+00	0
33ca87ea-0aee-4884-bd5c-3e4feb2159c2	898a0428-7981-49df-be54-f8c25c1c6d13	\N	8425c356-9eba-40d1-9ec5-71a023eb2774	judge_call	963	181	0	2026-09-03 18:33:30.468014+00	0
6eb6a81e-e3b6-423f-85b9-a37cc2d5538d	898a0428-7981-49df-be54-f8c25c1c6d13	\N	8425c356-9eba-40d1-9ec5-71a023eb2774	judge_call	949	139	0	2026-09-03 18:33:32.073851+00	0
c6790fd3-fe6c-4dea-9437-e089fc62c06a	898a0428-7981-49df-be54-f8c25c1c6d13	\N	8425c356-9eba-40d1-9ec5-71a023eb2774	judge_call	940	139	0	2026-09-03 18:33:33.341971+00	0
f88d7051-6e76-4f34-adb2-5abd8252eb93	898a0428-7981-49df-be54-f8c25c1c6d13	\N	8425c356-9eba-40d1-9ec5-71a023eb2774	judge_call	969	217	0	2026-09-03 18:33:35.222407+00	0
d24480be-cec4-4397-b6ee-88c092bff809	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1606	289	0	2026-09-03 18:33:40.670915+00	0
7c8406b2-4ef2-409a-b23f-bb170497d783	898a0428-7981-49df-be54-f8c25c1c6d13	\N	00b5c1d5-7be1-434b-a664-c520a613d4ee	judge_call	942	147	0	2026-09-03 18:33:42.197869+00	0
481634a4-5c21-45f0-9a70-dba20f2abdc3	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1606	280	0	2026-09-03 18:47:56.272004+00	0
4730fc04-3b6b-40e8-aa2d-0b07b38d26ec	898a0428-7981-49df-be54-f8c25c1c6d13	\N	1d0d85e9-64eb-4398-9392-1a7fb515c872	judge_call	944	141	0	2026-09-03 18:47:57.717738+00	0
769968d3-6892-4f9d-b47a-15cdb22448e6	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	b0cf4531-7c84-48c9-b9b9-1504b083c0d9	judge_call	967	151	0	2026-09-04 02:55:50.987627+00	31
62377eac-d6b7-423d-b7af-7eaec5edc695	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	b0cf4531-7c84-48c9-b9b9-1504b083c0d9	advance_generation	730	91	0	2026-09-04 02:55:52.442425+00	22
c9b796ac-f573-45c7-930a-9deda8f8de51	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	fb321bdb-902b-438e-8f47-c751f7c738e5	judge_call	1082	96	0	2026-09-04 04:01:56.657427+00	30
419027db-96c3-4892-a82c-2511c73ee634	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	fb321bdb-902b-438e-8f47-c751f7c738e5	judge_call	962	153	0	2026-09-04 04:01:58.329186+00	31
fde8856d-b245-4a10-b6cf-c87104156905	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	fb321bdb-902b-438e-8f47-c751f7c738e5	advance_generation	740	90	0	2026-09-04 04:01:59.937207+00	22
2dcdd3f8-61f5-4a0a-807e-0820ea92e090	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	9d610dc7-f5b3-473a-aae3-a02704a59380	judge_call	969	134	0	2026-09-04 04:02:08.730543+00	30
ff98d541-5462-40c5-bec8-00fe17dc989a	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	9d610dc7-f5b3-473a-aae3-a02704a59380	advance_generation	734	64	0	2026-09-04 04:02:10.274274+00	20
1d79aa65-7376-4c13-8535-6ef54fcad405	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	e092ccc9-1b78-4919-a53e-012e70047461	judge_call	1084	96	0	2026-09-04 04:09:39.922022+00	30
097d688c-c3ca-42f4-b42e-ef1db99ac8f0	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	e092ccc9-1b78-4919-a53e-012e70047461	judge_call	964	152	0	2026-09-04 04:09:41.336911+00	31
0ddd8b15-27d7-4a8c-8cfa-9496fed2debf	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	e092ccc9-1b78-4919-a53e-012e70047461	advance_generation	738	7	0	2026-09-04 04:09:42.425961+00	17
f6748c9b-1fa8-4b90-91a7-2f91d81ff657	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1607	267	0	2026-09-04 15:57:58.610168+00	53
b15d016c-26b3-4446-8ea6-a31683d13287	898a0428-7981-49df-be54-f8c25c1c6d13	\N	76138ddc-9042-469b-a1c7-0cc6df02db33	judge_call	969	165	0	2026-09-04 15:58:00.224962+00	32
d70ad35d-498d-45da-9e24-f8983a504ffa	898a0428-7981-49df-be54-f8c25c1c6d13	\N	76138ddc-9042-469b-a1c7-0cc6df02db33	judge_call	947	236	0	2026-09-04 15:58:02.39822+00	36
b6f0c731-1a47-44ce-89f8-e63d508102d1	898a0428-7981-49df-be54-f8c25c1c6d13	\N	76138ddc-9042-469b-a1c7-0cc6df02db33	judge_call	934	166	0	2026-09-04 15:58:03.849519+00	32
df9434ea-426b-4ac3-9605-dd8aad94d929	898a0428-7981-49df-be54-f8c25c1c6d13	\N	76138ddc-9042-469b-a1c7-0cc6df02db33	judge_call	967	168	0	2026-09-04 15:58:05.35948+00	32
380c238f-6fdf-4cee-8674-a54a02a2ec53	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	1607	240	0	2026-09-04 16:00:54.451233+00	51
9c35d8c4-1960-4efe-b771-e176ee95a74e	898a0428-7981-49df-be54-f8c25c1c6d13	\N	6b4ed876-9a9a-4402-850d-d5d7d86a0efd	judge_call	980	166	0	2026-09-04 16:00:56.109437+00	33
6cc946aa-96b9-4b00-8d5a-5c19070493b3	898a0428-7981-49df-be54-f8c25c1c6d13	\N	6b4ed876-9a9a-4402-850d-d5d7d86a0efd	judge_call	974	219	0	2026-09-04 16:00:58.139429+00	36
2b5e65fa-de3b-4b6b-8ef7-fbb586cd3306	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	4a63340c-886d-4a54-8b0c-bb3062ce342f	judge_call	1142	108	0	2026-09-04 17:49:15.917286+00	32
0ef3c990-33d6-42d1-9c4e-49a52f9ff210	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	4a63340c-886d-4a54-8b0c-bb3062ce342f	judge_call	1024	156	0	2026-09-04 17:49:17.623871+00	33
ad039e73-21c0-4194-8bd2-5d1110de3a20	1cde4d65-3d8d-4135-859b-2ec318545a24	\N	4a63340c-886d-4a54-8b0c-bb3062ce342f	advance_generation	734	121	0	2026-09-04 17:49:19.001541+00	24
24ae63c6-beea-4638-b599-9d21b1051292	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	2164	1391	0	2026-09-04 18:04:41.166928+00	139
d2a8111d-ef46-449e-b18d-50bc283cd3a6	898a0428-7981-49df-be54-f8c25c1c6d13	\N	c5ff95ef-71b8-4263-a9e6-75030bbb18de	advance_generation	775	7	0	2026-09-04 18:04:42.01415+00	18
8e489f1c-65bb-48ee-b9e8-02ebe19bad0b	898a0428-7981-49df-be54-f8c25c1c6d13	\N	c5ff95ef-71b8-4263-a9e6-75030bbb18de	advance_generation	767	175	0	2026-09-04 18:04:43.480097+00	28
09728b04-00ba-4655-9eab-674a12b3addc	898a0428-7981-49df-be54-f8c25c1c6d13	\N	c5ff95ef-71b8-4263-a9e6-75030bbb18de	advance_generation	768	189	0	2026-09-04 18:04:43.615098+00	29
73f5ac27-c822-498a-ad14-fe5df248086f	898a0428-7981-49df-be54-f8c25c1c6d13	\N	c5ff95ef-71b8-4263-a9e6-75030bbb18de	advance_generation	779	209	0	2026-09-04 18:04:43.835933+00	31
5ab2fe7c-48de-40fe-bdf8-d5e34a59a406	898a0428-7981-49df-be54-f8c25c1c6d13	\N	c5ff95ef-71b8-4263-a9e6-75030bbb18de	advance_generation	780	211	0	2026-09-04 18:04:44.730207+00	31
784c84a9-02ca-4d97-85a2-e4d725c11367	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	2164	1611	0	2026-09-04 18:45:47.981888+00	154
097ddb4e-eb61-44ad-8b88-64749c7a8c57	898a0428-7981-49df-be54-f8c25c1c6d13	\N	\N	claim_extraction	2364	2143	0	2026-09-04 19:05:45.03802+00	193
\.


--
-- Data for Name: user; Type: TABLE DATA; Schema: public; Owner: notary
--

COPY public."user" (id, organization_id) FROM stdin;
\.


--
-- Data for Name: waitlist_signup; Type: TABLE DATA; Schema: public; Owner: notary
--

COPY public.waitlist_signup (id, email, source, created_at, invited_at) FROM stdin;
\.


--
-- Name: advance_event advance_event_pkey; Type: CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.advance_event
    ADD CONSTRAINT advance_event_pkey PRIMARY KEY (id);


--
-- Name: advance_invocation advance_invocation_pkey; Type: CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.advance_invocation
    ADD CONSTRAINT advance_invocation_pkey PRIMARY KEY (id);


--
-- Name: advance_suggestion advance_suggestion_pkey; Type: CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.advance_suggestion
    ADD CONSTRAINT advance_suggestion_pkey PRIMARY KEY (id);


--
-- Name: challenge_item challenge_item_pkey; Type: CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.challenge_item
    ADD CONSTRAINT challenge_item_pkey PRIMARY KEY (id);


--
-- Name: claim claim_pkey; Type: CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.claim
    ADD CONSTRAINT claim_pkey PRIMARY KEY (id);


--
-- Name: evidence_match evidence_match_pkey; Type: CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.evidence_match
    ADD CONSTRAINT evidence_match_pkey PRIMARY KEY (id);


--
-- Name: evidence evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.evidence
    ADD CONSTRAINT evidence_pkey PRIMARY KEY (id);


--
-- Name: organization_api_key organization_api_key_key_hash_key; Type: CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.organization_api_key
    ADD CONSTRAINT organization_api_key_key_hash_key UNIQUE (key_hash);


--
-- Name: organization_api_key organization_api_key_pkey; Type: CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.organization_api_key
    ADD CONSTRAINT organization_api_key_pkey PRIMARY KEY (id);


--
-- Name: organization organization_clerk_user_id_key; Type: CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.organization
    ADD CONSTRAINT organization_clerk_user_id_key UNIQUE (clerk_user_id);


--
-- Name: organization organization_pkey; Type: CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.organization
    ADD CONSTRAINT organization_pkey PRIMARY KEY (id);


--
-- Name: review review_pkey; Type: CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.review
    ADD CONSTRAINT review_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: usage_event usage_event_pkey; Type: CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.usage_event
    ADD CONSTRAINT usage_event_pkey PRIMARY KEY (id);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: waitlist_signup waitlist_signup_email_key; Type: CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.waitlist_signup
    ADD CONSTRAINT waitlist_signup_email_key UNIQUE (email);


--
-- Name: waitlist_signup waitlist_signup_pkey; Type: CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.waitlist_signup
    ADD CONSTRAINT waitlist_signup_pkey PRIMARY KEY (id);


--
-- Name: advance_event_event_type_idx; Type: INDEX; Schema: public; Owner: notary
--

CREATE INDEX advance_event_event_type_idx ON public.advance_event USING btree (event_type);


--
-- Name: advance_event_suggestion_id_idx; Type: INDEX; Schema: public; Owner: notary
--

CREATE INDEX advance_event_suggestion_id_idx ON public.advance_event USING btree (suggestion_id);


--
-- Name: advance_invocation_claim_id_idx; Type: INDEX; Schema: public; Owner: notary
--

CREATE INDEX advance_invocation_claim_id_idx ON public.advance_invocation USING btree (claim_id);


--
-- Name: advance_invocation_organization_id_created_at_idx; Type: INDEX; Schema: public; Owner: notary
--

CREATE INDEX advance_invocation_organization_id_created_at_idx ON public.advance_invocation USING btree (organization_id, created_at);


--
-- Name: advance_invocation_review_id_idx; Type: INDEX; Schema: public; Owner: notary
--

CREATE INDEX advance_invocation_review_id_idx ON public.advance_invocation USING btree (review_id);


--
-- Name: advance_suggestion_invocation_id_idx; Type: INDEX; Schema: public; Owner: notary
--

CREATE INDEX advance_suggestion_invocation_id_idx ON public.advance_suggestion USING btree (invocation_id);


--
-- Name: advance_suggestion_invocation_ordinal_idx; Type: INDEX; Schema: public; Owner: notary
--

CREATE UNIQUE INDEX advance_suggestion_invocation_ordinal_idx ON public.advance_suggestion USING btree (invocation_id, ordinal);


--
-- Name: challenge_item_claim_idx; Type: INDEX; Schema: public; Owner: notary
--

CREATE INDEX challenge_item_claim_idx ON public.challenge_item USING btree (claim_id);


--
-- Name: challenge_item_claim_ordinal_idx; Type: INDEX; Schema: public; Owner: notary
--

CREATE UNIQUE INDEX challenge_item_claim_ordinal_idx ON public.challenge_item USING btree (claim_id, ordinal);


--
-- Name: claim_review_id_created_at_idx; Type: INDEX; Schema: public; Owner: notary
--

CREATE INDEX claim_review_id_created_at_idx ON public.claim USING btree (review_id, created_at);


--
-- Name: claim_review_id_idx; Type: INDEX; Schema: public; Owner: notary
--

CREATE INDEX claim_review_id_idx ON public.claim USING btree (review_id);


--
-- Name: evidence_created_at_idx; Type: INDEX; Schema: public; Owner: notary
--

CREATE INDEX evidence_created_at_idx ON public.evidence USING btree (created_at);


--
-- Name: evidence_match_claim_id_idx; Type: INDEX; Schema: public; Owner: notary
--

CREATE INDEX evidence_match_claim_id_idx ON public.evidence_match USING btree (claim_id);


--
-- Name: evidence_match_evidence_id_idx; Type: INDEX; Schema: public; Owner: notary
--

CREATE INDEX evidence_match_evidence_id_idx ON public.evidence_match USING btree (evidence_id);


--
-- Name: evidence_review_id_idx; Type: INDEX; Schema: public; Owner: notary
--

CREATE INDEX evidence_review_id_idx ON public.evidence USING btree (review_id);


--
-- Name: organization_api_key_organization_id_idx; Type: INDEX; Schema: public; Owner: notary
--

CREATE INDEX organization_api_key_organization_id_idx ON public.organization_api_key USING btree (organization_id);


--
-- Name: organization_stripe_customer_id_uq; Type: INDEX; Schema: public; Owner: notary
--

CREATE UNIQUE INDEX organization_stripe_customer_id_uq ON public.organization USING btree (stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL);


--
-- Name: review_org_idempotency_key_uniq; Type: INDEX; Schema: public; Owner: notary
--

CREATE UNIQUE INDEX review_org_idempotency_key_uniq ON public.review USING btree (organization_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: review_organization_id_created_at_idx; Type: INDEX; Schema: public; Owner: notary
--

CREATE INDEX review_organization_id_created_at_idx ON public.review USING btree (organization_id, created_at);


--
-- Name: usage_event_created_at_idx; Type: INDEX; Schema: public; Owner: notary
--

CREATE INDEX usage_event_created_at_idx ON public.usage_event USING btree (created_at);


--
-- Name: usage_event_org_created_at_idx; Type: INDEX; Schema: public; Owner: notary
--

CREATE INDEX usage_event_org_created_at_idx ON public.usage_event USING btree (organization_id, created_at);


--
-- Name: usage_event_organization_id_created_at_idx; Type: INDEX; Schema: public; Owner: notary
--

CREATE INDEX usage_event_organization_id_created_at_idx ON public.usage_event USING btree (organization_id, created_at);


--
-- Name: advance_event advance_event_suggestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.advance_event
    ADD CONSTRAINT advance_event_suggestion_id_fkey FOREIGN KEY (suggestion_id) REFERENCES public.advance_suggestion(id) ON DELETE CASCADE;


--
-- Name: advance_invocation advance_invocation_claim_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.advance_invocation
    ADD CONSTRAINT advance_invocation_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.claim(id) ON DELETE CASCADE;


--
-- Name: advance_invocation advance_invocation_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.advance_invocation
    ADD CONSTRAINT advance_invocation_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: advance_invocation advance_invocation_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.advance_invocation
    ADD CONSTRAINT advance_invocation_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.review(id) ON DELETE CASCADE;


--
-- Name: advance_suggestion advance_suggestion_invocation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.advance_suggestion
    ADD CONSTRAINT advance_suggestion_invocation_id_fkey FOREIGN KEY (invocation_id) REFERENCES public.advance_invocation(id) ON DELETE CASCADE;


--
-- Name: challenge_item challenge_item_claim_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.challenge_item
    ADD CONSTRAINT challenge_item_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.claim(id) ON DELETE CASCADE;


--
-- Name: claim claim_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.claim
    ADD CONSTRAINT claim_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.review(id);


--
-- Name: evidence_match evidence_match_claim_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.evidence_match
    ADD CONSTRAINT evidence_match_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.claim(id);


--
-- Name: evidence_match evidence_match_evidence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.evidence_match
    ADD CONSTRAINT evidence_match_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES public.evidence(id);


--
-- Name: evidence evidence_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.evidence
    ADD CONSTRAINT evidence_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.review(id);


--
-- Name: organization_api_key organization_api_key_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.organization_api_key
    ADD CONSTRAINT organization_api_key_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: review review_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.review
    ADD CONSTRAINT review_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: usage_event usage_event_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.usage_event
    ADD CONSTRAINT usage_event_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: usage_event usage_event_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.usage_event
    ADD CONSTRAINT usage_event_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.review(id);


--
-- Name: usage_event usage_event_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public.usage_event
    ADD CONSTRAINT usage_event_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id);


--
-- Name: user user_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: notary
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- PostgreSQL database dump complete
--

\unrestrict oWwaw3forwYlVcBmjYAjIfCwlqJCi82mGTLIpGRrM0xsaajt0d483OoiOF2GGyC

