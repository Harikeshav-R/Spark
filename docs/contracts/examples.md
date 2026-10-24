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

---

## 5. Spark Progression, Encounter & Collaboration Fixtures (Phase 1 Extensions)

### `GET /api/students/:studentId/daily-quest` (Response)
```json
{
  "id": "77777777-7777-4777-8777-777777777701",
  "studentId": "44444444-4444-4444-8444-444444444402",
  "date": "2026-10-21",
  "items": [
    {
      "conceptId": "33333333-3333-4333-8333-333333333317",
      "confidence": 0.20,
      "band": "red",
      "reviewState": "overdue",
      "completed": false
    },
    {
      "conceptId": "33333333-3333-4333-8333-333333333318",
      "confidence": 0.35,
      "band": "red",
      "reviewState": "unreviewed",
      "completed": false
    },
    {
      "conceptId": "33333333-3333-4333-8333-333333333319",
      "confidence": 0.50,
      "band": "yellow",
      "reviewState": "current",
      "completed": false
    }
  ],
  "clearedAt": null,
  "version": 1
}
```

### `GET /api/students/:studentId/game-summary` (Response)
```json
{
  "studentId": "44444444-4444-4444-8444-444444444402",
  "courseId": "22222222-2222-4222-8222-222222222222",
  "xp": 420,
  "streakDays": 3,
  "skyBrightness": 0.58,
  "form": "glow",
  "formProgress": 0.15,
  "updatedAt": "2026-10-21T14:30:00.000Z"
}
```

### `GET /api/students/:studentId/eclipse` (Response)
```json
{
  "studentId": "44444444-4444-4444-8444-444444444402",
  "strength": 39,
  "targets": [
    {
      "conceptId": "33333333-3333-4333-8333-333333333317",
      "confidence": 0.35,
      "band": "red"
    },
    {
      "conceptId": "33333333-3333-4333-8333-333333333318",
      "confidence": 0.50,
      "band": "yellow"
    }
  ],
  "examAt": "2026-11-01T14:00:00.000Z"
}
```

### `POST /api/students/:studentId/encounters` (Response)
```json
{
  "id": "88888888-8888-4888-8888-888888888801",
  "studentId": "44444444-4444-4444-8444-444444444402",
  "conceptId": "33333333-3333-4333-8333-333333333317",
  "source": "daily",
  "questId": "77777777-7777-4777-8777-777777777701",
  "partyQuestId": null,
  "status": "active",
  "questions": [
    {
      "questionId": "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
      "question": "Why are intermediate activations saved during the forward pass of backpropagation?",
      "options": [
        "To speed up future inference passes",
        "Because local gradients evaluate partial derivatives at forward activation values",
        "To reduce total GPU memory allocation during training",
        "To prevent numerical underflow in floating-point operations"
      ],
      "hintsUsed": 0
    },
    {
      "questionId": "dddddddd-dddd-4ddd-8ddd-dddddddddd02",
      "question": "What mathematical rule underpins backpropagation through a computational graph?",
      "options": [
        "Multivariate Chain Rule",
        "L'Hôpital's Rule",
        "Taylor Series Expansion",
        "Fundamental Theorem of Calculus"
      ],
      "hintsUsed": 0
    },
    {
      "questionId": "dddddddd-dddd-4ddd-8ddd-dddddddddd03",
      "question": "In a node computing z = x * y, what is the partial derivative with respect to x?",
      "options": [
        "y",
        "x",
        "1",
        "0"
      ],
      "hintsUsed": 0
    },
    {
      "questionId": "dddddddd-dddd-4ddd-8ddd-dddddddddd04",
      "question": "What is the time complexity of the backward pass relative to the forward pass?",
      "options": [
        "Constant multiple of forward pass time",
        "Exponential in depth of graph",
        "Quadratic in number of parameters",
        "Independent of forward pass complexity"
      ],
      "hintsUsed": 0
    },
    {
      "questionId": "dddddddd-dddd-4ddd-8ddd-dddddddddd05",
      "question": "What problem occurs if intermediate activation values are discarded prematurely?",
      "options": [
        "Activations must be recomputed on the backward pass, increasing compute cost",
        "Gradient values become mathematically non-zero",
        "Loss function changes value dynamically",
        "Weights cannot be initialized properly"
      ],
      "hintsUsed": 0
    }
  ],
  "version": 1
}
```

### `POST /api/encounters/:encounterId/hints` (Response)
```json
{
  "questionId": "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
  "level": 1,
  "text": "Recall that computing the derivative of f(g(x)) involves evaluating f'(u) at u = g(x)."
}
```

### `POST /api/encounters/:encounterId/submit` (Response)
```json
{
  "encounterId": "88888888-8888-4888-8888-888888888801",
  "attemptId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "score": 0.8,
  "correctCount": 4,
  "totalQuestions": 5,
  "newConfidence": 0.35,
  "newBand": "red",
  "feedback": [
    {
      "questionId": "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
      "correct": true,
      "correctOption": 1,
      "explanation": "Local gradients require forward activation values to compute exact weight updates."
    },
    {
      "questionId": "dddddddd-dddd-4ddd-8ddd-dddddddddd02",
      "correct": true,
      "correctOption": 0,
      "explanation": "The multivariate chain rule allows propagation of incoming gradients to upstream parameters."
    },
    {
      "questionId": "dddddddd-dddd-4ddd-8ddd-dddddddddd03",
      "correct": true,
      "correctOption": 0,
      "explanation": "The partial derivative of a product with respect to one input equals the other input."
    },
    {
      "questionId": "dddddddd-dddd-4ddd-8ddd-dddddddddd04",
      "correct": true,
      "correctOption": 0,
      "explanation": "The backward pass is asymptotically comparable in compute to the forward pass."
    },
    {
      "questionId": "dddddddd-dddd-4ddd-8ddd-dddddddddd05",
      "correct": false,
      "correctOption": 0,
      "explanation": "Discarding activations requires recomputation during the backward pass."
    }
  ],
  "xpAwarded": 88,
  "summary": {
    "studentId": "44444444-4444-4444-8444-444444444402",
    "courseId": "22222222-2222-4222-8222-222222222222",
    "xp": 508,
    "streakDays": 3,
    "skyBrightness": 0.60,
    "form": "glow",
    "formProgress": 0.25,
    "updatedAt": "2026-10-21T14:35:00.000Z"
  },
  "dailyQuest": {
    "id": "77777777-7777-4777-8777-777777777701",
    "studentId": "44444444-4444-4444-8444-444444444402",
    "date": "2026-10-21",
    "items": [
      {
        "conceptId": "33333333-3333-4333-8333-333333333317",
        "confidence": 0.35,
        "band": "red",
        "reviewState": "current",
        "completed": true
      },
      {
        "conceptId": "33333333-3333-4333-8333-333333333318",
        "confidence": 0.35,
        "band": "red",
        "reviewState": "unreviewed",
        "completed": false
      },
      {
        "conceptId": "33333333-3333-4333-8333-333333333319",
        "confidence": 0.50,
        "band": "yellow",
        "reviewState": "current",
        "completed": false
      }
    ],
    "clearedAt": null,
    "version": 2
  }
}
```

### `GET /api/courses/:courseId/students/effort` (Response)
```json
[
  {
    "studentId": "44444444-4444-4444-8444-444444444402",
    "name": "Rahul Verma",
    "xp": 508,
    "averageConfidence": 0.38,
    "flag": "high_effort_low_mastery"
  },
  {
    "studentId": "44444444-4444-4444-8444-444444444401",
    "name": "Hari Ram",
    "xp": 620,
    "averageConfidence": 0.82,
    "flag": null
  }
]
```

### `game:updated` (Socket Event Payload)
```json
{
  "eventId": "66666666-6666-4666-8666-666666666604",
  "occurredAt": "2026-10-21T14:35:00.000Z",
  "studentId": "44444444-4444-4444-8444-444444444402",
  "updatedAt": "2026-10-21T14:35:00.000Z",
  "summary": {
    "studentId": "44444444-4444-4444-8444-444444444402",
    "courseId": "22222222-2222-4222-8222-222222222222",
    "xp": 508,
    "streakDays": 3,
    "skyBrightness": 0.60,
    "form": "glow",
    "formProgress": 0.25,
    "updatedAt": "2026-10-21T14:35:00.000Z"
  },
  "dailyQuest": {
    "id": "77777777-7777-4777-8777-777777777701",
    "studentId": "44444444-4444-4444-8444-444444444402",
    "date": "2026-10-21",
    "items": [
      {
        "conceptId": "33333333-3333-4333-8333-333333333317",
        "confidence": 0.35,
        "band": "red",
        "reviewState": "current",
        "completed": true
      }
    ],
    "clearedAt": null,
    "version": 2
  }
}
```

### `party:quest-updated` (Socket Event Payload)
```json
{
  "eventId": "66666666-6666-4666-8666-666666666605",
  "occurredAt": "2026-10-21T15:10:00.000Z",
  "matchId": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  "partyQuestId": "99999999-9999-4999-8999-999999999901",
  "version": 2,
  "status": "completed",
  "completedPairs": 2,
  "totalPairs": 2
}
```
