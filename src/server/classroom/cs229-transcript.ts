export interface LectureScriptChunk {
  readonly text: string;
  readonly timestampSec: number;
  readonly speakerName?: string;
}

export const CS229_TRANSCRIPT_SCRIPT: readonly LectureScriptChunk[] = [
  {
    timestampSec: 0,
    speakerName: "CS229 simulator",
    text: "Today we study gradient descent for minimizing a loss function.",
  },
  {
    timestampSec: 4,
    speakerName: "CS229 simulator",
    text: "The gradient gives the direction of steepest increase in the loss.",
  },
  {
    timestampSec: 8,
    speakerName: "CS229 simulator",
    text: "Gradient descent updates parameters in the opposite direction of the gradient.",
  },
  {
    timestampSec: 12,
    speakerName: "CS229 simulator",
    text: "The learning rate controls the size of each parameter update.",
  },
  {
    timestampSec: 16,
    speakerName: "CS229 simulator",
    text: "A computational graph records how intermediate values depend on model parameters.",
  },
  {
    timestampSec: 20,
    speakerName: "CS229 simulator",
    text: "Backpropagation applies the chain rule through that graph to compute gradients.",
  },
];
