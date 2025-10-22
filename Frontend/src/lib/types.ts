
export type DispatchStatus = "running" | "finished" | "canceled";

export type Station = {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
};

export type PinUser = {
  id: number;
  name: string;
  enabled: boolean;
  tries: number;
  locked_until?: string | null;
  created_at: string;
  updated_at?: string | null;
};

export type PinSession = {
  id: number;
  pin_user_id: number;
  station_id: string;
  started_at: string;
  expires_at?: string | null;
  max_liters: number;
  status: "active" | "closed" | "expired";
};

export type PumpEvent = {
  id: number;
  station_id: string;
  dispatch_id: number;
  ts: string;
  state: "on" | "off" | "alarm";
  source?: string | null;
  note?: string | null;
};

export type Photo = {
  id: number;
  dispatch_id: number;
  ts: string;
  camera_id?: string | null;
  storage_path: string; // public path
  meta?: Record<string, any> | null;
};

export type Dispatch = {
  id: number;
  station_id: string;
  station_name: string;
  pin_user_id?: number | null;
  user_name?: string | null;
  litros_autorizados: number;
  litros_entregados: number;
  started_at: string;
  ended_at?: string | null;
  status: DispatchStatus;
  source: string;
  notes?: string | null;
  photos?: Photo[];
  events?: PumpEvent[];
};
