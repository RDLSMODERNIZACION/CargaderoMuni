
import type { Station, PinUser, PinSession, Dispatch, Photo, PumpEvent } from "../lib/types";

export const stations: Station[] = [
  { id: "stn-a", name: "Estación A", active: true, created_at: "2025-09-01T10:00:00Z" },
  { id: "stn-b", name: "Estación B", active: true, created_at: "2025-09-10T10:00:00Z" },
  { id: "stn-c", name: "Estación C", active: false, created_at: "2025-09-15T10:00:00Z" },
];

export const users: PinUser[] = [
  { id: 1, name: "Transporte López", enabled: true, tries: 0, locked_until: null, created_at: "2025-09-01T10:00:00Z" },
  { id: 2, name: "Servicios Águila", enabled: false, tries: 3, locked_until: "2025-10-21T12:00:00Z", created_at: "2025-09-05T10:00:00Z" },
  { id: 3, name: "Obras Pampero", enabled: true, tries: 1, locked_until: null, created_at: "2025-09-08T10:00:00Z" },
];

export const sessions: PinSession[] = [
  { id: 101, pin_user_id: 1, station_id: "stn-a", started_at: "2025-10-19T12:00:00Z", expires_at: "2025-10-19T15:00:00Z", max_liters: 12000, status: "active" },
  { id: 102, pin_user_id: 2, station_id: "stn-b", started_at: "2025-10-18T10:00:00Z", expires_at: "2025-10-18T12:00:00Z", max_liters: 8000, status: "expired" },
  { id: 103, pin_user_id: 3, station_id: "stn-a", started_at: "2025-10-17T11:00:00Z", expires_at: "2025-10-17T13:00:00Z", max_liters: 6000, status: "closed" }
];

export const photos: Photo[] = [
  { id: 9001, dispatch_id: 2001, ts: "2025-10-19T12:31:00Z", camera_id: "cam-1", storage_path: "/photos/p1.jpg", meta: { angle: "front" } },
  { id: 9002, dispatch_id: 2001, ts: "2025-10-19T12:59:00Z", camera_id: "cam-1", storage_path: "/photos/p2.jpg", meta: { angle: "front" } },
  { id: 9003, dispatch_id: 2002, ts: "2025-10-18T09:40:00Z", camera_id: "cam-2", storage_path: "/photos/p3.jpg" }
];

export const events: PumpEvent[] = [
  { id: 7001, station_id: "stn-a", dispatch_id: 2001, ts: "2025-10-19T12:30:00Z", state: "on", source: "controller" },
  { id: 7002, station_id: "stn-a", dispatch_id: 2001, ts: "2025-10-19T12:58:00Z", state: "off", source: "controller" },
  { id: 7003, station_id: "stn-b", dispatch_id: 2002, ts: "2025-10-18T09:20:00Z", state: "on" },
  { id: 7004, station_id: "stn-b", dispatch_id: 2002, ts: "2025-10-18T09:45:00Z", state: "off" }
];

export const dispatches: Dispatch[] = [
  {
    id: 2001,
    station_id: "stn-a",
    station_name: "Estación A",
    pin_user_id: 1,
    user_name: "Transporte López",
    litros_autorizados: 10000,
    litros_entregados: 9880,
    started_at: "2025-10-19T12:30:00Z",
    ended_at: "2025-10-19T13:05:00Z",
    status: "finished",
    source: "pin",
    notes: "patente: ABC123",
    photos: photos.filter(p => p.dispatch_id === 2001),
    events: events.filter(e => e.dispatch_id === 2001)
  },
  {
    id: 2002,
    station_id: "stn-b",
    station_name: "Estación B",
    pin_user_id: 2,
    user_name: "Servicios Águila",
    litros_autorizados: 5000,
    litros_entregados: 3100,
    started_at: "2025-10-18T09:20:00Z",
    ended_at: "2025-10-18T09:45:00Z",
    status: "finished",
    source: "pin",
    notes: "patente: DEF456",
    photos: photos.filter(p => p.dispatch_id === 2002),
    events: events.filter(e => e.dispatch_id === 2002)
  },
  {
    id: 2003,
    station_id: "stn-a",
    station_name: "Estación A",
    pin_user_id: 3,
    user_name: "Obras Pampero",
    litros_autorizados: 12000,
    litros_entregados: 6200,
    started_at: "2025-10-19T10:10:00Z",
    ended_at: null,
    status: "running",
    source: "manual",
    notes: null,
    photos: [],
    events: []
  }
];
