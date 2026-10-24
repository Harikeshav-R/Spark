# AI Pipelines & Prompt Contracts: Anthropic & Perplexity

This document specifies the prompt engineering standards, output Zod schemas, token ceilings, SLAs, and failure handling across all 13 AI capabilities.

---

## 1. Governance & Execution Architecture

1. **Dual-Model Strategy**:
   - `ANTHROPIC_FAST_MODEL`: Used for real-time, low-latency tasks (concept detection, understanding checks, prompt grading). Defaults to `claude-3-5-haiku-latest`.
   - `ANTHROPIC_DEEP_MODEL`: Used for complex curriculum extraction, pedagogical synthesis, and learning content generation. Defaults to `claude-3-7-sonnet-latest`.
2. **Search Model**:
   - `PERPLEXITY_MODEL`: Used for cited academic resource search. Defaults to `sonar-pro`.
3. **Strict Structured Output Validation**: Every pipeline passes raw model text through a Zod schema parser.
4. **Honest Failure Principle**: Malformed JSON, provider timeouts, or rate limits NEVER fall back to simulated grades or canned responses. They return explicit typed errors (`502 Bad Gateway` or `504 Gateway Timeout`).

---

## 2. Capability Catalog & Specifications

### 2.1 `extractPrerequisiteGraph`
- **Model**: `ANTHROPIC_DEEP_MODEL`
- **Timeout**: 120 seconds | **Max Tokens**: 4,000
- **Input**: Extracted text/bytes from first `min(pageCount, 10)` pages of syllabus PDF.
- **System Prompt**:
  > You are an expert university curriculum designer. Analyze this course syllabus and extract a prerequisite knowledge graph as a Directed Acyclic Graph (DAG). Extract 30 to 40 broad foundational concepts. Group fine-grained subtopics into major concepts. Edges MUST represent strict prerequisite relationships where concept A must be learned before concept B. Output ONLY valid JSON.
- **Output Zod Schema**:
  ```typescript
  z.object({
    concepts: z.array(z.object({
      label: z.string().min(1).max(100),
      description: z.string().min(10).max(500),
      category: z.string().min(1).max(50),
      difficulty: z.number().int().min(1).max(5)
    })).min(1).max(40),
    edges: z.array(z.tuple([z.string(), z.string()]))
  })
  ```

### 2.2 `detectConcepts`
- **Model**: `ANTHROPIC_FAST_MODEL`
- **Timeout**: 5 seconds | **Max Tokens**: 300
- **Input**: Recent transcript text window (last 60–90 seconds) and candidate concept labels.
- **System Prompt**:
  > Given the lecture speech excerpt and the list of course concept labels, return the IDs of concepts actively explained or discussed. Only return concepts directly substantiated by the text.
- **Output Zod Schema**:
  ```typescript
  z.object({
    conceptIds: z.array(z.string().uuid())
  })
  ```

### 2.3 `generatePollQuestion`
- **Model**: `ANTHROPIC_FAST_MODEL`
- **Timeout**: 15 seconds | **Max Tokens**: 600
- **Input**: Target concept description and recent transcript chunks.
- **System Prompt**:
  > Generate an open-ended conceptual comprehension question based on the concept and recent lecture context. Test causal reasoning or mechanism understanding, not simple terminology recall. Provide the ideal expected answer rubric.
- **Output Zod Schema**:
  ```typescript
  z.object({
    question: z.string().min(15).max(500),
    expectedAnswer: z.string().min(15).max(1000)
  })
  ```

### 2.4 `evaluatePollResponse`
- **Model**: `ANTHROPIC_FAST_MODEL`
- **Timeout**: 8 seconds | **Max Tokens**: 500
- **Input**: Question, expected answer rubric, and student's free-form answer.
- **System Prompt**:
  > Evaluate the student's answer against the expected answer rubric. Classify outcome as "correct", "partial", or "wrong". Provide concise pedagogical feedback explaining strengths and misconceptions.
- **Output Zod Schema**:
  ```typescript
  z.object({
    outcome: z.enum(["correct", "partial", "wrong"]),
    feedback: z.string().min(5).max(500)
  })
  ```

### 2.5 `socraticTutorTurn`
- **Model**: `ANTHROPIC_DEEP_MODEL`
- **Timeout**: 15 seconds | **Max Tokens**: 800
- **Input**: Target concept context, multi-turn message history, and new student query.
- **System Prompt**:
  > You are an encouraging Socratic tutor. Never provide direct answers or solutions. Guide the student to discover principles through targeted, incremental questions. If the student demonstrates a clear conceptual breakthrough, set understandingDetected to true.
- **Output Zod Schema**:
  ```typescript
  z.object({
    assistantResponse: z.string().min(10).max(1500),
    understandingDetected: z.boolean()
  })
  ```

### 2.6 `checkUnderstanding`
- **Model**: `ANTHROPIC_FAST_MODEL`
- **Timeout**: 5 seconds | **Max Tokens**: 200
- **Input**: Concept definition, tutor question, and student's latest reply.
- **Output Zod Schema**:
  ```typescript
  z.object({
    understandingConfirmed: z.boolean(),
    rationale: z.string().max(250)
  })
  ```

### 2.7 `summarizeMisconceptions`
- **Model**: `ANTHROPIC_FAST_MODEL`
- **Timeout**: 8 seconds | **Max Tokens**: 800
- **Input**: Poll question, expected rubric, and array of student answers with `wrong`/`partial` outcomes.
- **Output Zod Schema**:
  ```typescript
  z.object({
    misconceptions: z.array(z.string().min(5).max(200)),
    recommendations: z.array(z.object({
      title: z.string().min(3).max(100),
      description: z.string().min(10).max(300),
      actionablePrompt: z.string().min(10).max(300)
    }))
  })
  ```

### 2.8 `summarizeLecture`
- **Model**: `ANTHROPIC_DEEP_MODEL`
- **Timeout**: 15 seconds | **Max Tokens**: 1,500
- **Input**: Complete lecture transcript chunks with timestamps.
- **Output Zod Schema**:
  ```typescript
  z.object({
    summary: z.string().min(100).max(3000),
    keyConceptsCovered: z.array(z.string().uuid()),
    timelineHighlights: z.array(z.object({
      timestampSec: z.number().nonnegative(),
      conceptLabel: z.string(),
      description: z.string()
    }))
  })
  ```

### 2.9 `suggestInterventions`
- **Model**: `ANTHROPIC_DEEP_MODEL`
- **Timeout**: 30 seconds | **Max Tokens**: 1,200
- **Input**: Aggregate lecture stats, poll results, and active concept prerequisites.
- **Output Zod Schema**:
  ```typescript
  z.object({
    misconceptions: z.array(z.string()),
    recommendations: z.array(z.object({
      title: z.string(),
      description: z.string(),
      actionablePrompt: z.string()
    }))
  })
  ```

### 2.10 `generateLearningPage`
- **Model**: `ANTHROPIC_DEEP_MODEL`
- **Timeout**: 60 seconds | **Max Tokens**: 3,500
- **Input**: Concept label, description, category, and prerequisite ancestors.
- **Output Zod Schema**:
  ```typescript
  z.object({
    content: z.string().min(500).max(15000) // Formatted Markdown with KaTeX math
  })
  ```

### 2.11 `generateQuizQuestions`
- **Model**: `ANTHROPIC_DEEP_MODEL`
- **Timeout**: 60 seconds | **Max Tokens**: 2,500
- **Input**: Concept label, description, and learning content.
- **Output Zod Schema**:
  ```typescript
  z.object({
    questions: z.array(z.object({
      question: z.string().min(10).max(500),
      optionA: z.string().min(1).max(200),
      optionB: z.string().min(1).max(200),
      optionC: z.string().min(1).max(200),
      optionD: z.string().min(1).max(200),
      correctAnswer: z.number().int().min(0).max(3),
      explanation: z.string().min(10).max(500)
    })).length(5)
  })
  ```

### 2.12 `searchAcademicResources`
- **Provider**: Perplexity AI (`PERPLEXITY_MODEL`)
- **Timeout**: 10 seconds | **Max Tokens**: 1,000
- **Input**: Concept label and optional search query.
- **Output Zod Schema**:
  ```typescript
  z.object({
    resources: z.array(z.object({
      title: z.string(),
      url: z.string().url(),
      snippet: z.string(),
      citationNumber: z.number().int().positive()
    }))
  })
  ```

### 2.13 `answerResourceQuestion`
- **Provider**: Perplexity AI (`PERPLEXITY_MODEL`)
- **Timeout**: 10 seconds | **Max Tokens**: 1,200
- **Input**: Concept context and student inquiry.
- **Output Zod Schema**:
  ```typescript
  z.object({
    answer: z.string().min(10),
    citations: z.array(z.object({
      number: z.number().int().positive(),
      title: z.string(),
      url: z.string().url()
    }))
  })
  ```
