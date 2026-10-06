"use client";

import { useEffect } from "react";
import { refreshEdgeRegistration } from "@/lib/edgePush";

/**
 * Re-sends this device's push registration (mode, timezone, demo-alert
 * setting) once per app load, on any page — so the push server always
 * knows whether this phone is in Demo or Live even if the user never
 * revisits the Notifications page. No-op without a subscription.
 */
export function PushRegistrationRefresher() {
  useEffect(() => { refreshEdgeRegistration().catch(() => {}); }, []);
  return null;
}
