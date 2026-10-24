import { describe, it, expect } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
  Modal,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalContent,
  ModalFooter,
} from "../../../src/components/ui/index.js";

describe("Lane D: UI Component Primitives Headless Rendering (P0-D-01)", () => {
  describe("1. Button Component", () => {
    it("renders default button with text and standard attributes", () => {
      const html = renderToString(
        React.createElement(Button, { type: "submit" }, "Click Me")
      );
      expect(html).toContain("Click Me");
      expect(html).toContain('type="submit"');
      expect(html).toContain("bg-sky-600");
    });

    it("renders secondary, outline, destructive, ghost, and link variants", () => {
      const secondaryHtml = renderToString(
        React.createElement(Button, { variant: "secondary" }, "Secondary")
      );
      expect(secondaryHtml).toContain("bg-slate-100");

      const outlineHtml = renderToString(
        React.createElement(Button, { variant: "outline" }, "Outline")
      );
      expect(outlineHtml).toContain("border-slate-300");

      const destructiveHtml = renderToString(
        React.createElement(Button, { variant: "destructive" }, "Delete")
      );
      expect(destructiveHtml).toContain("bg-red-600");

      const ghostHtml = renderToString(
        React.createElement(Button, { variant: "ghost" }, "Ghost")
      );
      expect(ghostHtml).toContain("hover:bg-slate-100");

      const linkHtml = renderToString(
        React.createElement(Button, { variant: "link" }, "Link")
      );
      expect(linkHtml).toContain("hover:underline");
    });

    it("renders mastery band variant with WCAG-compliant solid styling", () => {
      const greenHtml = renderToString(
        React.createElement(
          Button,
          { variant: "mastery", band: "green" },
          "Mastered Action"
        )
      );
      expect(greenHtml).toContain("background-color:#047857");
      expect(greenHtml).toContain("color:#FFFFFF");

      const yellowHtml = renderToString(
        React.createElement(
          Button,
          { variant: "mastery", band: "yellow" },
          "Yellow Action"
        )
      );
      expect(yellowHtml).toContain("background-color:#F59E0B");
      expect(yellowHtml).toContain("color:#000000");
    });

    it("applies size classes correctly", () => {
      const smHtml = renderToString(
        React.createElement(Button, { size: "sm" }, "Small")
      );
      expect(smHtml).toContain("h-8");

      const lgHtml = renderToString(
        React.createElement(Button, { size: "lg" }, "Large")
      );
      expect(lgHtml).toContain("h-12");

      const iconHtml = renderToString(
        React.createElement(Button, { size: "icon" }, "★")
      );
      expect(iconHtml).toContain("h-10 w-10");
    });

    it("renders loading state with spinner, aria-busy, and disables click", () => {
      const loadingHtml = renderToString(
        React.createElement(
          Button,
          { isLoading: true, loadingText: "Submitting..." },
          "Submit"
        )
      );
      expect(loadingHtml).toContain('aria-busy="true"');
      expect(loadingHtml).toContain('disabled=""');
      expect(loadingHtml).toContain("Submitting...");
      expect(loadingHtml).toContain("animate-spin");
    });

    it("renders icons when supplied", () => {
      const iconHtml = renderToString(
        React.createElement(
          Button,
          {
            leftIcon: React.createElement("span", { id: "left-icon" }, "L"),
            rightIcon: React.createElement("span", { id: "right-icon" }, "R"),
          },
          "With Icons"
        )
      );
      expect(iconHtml).toContain('id="left-icon"');
      expect(iconHtml).toContain('id="right-icon"');
    });
  });

  describe("2. Card Component Hierarchy", () => {
    it("renders complete card structure with semantic header, content, and footer", () => {
      const html = renderToString(
        React.createElement(
          Card,
          null,
          React.createElement(
            CardHeader,
            null,
            React.createElement(CardTitle, null, "Card Title"),
            React.createElement(CardDescription, null, "Card Description")
          ),
          React.createElement(CardContent, null, "Card Body Content"),
          React.createElement(
            CardFooter,
            null,
            React.createElement(Button, null, "Action")
          )
        )
      );

      expect(html).toContain("Card Title");
      expect(html).toContain("Card Description");
      expect(html).toContain("Card Body Content");
      expect(html).toContain("Action");
      expect(html).toContain("rounded-xl");
    });

    it("supports mastery card variant with soft background and border", () => {
      const html = renderToString(
        React.createElement(
          Card,
          { variant: "mastery", band: "green" },
          React.createElement(CardTitle, null, "Mastered Concept")
        )
      );
      expect(html).toContain("background-color:#ECFDF5");
      expect(html).toContain("border-color:#6EE7B7");
    });

    it("allows custom heading tag in CardTitle", () => {
      const html = renderToString(
        React.createElement(CardTitle, { as: "h2" }, "Heading 2 Title")
      );
      expect(html).toContain("<h2");
      expect(html).toContain("Heading 2 Title</h2>");
    });
  });

  describe("3. Badge Component", () => {
    it("renders default badge with role status", () => {
      const html = renderToString(
        React.createElement(Badge, null, "Default Badge")
      );
      expect(html).toContain('role="status"');
      expect(html).toContain("Default Badge");
      expect(html).toContain("bg-sky-100");
    });

    it("renders mastery band badge with high-contrast text and border", () => {
      const html = renderToString(
        React.createElement(Badge, { band: "red" })
      );
      expect(html).toContain("background-color:#FEF2F2");
      expect(html).toContain("color:#991B1B");
      expect(html).toContain('aria-label="Needs Practice (&lt;40%)"');
    });

    it("automatically derives mastery band and percentage label from confidence score", () => {
      const html = renderToString(
        React.createElement(Badge, { confidence: 0.85 })
      );
      expect(html).toContain("background-color:#ECFDF5");
      expect(html).toContain("color:#065F46");
      expect(html).toContain("Mastered (85%)");
    });

    it("renders active concept pulse animation for live lecture", () => {
      const html = renderToString(
        React.createElement(Badge, { band: "yellow", pulse: true }, "Active Concept")
      );
      expect(html).toContain("animate-active-concept");
    });
  });

  describe("4. Modal Component", () => {
    it("renders null when isOpen is false", () => {
      const html = renderToString(
        React.createElement(
          Modal,
          { isOpen: false, onClose: () => {} },
          "Hidden Modal"
        )
      );
      expect(html).toBe("");
    });

    it("renders accessible dialog with backdrop and close button when isOpen is true", () => {
      const html = renderToString(
        React.createElement(
          Modal,
          {
            isOpen: true,
            onClose: () => {},
            title: "Test Modal",
            description: "Test Description",
          },
          React.createElement("p", null, "Modal Content")
        )
      );

      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain("Test Modal");
      expect(html).toContain("Test Description");
      expect(html).toContain("Modal Content");
      expect(html).toContain('aria-label="Close dialog"');
    });

    it("renders structured subcomponents (Header, Title, Description, Content, Footer)", () => {
      const html = renderToString(
        React.createElement(
          Modal,
          { isOpen: true, onClose: () => {} },
          React.createElement(
            ModalHeader,
            null,
            React.createElement(ModalTitle, null, "Custom Title"),
            React.createElement(ModalDescription, null, "Custom Desc")
          ),
          React.createElement(ModalContent, null, "Body Content"),
          React.createElement(
            ModalFooter,
            null,
            React.createElement(Button, null, "Close")
          )
        )
      );

      expect(html).toContain("Custom Title");
      expect(html).toContain("Custom Desc");
      expect(html).toContain("Body Content");
    });
  });
});
