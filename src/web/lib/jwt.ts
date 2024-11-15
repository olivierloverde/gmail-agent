import { jwtDecode } from "jwt-decode";

export function createToken(userId: string, secret: string): string {
  // Create a JWT-like token that matches the server's expectations
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ userId: userId }));
  const signature = btoa(secret);

  return `${header}.${payload}.${signature}`;
}

export function parseToken(token: string) {
  try {
    const [header, payload, signature] = token.split(".");
    return {
      header: JSON.parse(atob(header)),
      payload: JSON.parse(atob(payload)),
      secret: atob(signature),
    };
  } catch (error) {
    console.error("Error parsing token:", error);
    throw new Error("Invalid token format");
  }
}

export function decodeToken(token: string) {
  return jwtDecode(token);
}
