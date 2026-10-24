"use client";

import * as React from "react";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

export interface ModalProps extends React.HTMLAttributes<HTMLDivElement> {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  size?: ModalSize;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  ariaLabel?: string;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
  full: "max-w-4xl",
};

export const Modal = React.forwardRef<HTMLDivElement, ModalProps>(
  (
    {
      isOpen,
      onClose,
      title,
      description,
      size = "md",
      closeOnEscape = true,
      closeOnBackdrop = true,
      ariaLabel,
      className = "",
      children,
      ...props
    },
    ref
  ) => {
    // Keyboard Escape listener (docs/09-frontend.md section 4.2)
    React.useEffect(() => {
      if (!isOpen || !closeOnEscape) return;

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      };

      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
      };
    }, [isOpen, closeOnEscape, onClose]);

    if (!isOpen) {
      return null;
    }

    const titleId = title ? "modal-title" : undefined;
    const descId = description ? "modal-description" : undefined;

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
        role="presentation"
      >
        {/* Backdrop overlay */}
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
          aria-hidden="true"
          onClick={closeOnBackdrop ? onClose : undefined}
        />

        {/* Dialog panel */}
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel || title}
          aria-labelledby={titleId}
          aria-describedby={descId}
          className={`relative z-10 w-full overflow-hidden rounded-2xl bg-white p-6 text-left shadow-xl transition-all border border-slate-200 ${sizeClasses[size]} ${className}`.trim()}
          {...props}
        >
          {/* Header if title or description provided */}
          {(title || description) && (
            <div className="mb-4">
              {title && (
                <h2
                  id={titleId}
                  className="text-lg font-semibold leading-6 text-slate-900"
                >
                  {title}
                </h2>
              )}
              {description && (
                <p id={descId} className="mt-1 text-sm text-slate-500">
                  {description}
                </p>
              )}
            </div>
          )}

          {/* Close button in top-right */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="absolute top-4 right-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 cursor-pointer"
          >
            <span className="sr-only">Close</span>
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>

          {children}
        </div>
      </div>
    );
  }
);
Modal.displayName = "Modal";

export type ModalHeaderProps = React.HTMLAttributes<HTMLDivElement>;

export const ModalHeader = React.forwardRef<HTMLDivElement, ModalHeaderProps>(
  ({ className = "", children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`flex flex-col space-y-1.5 pb-4 ${className}`.trim()}
        {...props}
      >
        {children}
      </div>
    );
  }
);
ModalHeader.displayName = "ModalHeader";

export type ModalTitleProps = React.HTMLAttributes<HTMLHeadingElement>;

export const ModalTitle = React.forwardRef<HTMLHeadingElement, ModalTitleProps>(
  ({ className = "", children, ...props }, ref) => {
    return (
      <h2
        ref={ref}
        className={`text-lg font-semibold leading-6 text-slate-900 ${className}`.trim()}
        {...props}
      >
        {children}
      </h2>
    );
  }
);
ModalTitle.displayName = "ModalTitle";

export type ModalDescriptionProps = React.HTMLAttributes<HTMLParagraphElement>;

export const ModalDescription = React.forwardRef<
  HTMLParagraphElement,
  ModalDescriptionProps
>(({ className = "", children, ...props }, ref) => {
  return (
    <p
      ref={ref}
      className={`text-sm text-slate-500 leading-relaxed ${className}`.trim()}
      {...props}
    >
      {children}
    </p>
  );
});
ModalDescription.displayName = "ModalDescription";

export type ModalContentProps = React.HTMLAttributes<HTMLDivElement>;

export const ModalContent = React.forwardRef<HTMLDivElement, ModalContentProps>(
  ({ className = "", children, ...props }, ref) => {
    return (
      <div ref={ref} className={`py-2 ${className}`.trim()} {...props}>
        {children}
      </div>
    );
  }
);
ModalContent.displayName = "ModalContent";

export type ModalFooterProps = React.HTMLAttributes<HTMLDivElement>;

export const ModalFooter = React.forwardRef<HTMLDivElement, ModalFooterProps>(
  ({ className = "", children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`flex items-center justify-end space-x-3 pt-4 border-t border-slate-100 ${className}`.trim()}
        {...props}
      >
        {children}
      </div>
    );
  }
);
ModalFooter.displayName = "ModalFooter";
