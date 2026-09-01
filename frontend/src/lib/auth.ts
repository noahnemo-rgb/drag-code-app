import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "syntax.auth.token";
const USER_KEY = "syntax.auth.user";

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  created_at?: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: AuthUser;
}

let memoryToken: string | null = null;
let memoryUser: AuthUser | null = null;

export async function getAccessToken(): Promise<string | null> {
  if (memoryToken) return memoryToken;
  memoryToken = await AsyncStorage.getItem(TOKEN_KEY);
  return memoryToken;
}

export async function getAuthUser(): Promise<AuthUser | null> {
  if (memoryUser) return memoryUser;
  const raw = await AsyncStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    memoryUser = JSON.parse(raw) as AuthUser;
    return memoryUser;
  } catch {
    return null;
  }
}

export async function setSession(res: AuthResponse): Promise<void> {
  memoryToken = res.access_token;
  memoryUser = res.user;
  await AsyncStorage.setItem(TOKEN_KEY, res.access_token);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(res.user));
}

export async function clearSession(): Promise<void> {
  memoryToken = null;
  memoryUser = null;
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
}

export async function isLoggedIn(): Promise<boolean> {
  return Boolean(await getAccessToken());
}
