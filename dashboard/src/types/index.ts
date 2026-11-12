// Kyro Dashboard — Shared Types

// ─── Occupancy ──────────────────────────────────────────────────────────────

export type OccupancyState =
  | "occupied"
  | "temporarily_vacant"
  | "likely_available"
  | "available"
  | "reserved"
  | "rota_hold"
  | "unknown";

// ─── Live pipeline ───────────────────────────────────────────────────────────

export interface AttendanceMetrics {
  current: number;
  peak: number;
  entries: number;
  exits: number;
  occupancy_pct: number;
}

export interface SeatState {
  seat_id: string;
  row: string;
  number: number;
  section: string;
  state: OccupancyState;
  confidence: number;
  occupying_track_id: number | null;
  bbox: [number, number, number, number];
  reserved?: boolean;
  reserved_for?: string | null;
  in_exclusion_zone?: boolean;
  vacancy_seconds?: number;   // how long seat has been vacant — shown as live timer in UI
}

export interface PipelineUpdate {
  camera_id: string;
  frame_number: number;
  timestamp: number;
  attendance: AttendanceMetrics;
  seat_states: SeatState[];
  perf: {
    inference_ms: number;
    total_ms: number;
  };
}

// ─── Live review ─────────────────────────────────────────────────────────────

export interface ReviewRequest {
  type: "review_request";
  review_id: string;
  camera_id: string;
  /**
   * The kinds of question Kyro asks. The last two come from the register of
   * people and carry PICTURES — two for a same-person question, one for "is
   * this a person?" — and they were missing from this list, so anything
   * reading it believed they could not happen and the panel drew no picture
   * at all. See LiveSnapshot in ReviewPanel.tsx.
   */
  review_type: "stage_question" | "front_rush_question" | "absence_question" | "zone_proposal" | "altar_call_question"
    | "same_person_question" | "is_this_a_person";
  /** Which role should see this question — "admin" for spatial, "operator" for people */
  target_role: "admin" | "operator";
  question: string;
  track_id: number;
  seat_id: string | null;
  position: [number, number];
  bbox_hint: number[] | null;
  confidence: number;
  best_guess: string | null;
  options: string[];
  created_at: number;
}

export interface ZoneProposal {
  type: "zone_proposals";
  camera_id: string;
  proposals: { cx: number; cy: number; confirmations: number }[];
}

// ─── Camera management ───────────────────────────────────────────────────────

export interface Camera {
  camera_id: string;
  name: string;
  stream_url: string;
  /** "indoor" (a room), "entrance" (a doorway) or "queue" (outside). */
  location: string | null;
  /** For a doorway camera: which way people are walking when they come in. */
  inward?: "closer" | "away" | "left" | "right";
  zone_name: string | null;
  zone_capacity: number;
  zone_order: number;
  is_active: boolean;
  created_at: string;
}

export interface ZoneLive {
  camera_id: string;
  zone_name: string;
  camera_name: string;
  current: number;
  peak: number;
  entries: number;
  exits: number;
  capacity: number;
  occupancy_pct: number;
  is_running: boolean;
  /** "online" | "offline" | "error" — error means frames are flowing but
   *  look blank/frozen (camera physically failed without being detected
   *  as disconnected). */
  status: string;
  error_reason: string | null;
  /** false for a camera counting in a browser: it counts each picture rather
   *  than following people, so it has no in/out. */
  in_out?: boolean;
  /**
   * Where the capacity came from: "admin" when somebody entered it, "found"
   * when the seat finder guessed it from the picture, null when there isn't
   * one. A guess is shown as a guess and drives nothing — see syncCapacity in
   * worker/venue.js.
   */
  capacity_from?: "admin" | "found" | null;
  /** Where the camera is pointed: a room, a queue, or the entrance. */
  location?: string;
  /** Counts a second this camera is managing, and how many it needs for in/out. */
  fps?: number;
  fps_needed?: number;
}

export interface VenueTotal {
  total_current: number;
  total_peak: number;
  /** null when no camera can follow people reliably — never show a made-up figure. */
  total_entries: number | null;
  total_exits: number | null;
  total_capacity: number;
  venue_occupancy_pct: number;
  zones: ZoneLive[];
  cameras_running: number;
  cameras_total: number;
  /**
   * When the arrivals and departures above started counting from, after
   * someone asked for a fresh start. null means everything the cameras have
   * counted.
   */
  count_from?: string | null;
  /**
   * People in the building, counted at the door: everyone in today less
   * everyone out. null when no camera is on a door, or it isn't counting fast
   * enough to follow people through one.
   */
  in_building?: number | null;
  /** True when the arrivals and departures came from a camera on a doorway. */
  in_out_from_door?: boolean;
  /** The door's whole-day running totals, which in_building is made of. */
  came_in_all?: number | null;
  went_out_all?: number | null;
  /**
   * What the church's own rota says is happening, now and next.
   *
   * Sent with the figures on purpose: "is Kyro aware of my rota?" is answered
   * by seeing the rota and the count agree on one screen, not by opening a
   * second page to check. See whatsOn() in worker/venue.js.
   */
  whats_on?: WhatsOn | null;
  /** The service being recorded right now, if one is. */
  service_now?: { id: string; name: string; started_at: string; from_rota: boolean } | null;
}

export interface RotaWhen {
  entry_id: string;
  label: string;
  start_time: string;
  end_time: string;
}

export interface WhatsOn {
  /** Everything the rota says is on at this moment. */
  on: RotaWhen[];
  /** What to call it: whichever of them started first. */
  now: RotaWhen | null;
  /** When the last of them finishes (epoch ms). */
  until: number | null;
  /** The next thing on the rota, within the next twelve hours. */
  next: RotaWhen | null;
}

export interface CameraStatus {
  camera_id: string;
  is_running: boolean;
  status: string;
  error_reason: string | null;
  last_frame_timestamp: number | null;
  fps_actual: number | null;
  inference_ms: number | null;
  total_connections: number;
}

// ─── Seat layouts ────────────────────────────────────────────────────────────

export interface SeatDefinition {
  seat_id: string;
  row: string;
  number: number;
  section: string;
  bbox: [number, number, number, number];
}

export interface SeatLayout {
  id: number;
  camera_id: string;
  name: string;
  is_active: boolean;
  seat_count: number;
  created_at: string;
  seats: SeatDefinition[];
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface AttendancePoint {
  timestamp: string;
  attendance: number;
  occupancy_pct: number;
}

export interface WeeklyBucket {
  week_start: string;
  avg_attendance: number;
  peak_attendance: number;
  total_sessions: number;
}

export interface HeatmapData {
  camera_id: string;
  grid: number[][];
  rows: number;
  cols: number;
}

export interface HourlyBucket {
  hour: number;
  /** People who arrived in this hour. */
  count: number;
  avg_count: number;
  /** People who left in this hour. Absent on an older deployment. */
  exits?: number;
  avg_exits?: number;
}

export interface AnalyticsSummary {
  camera_id: string;
  total_sessions: number;
  all_time_peak: number;
  /** Days whose attendance is being shown held at what the room holds,
   *  and what was counted on them. See attendance_held_at in worker/venue.js. */
  days_held?: number;
  counted_before_holding?: number;
  seats_in_building?: number;
  avg_attendance: number;
  avg_occupancy_pct: number;
  first_session: string | null;
  last_session: string | null;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface MeResponse {
  username: string;
  display_name: string;
  role: string;
  authenticated_at: string;
}

// ─── Users ───────────────────────────────────────────────────────────────────

export interface UserResponse {
  id: number;
  username: string;
  display_name: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
}

// ─── Attendance sessions ──────────────────────────────────────────────────────

export interface LiveMetrics {
  camera_id: string;
  current_attendance: number;
  peak_attendance: number;
  total_entries: number;
  total_exits: number;
  occupancy_percent: number;
  timestamp: number;
}

export interface AlertResponse {
  camera_id: string;
  alert: boolean;
  message: string;
  current_attendance: number;
  venue_capacity: number;
  occupancy_percent: number;
}

export interface SessionResponse {
  session_id: string;
  camera_id: string;
  name: string;
  started_at: string;
  ended_at: string | null;
  venue_capacity: number;
  peak_attendance: number;
  total_entries: number;
  total_exits: number;
}
