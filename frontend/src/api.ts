import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface Config {
  url: string;
  key: string;
  shop: string;
  push: string;
}
export interface Topping {
  name: string;
  price: number;
  available: boolean;
}
export interface Item {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  photo: string;
  toppings: Topping[];
  reviews: { stars: number; body: string }[];
}
export interface Shop {
  name: string;
  owner: boolean;
  qr: boolean;
  free_m: number;
  per_km: number;
  items: Item[];
}
export interface Line {
  id: string;
  name: string;
  qty: number;
  toppings: string[];
  unit: number;
  note: string;
}
export interface Summary {
  id: string;
  state: string;
  paid: boolean;
  total: number;
  created: string;
}
export interface Order extends Summary {
  proposed_total: number | null;
  adjustment: string;
  owner: boolean;
  mine: boolean;
  method: string;
  fee: number;
  address: string;
  phone: string;
  note: string;
  lines: Line[];
  bank?: string;
  account?: string;
  reviewed: string[];
  messages: { id: number; mine: boolean; body: string }[];
}
export let auth: SupabaseClient;
export async function configure(): Promise<Config> {
  const response = await fetch("/api/config");
  if (!response.ok) throw Error("Không kết nối được máy chủ.");
  const config: Config = await response.json();
  auth = createClient(config.url, config.key, { auth: { flowType: "pkce" } });
  return config;
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const {
    data: { session },
  } = await auth.auth.getSession();
  const headers: Record<string, string> = {};
  if (session) headers.Authorization = "Bearer " + session.access_token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw Error(data.error || "Yêu cầu thất bại.");
  return data;
}
export const money = (n: number) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(
    n,
  );
export const states: Record<string, string> = {
  pending: "Chờ quán xác nhận",
  confirmed: "Đã chốt đơn",
  completed: "Đã nhận món",
  cancelled: "Đã hủy",
  proposed: "Chờ khách duyệt",
};
export function reason(e: unknown) {
  return e instanceof Error ? e.message : "Vui lòng thử lại.";
}
