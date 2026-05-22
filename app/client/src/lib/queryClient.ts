import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Backend URL strategy:
// 1. VITE_API_URL injected at build time wins (used for OVH static frontend pointing at Fly.io)
// 2. Else, legacy sandbox placeholder __PORT_5000__
// 3. Else, same-origin (dev + monolithic deployments)
const RAW_VITE = import.meta.env.VITE_API_URL ?? "";
const RAW_LEGACY = "__PORT_5000__";
const API_BASE =
  RAW_VITE && !RAW_VITE.startsWith("__")
    ? RAW_VITE
    : RAW_LEGACY.startsWith("__")
      ? ""
      : RAW_LEGACY;

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
