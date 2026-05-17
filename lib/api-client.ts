import { auth } from "./firebase";

async function getHeaders() {
  const user = auth.currentUser;
  if (!user) return {};
  const token = await user.getIdToken();
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  };
}

export async function fetchSettings() {
  const headers = await getHeaders();
  const res = await fetch("/api/settings", { headers });
  if (!res.ok) throw new Error("Failed to fetch settings");
  return res.json();
}

export async function updateSettings(settings: any) {
  const headers = await getHeaders();
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers,
    body: JSON.stringify(settings)
  });
  if (!res.ok) throw new Error("Failed to update settings");
  return res.json();
}

export async function fetchMemories() {
  const headers = await getHeaders();
  const res = await fetch("/api/memories", { headers });
  if (!res.ok) throw new Error("Failed to fetch memories");
  return res.json();
}

export async function saveMemory(content: string, type: string) {
  const headers = await getHeaders();
  const res = await fetch("/api/memories", {
    method: "POST",
    headers,
    body: JSON.stringify({ content, type })
  });
  if (!res.ok) throw new Error("Failed to save memory");
  return res.json();
}

export async function deleteMemory(id: number) {
  const headers = await getHeaders();
  const res = await fetch(`/api/memories/${id}`, {
    method: "DELETE",
    headers
  });
  if (!res.ok) throw new Error("Failed to delete memory");
  return res.json();
}
