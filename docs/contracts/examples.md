# Shared Contract Fixtures: JSON Examples

This document provides complete, canonical JSON fixtures for API requests, responses, and WebSocket events. All identifiers use synthetic UUIDs and emails end in `@example.test`.

---

## 1. Authentication & Course Management Fixtures

### `POST /api/auth/login` (Response)
```json
{
  "user": {
    "id": "11111111-1111-4111-8111-111111111111",
    "email": "sarah.chen@example.test",
    "name": "Prof. Sarah Chen",
    "role": "teacher"
  },
  "session": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.synthetic_teacher_jwt",
    "refreshToken": "synthetic_refresh_token_xyz"
  }
}
```

### `POST /api/courses/:courseId/upload` (Preview Response)
```json
{
  "courseId": "22222222-2222-4222-8222-222222222222",
  "totalPages": 11,
  "processedPages": 10,
  "truncated": true,
  "preview": {
    "concepts": [
      {
        "label": "Vectors",
        "description": "Mathematical objects with magnitude and direction",
        "category": "Linear Algebra",
        "difficulty": 1
      },
      {
        "label": "Matrices",
        "description": "Rectangular arrays of numbers used for linear transformations",
        "category": "Linear Algebra",
        "difficulty": 2
      },
      {
        "label": "Gradient Descent",
        "description": "Iterative optimization algorithm following negative gradient",
        "category": "Gradient Descent",
        "difficulty": 3
      }
    ],
    "edges": [
      ["Vectors", "Matrices"],
      ["Matrices", "Gradient Descent"]
    ]
  }
}
```

### `GET /api/courses/:courseId/graph` (Response)
```json
{
  "nodes": [
    {
      "id": "33333333-3333-4333-8333-333333333301",
      "label": "Vectors",
      "description": "Mathematical objects with magnitude and direction",
      "category": "Linear Algebra",
      "difficulty": 1,
      "importance": 0.500,
      "confidence": 0.85,
      "band": "green"
    },
    {
      "id": "33333333-3333-4333-8333-333333333302",
      "label": "Matrices",
      "description": "Rectangular arrays of numbers used for linear transformations",
      "category": "Linear Algebra",
      "difficulty": 2,
      "importance": 0.731,
      "confidence": 0.40,
      "band": "yellow"
    },
    {
      "id": "33333333-3333-4333-8333-333333333317",
      "label": "Gradient Descent",
      "description": "Iterative optimization algorithm following negative gradient",
      "category": "Gradient Descent",
      "difficulty": 3,
      "importance": 0.880,
      "confidence": 0.20,
      "band": "red"
    }
  ],
  "edges": [
    {
      "id": "44444444-4444-4444-8444-444444444401",
      "source": "33333333-3333-4333-8333-333333333301",
      "target": "33333333-3333-4333-8333-333333333302",
      "relationship": "prerequisite"
    }
  ]
}
```

---

## 2. Classroom & Poll Fixtures

### `POST /api/lectures/:lectureId/transcript` (Request)
```json
{
  "text": "Today we cover gradient descent, which requires computing the loss function gradient with respect to model parameters.",
  "timestampSec": 142.5,
  "speakerName": "Prof. Chen"
}
```

### `POST /api/lectures/:lectureId/transcript` (Response)
```json
{
  "chunkId": "55555555-5555-4555-8555-555555555555",
  "detectedConceptIds": [
    "33333333-3333-4333-8333-333333333316",
    "33333333-3333-4333-8333-333333333317"
  ]
}
```

### `poll:new-question` (Socket Event Payload)
```json
{
  "eventId": "66666666-6666-4666-8666-666666666601",
  "occurredAt": "2026-10-20T14:35:10.000Z",
  "pollId": "77777777-7777-4777-8777-777777777777",
  "lectureId": "88888888-8888-4888-8888-888888888888",
  "conceptId": "33333333-3333-4333-8333-333333333317",
  "question": "What happens to the gradient descent optimization trajectory if the learning rate is chosen too large?",
  "status": "active",
  "activatedAt": "2026-10-20T14:35:09.500Z"
}
```

### `POST /api/polls/:pollId/respond` (Response)
```json
{
  "responseId": "99999999-9999-4999-8999-999999999999",
  "status": "evaluated",
  "evaluation": {
    "outcome": "correct",
    "feedback": "Excellent reasoning. You correctly identified that an excessively large learning rate causes the parameters to overshoot the local minimum and diverge."
  },
  "newConfidence": 0.85,
  "newBand": "green"
}
```

### `mastery:updated` (Socket Event Payload)
```json
{
  "eventId": "66666666-6666-4666-8666-666666666602",
  "occurredAt": "2026-10-20T14:36:02.120Z",
  "studentId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "conceptId": "33333333-3333-4333-8333-333333333317",
  "confidence": 0.85,
  "band": "green",
  "evidenceType": "poll",
  "attempts": 1,
  "version": 2
}
```

---

## 3. Tutoring & Practice Quiz Fixtures

### `POST /api/tutoring/sessions/:sessionId/messages` (Response)
```json
{
  "userMessage": {
    "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01",
    "role": "user",
    "content": "Why is the gradient the direction of steepest ascent?",
    "createdAt": "2026-10-20T15:10:00.000Z"
  },
  "assistantMessage": {
    "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02",
    "role": "assistant",
    "content": "Consider the directional derivative $D_u f = \\nabla f \\cdot u$ where $u$ is a unit vector. By the Cauchy-Schwarz inequality, when is the dot product of two vectors maximized?",
    "understandingDetected": false,
    "createdAt": "2026-10-20T15:10:03.200Z"
  },
  "understandingDetected": false
}
```

### `POST /api/concepts/:conceptId/quiz-submit` (Response)
```json
{
  "attemptId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "conceptId": "33333333-3333-4333-8333-333333333317",
  "score": 0.80,
  "correctCount": 4,
  "totalQuestions": 5,
  "feedback": [
    {
      "questionId": "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
      "correct": true,
      "correctOption": 1,
      "explanation": "Stochastic gradient descent updates parameters using random mini-batches rather than the entire dataset."
    }
  ],
  "masteryDelta": 0.15,
  "newConfidence": 0.55,
  "newBand": "yellow"
}
```

---

## 4. Consensual Peer Collaboration Fixtures

### `POST /api/courses/:courseId/study-groups/opt-in` (Response)
```json
{
  "status": "matched",
  "matchId": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  "expiresAt": "2026-10-20T16:05:00.000Z"
}
```

### `study-group:updated` (Socket Event Payload with Genuine Zoom Link)
```json
{
  "eventId": "66666666-6666-4666-8666-666666666603",
  "occurredAt": "2026-10-20T16:12:45.000Z",
  "matchId": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  "schedulingStatus": "accepted",
  "proposedSlot": {
    "startsAt": "2026-10-21T15:00:00.000Z",
    "endsAt": "2026-10-21T15:30:00.000Z"
  },
  "student1Accepted": true,
  "student2Accepted": true,
  "zoomLink": "https://us05web.zoom.us/j/9876543210?pwd=syntheticMeetingPassword123",
  "meetingStatus": "created"
}
```
