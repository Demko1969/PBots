import type { ComponentProps } from "react";

export default function Image({ priority, unoptimized, ...props }: ComponentProps<"img"> & {
  priority?: boolean;
  unoptimized?: boolean;
}) {
  return <img {...props} fetchPriority={priority ? "high" : undefined} />;
}
