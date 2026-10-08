"use client";

import { CrashRecovery } from "@/components/ui/CrashRecovery";

// Catches errors in the root layout itself (providers, overlays), which
// error.tsx can't — so it has to render its own <html> and <body>.
export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <CrashRecovery {...props} />
      </body>
    </html>
  );
}
