import { credentialsRoute } from "@/lib/server/auth";

export const POST = (request: Request) => credentialsRoute(request, "/auth/login");
