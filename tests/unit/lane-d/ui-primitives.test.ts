import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Modal,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalContent,
  ModalFooter,
  ModalCloseButton,
  Input,
} from "../../../src/components/ui/index.js";

describe("Lane D: UI Component Primitives - Headless Rendering (P0-D-01)", () => {
  describe("Button Primitive", () => {
    it("renders default primary button with correct type and classes", () => {
      const html = renderToString(React.createElement(Button, null, "Click Me"));
      expect(html).toContain("<button");
      expect(html).toContain('type="button"');
      expect(html).toContain("Click Me");
      expect(html).toContain("bg-[#ed793c]");
    });

    it("renders destructive variant and large size", () => {
      const html = renderToString(
        React.createElement(Button, { variant: "destructive", size: "lg" }, "Delete")
      );
      expect(html).toContain("bg-[#b0384a]");
      expect(html).toContain("h-12");
      expect(html).toContain("Delete");
    });

    it("renders loading spinner and sets aria-busy='true' and disabled attribute", () => {
      const html = renderToString(
        React.createElement(Button, { isLoading: true }, "Submit")
      );
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain("disabled");
      expect(html).toContain("<svg");
      expect(html).toContain("animate-spin");
    });

    it("disables button when disabled prop is provided", () => {
      const html = renderToString(
        React.createElement(Button, { disabled: true }, "Disabled")
      );
      expect(html).toContain("disabled");
    });
  });

  describe("Badge Primitive", () => {
    it("renders default badge with children text", () => {
      const html = renderToString(React.createElement(Badge, null, "New"));
      expect(html).toContain("<span");
      expect(html).toContain("New");
    });

    it("renders mastery band badge with accessible aria-label and status label", () => {
      const html = renderToString(
        React.createElement(Badge, { mastery: "green", confidence: 0.85 })
      );
      expect(html).toContain('aria-label="Mastered (85%)"');
      expect(html).toContain("Mastered (85%)");
      expect(html).toContain("background-color:#2b7f55");
    });

    it("renders active concept pulse ring when isActiveConcept is true", () => {
      const html = renderToString(
        React.createElement(Badge, {
          mastery: "yellow",
          confidence: 0.5,
          isActiveConcept: true,
        })
      );
      expect(html).toContain("animate-active-concept");
      expect(html).toContain("ring-[#c85c22]");
    });

    it("renders solid mastery variant with dark text for high contrast", () => {
      const html = renderToString(
        React.createElement(Badge, {
          mastery: "yellow",
          variant: "solid",
        })
      );
      expect(html).toContain("bg-[#f4bc55]");
      expect(html).toContain("text-[#2b2a2e]");
    });
  });

  describe("Card Primitive", () => {
    it("renders composite card with header, title, description, content, and footer", () => {
      const element = React.createElement(
        Card,
        null,
        React.createElement(
          CardHeader,
          null,
          React.createElement(CardTitle, { as: "h2" }, "Lecture 01"),
          React.createElement(CardDescription, null, "Introduction to Algorithms")
        ),
        React.createElement(CardContent, null, React.createElement("p", null, "Topics covered")),
        React.createElement(CardFooter, null, React.createElement(Button, null, "Join"))
      );

      const html = renderToString(element);
      expect(html).toContain("<h2");
      expect(html).toContain("Lecture 01");
      expect(html).toContain("Introduction to Algorithms");
      expect(html).toContain("Topics covered");
      expect(html).toContain("Join");
      expect(html).toContain("rounded-xl border");
    });
  });

  describe("Modal Primitive", () => {
    it("renders nothing when isOpen is false", () => {
      const element = React.createElement(
        Modal,
        { isOpen: false, onClose: () => {} },
        React.createElement("div", null, "Hidden Content")
      );

      const html = renderToString(element);
      expect(html).toBe("");
    });

    it("renders accessible dialog attributes when isOpen is true", () => {
      const element = React.createElement(
        Modal,
        {
          isOpen: true,
          onClose: () => {},
          titleId: "test-dialog-title",
          descriptionId: "test-dialog-desc",
        },
        React.createElement(
          ModalHeader,
          null,
          React.createElement(ModalTitle, { id: "test-dialog-title" }, "Active Poll"),
          React.createElement(ModalDescription, { id: "test-dialog-desc" }, "Question details")
        ),
        React.createElement(ModalContent, null, React.createElement("p", null, "Poll content")),
        React.createElement(
          ModalFooter,
          null,
          React.createElement(Button, null, "Submit Response")
        ),
        React.createElement(ModalCloseButton, { onClose: () => {} })
      );

      const html = renderToString(element);
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('aria-labelledby="test-dialog-title"');
      expect(html).toContain('aria-describedby="test-dialog-desc"');
      expect(html).toContain("Active Poll");
      expect(html).toContain("Question details");
      expect(html).toContain('aria-label="Close"');
    });
  });

  describe("Input Primitive", () => {
    it("renders input with associated label and description", () => {
      const element = React.createElement(Input, {
        id: "course-join-code",
        label: "Join Code",
        description: "Enter the 6-character alphanumeric course join code",
        placeholder: "e.g. CS101A",
      });

      const html = renderToString(element);
      expect(html).toContain('<label for="course-join-code"');
      expect(html).toContain("Join Code");
      expect(html).toContain('id="course-join-code"');
      expect(html).toContain('aria-describedby="course-join-code-desc"');
      expect(html).toContain('id="course-join-code-desc"');
    });

    it("renders error message with role='alert' and sets aria-invalid='true'", () => {
      const element = React.createElement(Input, {
        id: "student-email",
        label: "Email",
        error: "Please enter a valid university email address",
      });

      const html = renderToString(element);
      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain('role="alert"');
      expect(html).toContain("Please enter a valid university email address");
      expect(html).toContain("border-[#b0384a]");
    });
  });
});
