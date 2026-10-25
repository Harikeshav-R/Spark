# Master Implementation Checklist: Spark

This checklist tracks project completion from Phase 0 to Phase 7. Tasks are identified by stable IDs matching `docs/04-build-plan.md`.

> **Status Notice**: Phase 0, Phase 1, Phase 2, and Phase 3 are complete. All Phase 3 tasks (P3-A-01, P3-B-01, P3-B-02, P3-B-03, P3-B-04, P3-C-01, P3-C-02, P3-D-01, and P3-D-02) have been implemented, verified, and merged into `main`. The dependency frontier has advanced to Phase 4 (Formative Polls & Teaching Interventions): P4-A-01, P4-A-02, P4-B-01, and P4-C-01. In accordance with the Single-Writer protocol ([ADR 0011](docs/adr/0011-single-writer-migrations-and-integration.md)), Lane A synchronizes this checklist after feature PRs merge with verified checkpoint evidence.

---

## Phase 0: Foundations & Shared Contracts

- [x] P0-A-01 — Repository Preflight, Toolchain Setup & Project Skeleton
- [x] P0-A-02 — Supabase Local Instance & Migration 0001 Foundation
- [x] P0-A-03 — Shared Contracts & Zod Domain Schemas
- [x] P0-B-01 — Classroom & Collaboration Contract Stubs & Realtime Fixtures
- [x] P0-C-01 — AI & Learning Service Ports & Deterministic Fixtures
- [x] P0-D-01 — UI Component Tokens, Route Shells & Test Harness Setup

---

## Phase 1: Independent Vertical Foundations

- [x] P1-A-01 — Supabase JWT Token Verification & ActorContext Middleware
- [x] P1-A-02 — Course Service & Join Code Generator
- [x] P1-A-03 — Enrollment & Mastery Initialization Service
- [x] P1-A-04 — Atomic Mastery Engine & PostgreSQL RPC
- [x] P1-B-01 — Lecture Session Lifecycle & State Machine
- [x] P1-B-02 — Ephemeral Study Group Pool Repository
- [x] P1-C-01 — OpenRouter Typed Client Adapter (Anthropic & Perplexity Models)
- [x] P1-C-02 — Socratic Tutoring Session Engine
- [x] P1-D-01 — App Router Shells & Navigation Layout
- [x] P1-A-05 — Shared Game, Encounter & Party Extension Contracts and Fixtures
- [x] P1-A-06 — Additive Spark Learning Relational Migration 0003
- [x] P1-D-02 — Warm Palette Design Tokens & Theme Follow-on

---

## Phase 2: Course Setup & Prerequisite Graph

- [x] P2-A-01 — Prerequisite DAG Validation Engine & Cycle Detector
- [x] P2-A-02 — Graph Persistence & Transactional Node/Edge Commit
- [x] P2-C-01 — Syllabus PDF Bounded Ingestion & Graph Extraction Pipeline
- [x] P2-D-01 — Syllabus Upload & Graph Preview UI
- [x] P2-D-02 — Interactive D3-Force Knowledge Graph Visualizer
- [x] P2-D-03 — SVG Companion Mascot Spark, Mood Expressions & Form Transitions

---

## Phase 3: Live Classroom & Transcript Streaming

- [x] P3-A-01 — Attendance Evidence Recording & Verification
- [x] P3-B-01 — Authenticated Socket.IO Server & Room Authorization
- [x] P3-B-02 — Live Transcript Chunk Ingestion & Broadcasting
- [x] P3-B-03 — Reference-Counted Connection & Attendance Tracker
- [x] P3-B-04 — Lecture Simulator & Zoom RTMS Streaming Adapter
- [x] P3-C-01 — Real-Time Sliding-Window Concept Detection Pipeline
- [x] P3-C-02 — Post-Lecture Summarization Pipeline
- [x] P3-D-01 — Teacher Live Lecture Controls & Streaming Transcript Feed
- [x] P3-D-02 — Student Real-Time Lecture View & Active Node Overlay

---

## Phase 4: Formative Polls & Teaching Interventions

- [ ] P4-A-01 — Poll Response Atomic Mastery Evidence Application
- [ ] P4-A-02 — Course Heatmap Aggregation Service & Cache
- [ ] P4-B-01 — Poll Lifecycle Manager & Response Ingestion
- [ ] P4-C-01 — Socratic Formative Poll Question Generation Pipeline
- [ ] P4-C-02 — Server-Side Poll Response Evaluation Pipeline
- [ ] P4-C-03 — Real-Time Misconception Clustering & Pedagogical Interventions
- [ ] P4-D-01 — Formative Poll Teacher Dashboard & Live Response Heatmap
- [ ] P4-D-02 — Student Active Poll Modal & Evaluation Card
- [ ] P4-A-03 — Class Sky Aggregate Confidence & Course Effort Service
- [ ] P4-D-03 — Instructor Class Sky Visualization & Effort/Mastery Roster

---

## Phase 5: Autonomous Learning & Socratic Tutoring

- [ ] P5-A-01 — Quiz & Tutoring Evidence RPC Integration
- [ ] P5-C-01 — Socratic Tutoring Dialogue Pipeline & Understanding Verification
- [ ] P5-C-02 — Concept Learning Page Generation Pipeline
- [ ] P5-C-03 — Practice Quiz Generation & Server-Side Scoring Engine
- [ ] P5-C-04 — OpenRouter Academic Resource Search & Cited Q&A (Perplexity Models)
- [ ] P5-C-05 — TutorFeature, LearningFeature & StudyGroupFeature UI Modules
- [ ] P5-D-01 — Student Concept Learning & Quiz Route Shell Mounting
- [ ] P5-D-02 — Student Tutoring & Lecture Summaries Shell Mounting
- [ ] P5-A-02 — Daily Quests, Streak Calculation, XP Ledger & Eclipse Service
- [ ] P5-C-06 — Hint-Capable Question Generation & Practice Encounter Orchestration
- [ ] P5-C-07 — Exported EncounterFeature Component & Hint Drawer
- [ ] P5-D-03 — Student Quests, Eclipse, Mascot Shell Mounting & Encounter Integration

---

## Phase 6: Consensual Peer Collaboration & Zoom Scheduling

- [ ] P6-A-01 — Study Group Relational Schema (Migration 0004), Availability & Lock RPCs
- [ ] P6-B-01 — Consensual Complementary Matchmaking Engine
- [ ] P6-B-02 — Secure Peer Messaging & Room Broadcaster
- [ ] P6-B-03 — Mutual Availability Overlap Detector & Scheduling State Machine
- [ ] P6-B-04 — Authentic Zoom OAuth 2.0 Client & Meeting Adapter
- [ ] P6-D-01 — Peer Study Group Route Shell & Chat Interface
- [ ] P6-A-02 — Additive Collaboration Migration 0005 & Party Quest Constraints
- [ ] P6-B-05 — Collaborative Party Quests, Candidate Invitations & Reward Distribution
- [ ] P6-C-01 — Extended StudyGroupFeature with Invitations, Fit Badges & Party Goals

---

## Phase 7: Deployment, Verification & Final Acceptance

- [ ] P7-A-01 — Persistent Server Composition Root & Production Containerization
- [ ] P7-A-02 — Deterministic 33-Node CS229 Database Seed & Demo Script
- [ ] P7-B-01 — Live Zoom RTMS & Webhook Production Verification
- [ ] P7-C-01 — Live OpenRouter Production Verification (Anthropic & Perplexity Models)
- [ ] P7-D-01 — Multi-Browser End-to-End Playwright Journey Suite
- [ ] P7-D-04 — Journeys J09–J11 Playwright End-to-End Test Suite
- [ ] P7-D-02 — Responsive Layout & Accessibility Audit Verification
- [ ] P7-D-03 — Final Classroom Milestone & Complete Product Acceptance
