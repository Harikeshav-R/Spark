import * as React from "react";
import { type MasteryBand, MASTERY_PALETTE } from "./tokens.js";

export type CardVariant = "default" | "outline" | "mastery";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  band?: MasteryBand;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      variant = "default",
      band = "gray",
      className = "",
      style,
      children,
      ...props
    },
    ref
  ) => {
    const customStyle: React.CSSProperties | undefined =
      variant === "mastery"
        ? {
            backgroundColor: MASTERY_PALETTE[band].softBg,
            borderColor: MASTERY_PALETTE[band].border,
            color: MASTERY_PALETTE[band].softText,
            ...style,
          }
        : style;

    const variantClasses =
      variant === "outline"
        ? "bg-transparent text-slate-900 border-2 border-slate-300"
        : variant === "mastery"
          ? "border shadow-xs"
          : "bg-white text-slate-900 border border-slate-200 shadow-xs";

    return (
      <div
        ref={ref}
        className={`rounded-xl ${variantClasses} ${className}`.trim()}
        style={customStyle}
        {...props}
      >
        {children}
      </div>
    );
  }
);
Card.displayName = "Card";

export type CardHeaderProps = React.HTMLAttributes<HTMLDivElement>;

export const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className = "", children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`flex flex-col space-y-1.5 p-6 ${className}`.trim()}
        {...props}
      >
        {children}
      </div>
    );
  }
);
CardHeader.displayName = "CardHeader";

export interface CardTitleProps
  extends React.HTMLAttributes<HTMLHeadingElement> {
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
}

export const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ as: Tag = "h3", className = "", children, ...props }, ref) => {
    return (
      <Tag
        ref={ref}
        className={`font-semibold text-lg leading-none tracking-tight text-slate-900 ${className}`.trim()}
        {...props}
      >
        {children}
      </Tag>
    );
  }
);
CardTitle.displayName = "CardTitle";

export type CardDescriptionProps = React.HTMLAttributes<HTMLParagraphElement>;

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  CardDescriptionProps
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
CardDescription.displayName = "CardDescription";

export type CardContentProps = React.HTMLAttributes<HTMLDivElement>;

export const CardContent = React.forwardRef<HTMLDivElement, CardContentProps>(
  ({ className = "", children, ...props }, ref) => {
    return (
      <div ref={ref} className={`p-6 pt-0 ${className}`.trim()} {...props}>
        {children}
      </div>
    );
  }
);
CardContent.displayName = "CardContent";

export type CardFooterProps = React.HTMLAttributes<HTMLDivElement>;

export const CardFooter = React.forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className = "", children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`flex items-center p-6 pt-0 ${className}`.trim()}
        {...props}
      >
        {children}
      </div>
    );
  }
);
CardFooter.displayName = "CardFooter";
