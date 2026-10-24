# ADR 0009: Consensual Peer Collaboration & Honest Scheduling

## Status
Accepted

## Context
The prototype's peer study feature suffered from significant product and ethical compromises:
1. `study_groups.py` paired students by selecting random classmates from the roster without verifying consent, opt-in status, or availability.
2. The prototype generated static, hardcoded personal meeting room links rather than authentic video meetings.
3. When a human peer was unavailable, the chat feature secretly used an LLM to impersonate the student without disclosure.

## Decision
We enforce genuine, consensual, and transparent peer collaboration:
1. **Explicit Ephemeral Opt-In**: Students enter the study pool only by explicitly submitting 1 to 3 concepts they wish to study. Pool entries automatically expire after 5 minutes to prevent stale matches.
2. **Complementary Gap Match Algorithm**: Matches require mutual course enrollment, overlapping requested concepts, and a complementary knowledge gap:
   $$\text{score} = \frac{1}{|K|}\sum_{c \in K} |c_1(c) - c_2(c)| \ge 0.30$$
   where $K$ is the set of overlapping concepts. Students with identical confidence levels ($< 0.30$ difference) are not matched.
3. **Pure Human-to-Human Messaging**: In-app chat within a match is strictly human-to-human. Bot simulation or LLM persona impersonation of classmates is strictly prohibited.
4. **Mutual Availability Overlap**: Students register discrete future UTC intervals $[startsAt, endsAt)$ of at least 30 minutes. The system automatically identifies the earliest mutual 30-minute overlap. Both students must explicitly accept the proposal.
5. **Authentic Zoom Integration via Teacher OAuth**: Once bilaterally accepted, the system calls the Zoom REST API using the owning teacher's authorized OAuth credentials to generate a genuine Zoom meeting with an authentic meeting ID and join URL. If Zoom credentials are not configured, the match remains functional for chat and scheduling, but the meeting status reports `unavailable` without generating fake URLs.

## Why
- Eliminates student harassment and privacy violations caused by forced matchmaking.
- Guarantees pedagogical value: pairs students where one can teach and the other can learn.
- Enforces honest software engineering by integrating authentic Zoom APIs and human-only communications.

## Consequences
- Students may wait in the pool without matching if no complementary peer has opted in during the 5-minute window.
- Instructors must connect an authorized Zoom account via OAuth for courses wishing to offer automated peer meeting generation.
