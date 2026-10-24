# Master Implementation Checklist: HackOHIO-2026

This checklist tracks project completion from Phase 0 to Phase 7. Tasks are identified by stable IDs matching `docs/04-build-plan.md`.

> **Status Notice**: All items are currently planned and unchecked. In accordance with the Single-Writer protocol ([ADR 0011](docs/adr/0011-single-writer-migrations-and-integration.md)), feature pull requests do not check these boxes directly; Lane A synchronizes this checklist after feature PRs merge with verified checkpoint evidence.

---

## Phase 0: Foundations & Shared Contracts

- [x] P0-A-01 — Repository Preflight, Toolchain Setup & Project Skeleton
- [ ] P0-A-02 — Supabase Local Instance & Migration 0001 Foundation
- [ ] P0-A-03 — Shared Contracts & Zod Domain Schemas
- [ ] P0-B-01 — Classroom & Collaboration Contract Stubs & Realtime Fixtures
- [ ] P0-C-01 — AI & Learning Service Ports & Deterministic Fixtures
- [ ] P0-D-01 — UI Component Tokens, Route Shells & Test Harness Setup

---

## Phase 1: Independent Vertical Foundations

- [ ] P1-A-01 — Supabase JWT Token Verification & ActorContext Middleware
- [ ] P1-A-02 — Course Service & Join Code Generator
- [ ] P1-A-03 — Enrollment & Mastery Initialization Service
- [ ] P1-A-04 — Atomic Mastery Engine & PostgreSQL RPC
- [ ] P1-B-01 — Lecture Session Lifecycle & State Machine
- [ ] P1-B-02 — Ephemeral Study Group Pool Repository
- [ ] P1-C-01 — Anthropic & Perplexity Typed Client Adapters
- [ ] P1-C-02 — Socratic Tutoring Session Engine
- [ ] P1-D-01 — App Router Shells & Navigation Layout

---

## Phase 2: Course Setup & Prerequisite Graph

- [ ] P2-A-01 — Prerequisite DAG Validation Engine & Cycle Detector
- [ ] P2-A-02 — Graph Persistence & Transactional Node/Edge Commit
- [ ] P2-C-01 — Syllabus PDF Bounded Ingestion & Graph Extraction Pipeline
- [ ] P2-D-01 — Syllabus Upload & Graph Preview UI
- [ ] P2-D-02 — Interactive D3-Force Knowledge Graph Visualizer

---

## Phase 3: Live Classroom & Transcript Streaming

- [ ] P3-A-01 — Attendance Evidence Recording & Verification
- [ ] P3-B-01 — Authenticated Socket.IO Server & Room Authorization
- [ ] P3-B-02 — Live Transcript Chunk Ingestion & Broadcasting
- [ ] P3-B-03 — Reference-Counted Connection & Attendance Tracker
- [ ] P3-B-04 — Lecture Simulator & Zoom RTMS Streaming Adapter
- [ ] P3-C-01 — Real-Time Sliding-Window Concept Detection Pipeline
- [ ] P3-C-02 — Post-Lecture Summarization Pipeline
- [ ] P3-D-01 — Teacher Live Lecture Controls & Streaming Transcript Feed
- [ ] P3-D-02 — Student Real-Time Lecture View & Active Node Overlay

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

---

## Phase 5: Autonomous Learning & Socratic Tutoring

- [ ] P5-A-01 — Quiz & Tutoring Evidence RPC Integration
- [ ] P5-C-01 — Socratic Tutoring Dialogue Pipeline & Understanding Verification
- [ ] P5-C-02 — Concept Learning Page Generation Pipeline
- [ ] P5-C-03 — Practice Quiz Generation & Server-Side Scoring Engine
- [ ] P5-C-04 — Perplexity Academic Resource Search & Cited Q&A
- [ ] P5-C-05 — TutorFeature, LearningFeature & StudyGroupFeature UI Modules
- [ ] P5-D-01 — Student Concept Learning & Quiz Route Shell Mounting
- [ ] P5-D-02 — Student Tutoring & Lecture Summaries Shell Mounting

---

## Phase 6: Consensual Peer Collaboration & Zoom Scheduling

- [ ] P6-A-01 — Study Group Relational Schema, Availability & Lock RPCs
- [ ] P6-B-01 — Consensual Complementary Matchmaking Engine
- [ ] P6-B-02 — Secure Peer Messaging & Room Broadcaster
- [ ] P6-B-03 — Mutual Availability Overlap Detector & Scheduling State Machine
- [ ] P6-B-04 — Authentic Zoom OAuth 2.0 Client & Meeting Adapter
- [ ] P6-D-01 — Peer Study Group Route Shell & Chat Interface

---

## Phase 7: Deployment, Verification & Final Acceptance

- [ ] P7-A-01 — Persistent Server Composition Root & Production Containerization
- [ ] P7-A-02 — Deterministic 33-Node CS229 Database Seed & Demo Script
- [ ] P7-B-01 — Live Zoom RTMS & Webhook Production Verification
- [ ] P7-C-01 — Live Anthropic & Perplexity Production Verification
- [ ] P7-D-01 — Multi-Browser End-to-End Playwright Journey Suite
- [ ] P7-D-02 — Responsive Layout & Accessibility Audit Verification
- [ ] P7-D-03 — Final Classroom Milestone & Complete Product Acceptance
