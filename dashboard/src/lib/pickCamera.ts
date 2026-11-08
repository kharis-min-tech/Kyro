/**
 * Working out which camera a saved record means.
 *
 * A camera plugged into this computer is stored as webcam://<deviceId>. That
 * identifier is not as dependable as it looks: the browser only hands it over
 * once camera access has been granted, it is scrambled per website, and Safari
 * changes it between sessions. Save a camera at a moment when the browser is
 * withholding it and the record keeps an empty one for good.
 *
 * The old code took that identifier or gave up, and reported giving up as
 * "needs HTTPS and MediaDevices" — so a camera that was plugged in, open and
 * counting showed a message about the website being insecure.
 *
 * The identifier is only the first thing to try. The camera's name is the
 * label the browser gave it when it was added, so it finds the camera again
 * when the identifier has moved on; and with only one camera on the computer
 * there is nothing to be confused about.
 */

export interface VideoDevice {
  deviceId: string;
  label: string;
}

export type HowFound = "id" | "name" | "only" | "none";

export interface Picked {
  /** null means open whatever the browser offers. */
  deviceId: string | null;
  how: HowFound;
}

/** The deviceId inside a webcam:// address, or "" if there isn't one. */
export function deviceIdFrom(streamUrl: string | undefined): string {
  if (!streamUrl || !streamUrl.startsWith("webcam://")) return "";
  return streamUrl.slice("webcam://".length).trim();
}

function tidy(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function pickCamera(
  streamUrl: string | undefined,
  cameraName: string | undefined,
  devices: VideoDevice[],
): Picked {
  const wanted = deviceIdFrom(streamUrl);
  if (wanted && devices.some((d) => d.deviceId === wanted)) {
    return { deviceId: wanted, how: "id" };
  }

  // The name it was saved under is the label the browser gave it. Matching
  // either way round covers a name the operator has since added words to.
  const name = tidy(cameraName ?? "");
  if (name) {
    const byName = devices.find((d) => {
      const label = tidy(d.label);
      return !!label && (label === name || name.includes(label) || label.includes(name));
    });
    if (byName) return { deviceId: byName.deviceId, how: "name" };
  }

  if (devices.length === 1) return { deviceId: devices[0].deviceId || null, how: "only" };

  return { deviceId: null, how: "none" };
}
