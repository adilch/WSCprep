import type { ReactNode } from "react";

type Variant = "green" | "gray" | "amber" | "red" | "blue";

const styles: Record<Variant, string> = {
  green: "bg-green-100 text-green-800",
  gray: "bg-gray-100 text-gray-600",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  blue: "bg-blue-100 text-blue-800",
};

export function Badge({ children, variant = "gray" }: { children: ReactNode; variant?: Variant }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[variant]}`}>
      {children}
    </span>
  );
}
